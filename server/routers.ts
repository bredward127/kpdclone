import { initTRPC, TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import { clearSession } from "./auth";
import { isFalAdministrator } from "./fal-admin";
import { getFalConnectionStatus, type FalConnectionStatus } from "./fal";
import { createBookBrief, createPagePlan, updatePagePlan, getBriefForProject, getCoverPlanForUser, getLayoutTemplateForUser, getLatestValidationRun, getPagePlanForUser, getGeneratedAssetForUser, getGenerationJobForUser, insertGenerationJob, listAssetVariantsForUser, listAuditEvents, listExportPackages, listGeneratedAssetsForPage, listGenerationJobsForUser, listPagePlans, reviewGeneratedAsset, transitionAssetStatus, transitionGenerationJob, updatePageApproval } from "./db-studio";
import { lifecycleStatuses, pageApprovalStates } from "../shared/studio";
import { createLocalPrivateStorage, type PrivateStorage } from "./storage";
import { deleteReferenceAssetForUser, getReferenceAssetForUser, listReferenceAssets, referenceKinds, provenanceDeclarations, assertReferenceCanBeUsedForGeneration, uploadReferenceAsset } from "./reference-assets";
import { getReferenceValidationLimits } from "./reference-validation";
import { composePromptFromSavedProject, createPromptVersion, freezePromptVersion, getPromptVersionForUser, listPromptVersions, restorePromptVersion } from "./prompt-composer";
import { createFalGenerationService, type FalGenerationService } from "./fal-generation";
import { getFalQueueClient } from "./fal-queue";
import { createAuditEvent } from "./db-studio";
import { falModelRegistry, listSelectableFalModels } from "./fal-models";
import { getQualityResultForAsset } from "./asset-quality";
import { createCoverPlanVersion, coverArtPrompt, getLatestCoverPlan, importCoverTemplate, invalidateCoverPlansForInteriorChange, listCoverTemplates, makeInteriorFingerprint, type CoverPlanInput } from "./cover-desk";
import { assembleInteriorExport, type InteriorFont, type InteriorPageType } from "./interior-pdf";
import { composeCoverExport, type CoverFont } from "./cover-composer";
import { activateKdpRuleset, createKdpRulesetDraft, DEFAULT_KDP_RULESET, DEFAULT_KDP_SOURCE_URLS, listKdpRulesets, persistPaperbackPreflight, type KdpRulesetConfig, type PaperbackPreflightInput } from "./kdp-preflight";
import { computeFrozenProjectVersion, createFinalExport, type FinalExportInput } from "./export-center";
import { addProvenanceEntry, assertPublishingReadyForExport, classifyContentPolicy, createPublishingMetadataVersion, finalizePublishingMetadataVersion, listProvenance, recordContentPolicyReview, type PublishingMetadataInput, type ProvenanceInput } from "./publishing";
import { createProject, deleteProjectDataForUser, getProjectForUser, listProjects, updateProjectForUser, upsertUser, type AppDatabase, type UserRecord } from "./db";
import { createRateLimiter } from "./security";
import { cleanupExpiredObjects, getOperationsDashboard, getRecoveryCandidates, reconcileOneJob, recordOperationalRecovery, retryOneStorageCopy, regenerateOneExport } from "./operations";

export type AppContext = {
  db: AppDatabase;
  user: UserRecord | null;
  res?: Response;
};

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
  }

  upsertUser(ctx.db, ctx.user);
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

const projectIdInput = z.object({ projectId: z.string().min(1) });
const projectInput = z.object({
  name: z.string().trim().min(1).max(120),
  brief: z.string().trim().max(5000).default(""),
});
const kdpPageInput = z.object({ pageNumber: z.number().int().positive(), blank: z.boolean(), assetId: z.string().optional(), effectiveDpi: z.number().optional(), textFontIds: z.array(z.string()).default([]) });
const kdpPreflightInput = z.object({ projectId: z.string().min(1), trimWidthInches: z.number().positive(), trimHeightInches: z.number().positive(), bleed: z.boolean(), interiorPageCount: z.number().int().positive(), readingDirection: z.enum(["ltr", "rtl"]), interior: z.object({ pdfBytesBase64: z.string().min(1).max(900_000_000), widthInches: z.number().positive(), heightInches: z.number().positive(), pageCount: z.number().int().positive(), pages: z.array(kdpPageInput), fontsEmbedded: z.array(z.string()), manifestRulesetVersion: z.string().optional(), manifestReadingDirection: z.enum(["ltr", "rtl"]).optional(), measuredOutsideMarginInches: z.number().nonnegative(), measuredGutterMarginInches: z.number().nonnegative() }), cover: z.object({ pdfBytesBase64: z.string().min(1).max(900_000_000), pageCount: z.number().int().positive(), widthInches: z.number().positive(), heightInches: z.number().positive(), expectedWidthInches: z.number().positive(), expectedHeightInches: z.number().positive(), templateCurrent: z.boolean(), templateSourceUrl: z.string().url().optional(), templateFingerprintMatches: z.boolean(), safeZoneWarnings: z.array(z.string()), bleedCovered: z.boolean(), barcodeClear: z.boolean(), spineEligible: z.boolean(), spineTextInsideSafeZone: z.boolean(), flattened: z.boolean(), hasGuideContent: z.boolean(), sourceAssetIds: z.array(z.string()) }), expectedInteriorWidthInches: z.number().positive(), expectedInteriorHeightInches: z.number().positive(), permittedFontIds: z.array(z.string()) });
const finalExportInput = z.object({ projectId: z.string().min(1), validationRunId: z.string().min(1), interiorExportRunId: z.string().min(1), coverExportRunId: z.string().min(1), frozenProjectVersion: z.string().regex(/^[a-f0-9]{64}$/), confirmFinalProjectVersion: z.literal(true), listingMetadata: z.object({ title: z.string().min(1).max(500), subtitle: z.string().max(500).optional(), author: z.string().min(1).max(500), description: z.string().max(20_000).optional(), keywords: z.string().max(2_000).optional(), categories: z.string().max(2_000).optional(), language: z.string().max(80).optional() }), approvedSourceImageIds: z.array(z.string().min(1)).max(500).default([]), retentionDays: z.number().int().min(1).max(3650).optional() });
const publishingMetadataInput = z.object({ title: z.string().trim().min(1).max(500), subtitle: z.string().max(500).optional(), seriesName: z.string().max(500).optional(), seriesNumber: z.string().max(40).optional(), edition: z.string().max(200).optional(), contributors: z.array(z.object({ name: z.string().trim().min(1).max(300), role: z.string().trim().min(1).max(80) })).max(50).default([]), language: z.string().trim().min(2).max(80), description: z.string().max(20_000).optional(), keywordPhrases: z.array(z.string().trim().min(1).max(200)).length(7), categories: z.array(z.string().trim().min(1).max(300)).max(20).default([]), audience: z.record(z.string(), z.unknown()).default({}), readingDirection: z.enum(["ltr", "rtl"]), printSettings: z.record(z.string(), z.unknown()).default({}), rightsOwner: z.string().trim().min(1).max(500), imprint: z.string().max(100).optional(), isbn13: z.string().regex(/^(97[89])\d{10}$/).optional(), isbn10: z.string().regex(/^\d{9}[\dX]$/).optional(), isbnSource: z.enum(["kdp_free", "owned"]).optional(), aiDisclosureConfirmed: z.boolean(), rightsAttestationConfirmed: z.literal(true), aiDisclosureRequired: z.boolean().optional() });
const provenanceInput = z.object({ elementType: z.enum(["text", "image", "translation", "layout"]), elementKey: z.string().min(1).max(300), classification: z.enum(["ai_generated", "ai_assisted", "user_authored", "licensed_upload"]), sourceAssetId: z.string().optional(), modelEndpoint: z.string().max(500).optional(), promptVersionId: z.string().optional(), outputTimestamp: z.string().datetime().optional(), ownerApproval: z.boolean(), rightsAttestation: z.boolean(), notes: z.string().max(5000).optional() });
const interiorPageInput = z.object({
  id: z.string().min(1), pageNumber: z.number().int().positive(), pageType: z.enum(["front_matter", "dedication", "copyright", "storybook_text_spread", "coloring_page", "activity_page", "intentional_blank", "end_matter"]), assetId: z.string().min(1).optional(), assetVersion: z.string().max(200).optional(), assetChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), textBlocks: z.array(z.object({ id: z.string().min(1), text: z.string().max(20_000), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), fontSize: z.number().positive(), fontId: z.string().optional(), align: z.enum(["left", "center", "right"]).optional() })).max(40).default([]), imagePlacement: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), fit: z.enum(["contain", "cover"]).optional() }).optional(), intentionallyBlank: z.boolean().optional(), layoutId: z.string().max(200).optional(),
});

export function createAppRouter(
  db: AppDatabase,
  options: {
    falStatus?: () => Promise<FalConnectionStatus>;
    falAdminEnv?: NodeJS.ProcessEnv;
    storage?: PrivateStorage;
    generationService?: FalGenerationService;
  } = {}) {
  const falStatus = options.falStatus ?? (() => getFalConnectionStatus());
  const falAdminEnv = options.falAdminEnv ?? process.env;
  const storage = options.storage ?? createLocalPrivateStorage();
  const generationService = "generationService" in options ? options.generationService : (process.env.NODE_ENV === "test" ? undefined : createFalGenerationService({ adapter: getFalQueueClient(), storage, webhookUrl: process.env.FAL_WEBHOOK_URL }));
  const referenceLimits = getReferenceValidationLimits();
  const submitLimiter = createRateLimiter(60_000, 12);
  const uploadLimiter = createRateLimiter(60_000, 20);
  const exportLimiter = createRateLimiter(60_000, 6);
  const policyLimiter = createRateLimiter(60_000, 30);
  const enforceLimit = (limiter: ReturnType<typeof createRateLimiter>, userId: string, action: string) => { const result = limiter(`${action}:${userId}`); if (!result.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Too many ${action} requests. Retry in ${result.retryAfterSeconds} seconds.` }); };
  const recordWorkflowEvent = (userId: string, projectId: string | undefined, entityType: string, entityId: string, eventType: string, metadataJson = "{}") => createAuditEvent(db, userId, { projectId, actorUserId: userId, entityType, entityId, eventType, metadataJson });

  return router({
    operations: router({
      dashboard: protectedProcedure.query(({ ctx }) => { if (!isFalAdministrator(ctx.user.id, falAdminEnv)) throw new TRPCError({ code: "FORBIDDEN", message: "Operations dashboard is restricted to administrators." }); return getOperationsDashboard(db); }),
      recoveryCandidates: protectedProcedure.query(({ ctx }) => { if (!isFalAdministrator(ctx.user.id, falAdminEnv)) throw new TRPCError({ code: "FORBIDDEN", message: "Recovery actions are restricted to administrators." }); return getRecoveryCandidates(db); }),
      reconcileJob: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ ctx, input }) => { if (!isFalAdministrator(ctx.user.id, falAdminEnv)) throw new TRPCError({ code: "FORBIDDEN", message: "Recovery actions are restricted to administrators." }); if (!generationService) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Generation service is not configured." }); try { return await reconcileOneJob(db, generationService, ctx.user.id, input.jobId); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The selected job could not be reconciled." }); } }),
      retryStorageCopy: protectedProcedure.input(z.object({ operationId: z.string().min(1) })).mutation(async ({ ctx, input }) => { if (!isFalAdministrator(ctx.user.id, falAdminEnv)) throw new TRPCError({ code: "FORBIDDEN", message: "Recovery actions are restricted to administrators." }); try { return await retryOneStorageCopy(db, storage, ctx.user.id, input.operationId); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The selected storage operation is not safely retryable." }); } }),
      regenerateExport: protectedProcedure.input(z.object({ exportPackageId: z.string().min(1) })).mutation(async ({ ctx, input }) => { if (!isFalAdministrator(ctx.user.id, falAdminEnv)) throw new TRPCError({ code: "FORBIDDEN", message: "Recovery actions are restricted to administrators." }); try { return await regenerateOneExport(db, storage, ctx.user.id, input.exportPackageId); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The selected frozen export could not be regenerated." }); } }),
      cleanup: protectedProcedure.mutation(async ({ ctx }) => { if (!isFalAdministrator(ctx.user.id, falAdminEnv)) throw new TRPCError({ code: "FORBIDDEN", message: "Cleanup controls are restricted to administrators." }); const result = await cleanupExpiredObjects(db, storage); recordOperationalRecovery(db, ctx.user.id, "retention_cleanup", "scheduled", "succeeded", "bounded_cleanup"); return result; }),
    }),
    auth: router({
      me: publicProcedure.query(({ ctx }) => ctx.user),
      logout: publicProcedure.mutation(({ ctx }) => {
        if (ctx.res) clearSession(ctx.res);
        return { ok: true };
      }),
      fal: protectedProcedure
        .meta({ description: "Administrator-only masked FAL connection status" })
        .mutation(async ({ ctx }) => {
          if (!isFalAdministrator(ctx.user.id, falAdminEnv)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "FAL connection status is restricted to administrators." });
          }
          return falStatus();
        }),
      falModels: protectedProcedure.query(({ ctx }) => {
        if (!isFalAdministrator(ctx.user.id, falAdminEnv)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "FAL model configuration is restricted to administrators." });
        }
        return falModelRegistry.map(({ allowedInputSchema: _schema, ...model }) => model);
      }),
    }),
    studio: router({
      publishing: router({
        metadata: router({
          createVersion: protectedProcedure.input(projectIdInput.extend(publishingMetadataInput.shape)).mutation(({ ctx, input }) => { enforceLimit(policyLimiter, ctx.user.id, "publishing metadata"); return createPublishingMetadataVersion(db, ctx.user.id, input.projectId, input as PublishingMetadataInput); }),
          finalize: protectedProcedure.input(projectIdInput.extend({ metadataVersionId: z.string().min(1) })).mutation(({ ctx, input }) => { try { finalizePublishingMetadataVersion(db, ctx.user.id, input.projectId, input.metadataVersionId); return { ok: true }; } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Publishing metadata could not be finalized." }); } }),
        }),
        provenance: router({
          list: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => listProvenance(db, ctx.user.id, input.projectId)),
          add: protectedProcedure.input(projectIdInput.extend(provenanceInput.shape).extend({ metadataVersionId: z.string().optional() })).mutation(({ ctx, input }) => { try { return { id: addProvenanceEntry(db, ctx.user.id, input.projectId, input.metadataVersionId, input as ProvenanceInput) }; } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Provenance entry could not be saved." }); } }),
        }),
        policy: router({
          evaluate: protectedProcedure.input(projectIdInput.extend({ text: z.string().max(100_000) })).query(({ input }) => classifyContentPolicy(input.text)),
          review: protectedProcedure.input(projectIdInput.extend({ subjectType: z.enum(["prompt", "metadata", "export"]), subjectId: z.string().min(1), text: z.string().max(100_000), rightsAttestation: z.boolean() })).mutation(({ ctx, input }) => { enforceLimit(policyLimiter, ctx.user.id, "policy review"); return recordContentPolicyReview(db, ctx.user.id, input.projectId, input.subjectType, input.subjectId, input.text, input.rightsAttestation); }),
        }),
      }),
      brief: router({
        get: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          }
          return getBriefForProject(db, ctx.user.id, input.projectId);
        }),
        save: protectedProcedure.input(projectIdInput.extend({
          briefText: z.string().max(20_000),
          bookType: z.string().min(1).max(60),
          audience: z.string().max(500),
          visualStyleAnchors: z.string().max(10_000),
          characterBible: z.string().max(10_000),
          negativePrompt: z.string().max(10_000),
        })).mutation(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          }
          const brief = createBookBrief(db, ctx.user.id, { id: crypto.randomUUID(), ...input });
          recordWorkflowEvent(ctx.user.id, input.projectId, "book_brief", brief.id, "brief_changed", JSON.stringify({ version: brief.version }));
          return brief;
        }),
      }),
      prompts: router({
        list: protectedProcedure.input(z.object({ projectId: z.string().min(1), pagePlanId: z.string().min(1) })).query(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          const page = getPagePlanForUser(db, ctx.user.id, input.pagePlanId);
          if (!page || page.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Page plan not found." });
          return listPromptVersions(db, ctx.user.id, input.projectId, input.pagePlanId);
        }),
        composeAndSave: protectedProcedure.input(z.object({
          projectId: z.string().min(1),
          pagePlanId: z.string().min(1),
          generationModel: z.string().trim().min(1).max(200),
          generationEndpoint: z.string().trim().min(1).max(300),
          aspectRatio: z.string().trim().regex(/^\d+:\d+$/),
          seed: z.number().int().optional(),
          referenceAssetIds: z.array(z.string().min(1)).max(24),
          userEdits: z.object({
            promptAddition: z.string().max(10_000).optional(),
            negativePromptAddition: z.string().max(10_000).optional(),
            compositionNotes: z.string().max(10_000).optional(),
          }).optional(),
        })).mutation(({ ctx, input }) => {
          try {
            const composed = composePromptFromSavedProject(db, ctx.user.id, input);
            const version = createPromptVersion(db, ctx.user.id, composed, input);
            recordWorkflowEvent(ctx.user.id, input.projectId, "prompt_version", version.id, "prompt_version_created", JSON.stringify({ endpoint: input.generationEndpoint, aspectRatio: input.aspectRatio }));
            return version;
          } catch (error) {
            if (error instanceof Error && error.message === "Project not found.") throw new TRPCError({ code: "NOT_FOUND", message: error.message });
            if (error instanceof Error && error.message === "Page plan not found.") throw new TRPCError({ code: "NOT_FOUND", message: error.message });
            throw new TRPCError({ code: "BAD_REQUEST", message: "The prompt could not be composed from the saved project context." });
          }
        }),
        freeze: protectedProcedure.input(z.object({ projectId: z.string().min(1), promptVersionId: z.string().min(1) })).mutation(({ ctx, input }) => {
          const existing = getPromptVersionForUser(db, ctx.user.id, input.promptVersionId);
          if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Prompt version not found." });
          try { return freezePromptVersion(db, ctx.user.id, input.promptVersionId); }
          catch { throw new TRPCError({ code: "BAD_REQUEST", message: "This prompt version could not be frozen for generation." }); }
        }),
        restore: protectedProcedure.input(z.object({ projectId: z.string().min(1), promptVersionId: z.string().min(1) })).mutation(({ ctx, input }) => {
          const existing = getPromptVersionForUser(db, ctx.user.id, input.promptVersionId);
          if (!existing || existing.projectId !== input.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Prompt version not found." });
          try {
            return restorePromptVersion(db, ctx.user.id, input.promptVersionId);
          } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This prompt version could not be restored." });
          }
        }),
      }),
      pages: router({
        list: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          }
          return listPagePlans(db, ctx.user.id, input.projectId);
        }),
        create: protectedProcedure.input(projectIdInput.extend({
          pageNumber: z.number().int().positive(),
          spreadNumber: z.number().int().positive().optional(),
          sceneDirection: z.string().max(10_000).default(""),
          pageText: z.string().max(10_000).default(""),
        })).mutation(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          }
          return createPagePlan(db, ctx.user.id, { id: crypto.randomUUID(), ...input });
        }),
        update: protectedProcedure.input(z.object({ pagePlanId: z.string().min(1), sceneDirection: z.string().max(10_000), pageText: z.string().max(10_000), spreadNumber: z.number().int().positive().optional() })).mutation(({ ctx, input }) => {
          const updated = updatePagePlan(db, ctx.user.id, input.pagePlanId, input);
          if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Page plan not found." });
          return updated;
        }),
        setApproval: protectedProcedure.input(z.object({
          pagePlanId: z.string().min(1),
          approvalState: z.enum(pageApprovalStates),
          rejectionReason: z.string().max(2_000).optional(),
        })).mutation(({ ctx, input }) => {
          const page = getPagePlanForUser(db, ctx.user.id, input.pagePlanId);
          if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Page plan not found." });
          try {
            updatePageApproval(db, ctx.user.id, input.pagePlanId, input);
          } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: "A rejection reason is required when rejecting a page plan." });
          }
          return getPagePlanForUser(db, ctx.user.id, input.pagePlanId);
        }),
      }),
      generationJobs: router({
        list: protectedProcedure.input(projectIdInput.extend({ pagePlanId: z.string().min(1).optional() })).query(async ({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          const jobs = listGenerationJobsForUser(db, ctx.user.id, input.projectId, input.pagePlanId);
          const assets = input.pagePlanId ? listGeneratedAssetsForPage(db, ctx.user.id, input.projectId, input.pagePlanId) : [];
          const assetsWithAccess = await Promise.all(assets.map(async (asset) => ({ ...asset, accessUrl: await storage.createAccessUrl(asset.storageReference, 900), quality: getQualityResultForAsset(db, ctx.user.id, asset.id, "generated") })));
          return { jobs, assets: assetsWithAccess, variants: assets.flatMap((asset) => listAssetVariantsForUser(db, ctx.user.id, input.projectId, asset.id)) };
        }),
        models: protectedProcedure.query(() => listSelectableFalModels()),
        reviewAsset: protectedProcedure.input(z.object({ assetId: z.string().min(1), decision: z.enum(["approved", "rejected", "archived"]), rejectionReason: z.string().max(2_000).optional() })).mutation(({ ctx, input }) => {
          try {
            const asset = reviewGeneratedAsset(db, ctx.user.id, input.assetId, input);
            if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Generated asset not found." });
            return asset;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The asset review could not be saved." });
          }
        }),
        submit: protectedProcedure.input(z.object({
          projectId: z.string().min(1), pagePlanId: z.string().min(1), promptVersionId: z.string().min(1),
          generationModel: z.string().min(1).max(200), generationEndpoint: z.string().min(1).max(300), aspectRatio: z.string().regex(/^\\d+:\\d+$/), seed: z.number().int().optional(), referenceAssetIds: z.array(z.string().min(1)).max(24), expectedOutputConstraints: z.record(z.string(), z.unknown()).default({}), idempotencyKey: z.string().min(8).max(200).optional(), requestKind: z.enum(["initial", "variation", "prompt_edit"]).default("initial"), sourceAssetId: z.string().min(1).optional(),
        })).mutation(async ({ ctx, input }) => {
          if (!generationService) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Generation service is not configured." });
          enforceLimit(submitLimiter, ctx.user.id, "generation");
          try { const result = await generationService.submit(db, ctx.user.id, input); recordWorkflowEvent(ctx.user.id, input.projectId, "generation_job", result.localJobId, "generation_submitted", JSON.stringify({ endpoint: input.generationEndpoint, requestKind: input.requestKind })); return result; }
          catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Generation could not be submitted safely." }); }
        }),
        cancel: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
          if (!generationService) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Generation service is not configured." });
          try { return await generationService.cancel(db, ctx.user.id, input.jobId); }
          catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Generation cancellation could not be requested safely." }); }
        }),
        reconcile: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
          if (!generationService) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Generation service is not configured." });
          try { return await generationService.reconcile(db, ctx.user.id, input.jobId); }
          catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Generation status could not be reconciled safely." }); }
        }),
        retry: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
          if (!generationService) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Generation service is not configured." });
          try { return await generationService.retry(db, ctx.user.id, input.jobId); }
          catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Generation retry could not be submitted safely." }); }
        }),
        queueNext: protectedProcedure.input(z.object({
          projectId: z.string().min(1), count: z.union([z.literal(2), z.literal(3)]), confirmed: z.literal(true),
          requests: z.array(z.object({ pagePlanId: z.string().min(1), promptVersionId: z.string().min(1), generationModel: z.string().min(1).max(200), generationEndpoint: z.string().min(1).max(300), aspectRatio: z.string().regex(/^\\d+:\\d+$/), seed: z.number().int().optional(), referenceAssetIds: z.array(z.string().min(1)).max(24), expectedOutputConstraints: z.record(z.string(), z.unknown()).default({}), idempotencyKey: z.string().min(8).max(200) })).min(2).max(3),
        })).mutation(async ({ ctx, input }) => {
          if (!generationService) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Generation service is not configured." });
          enforceLimit(submitLimiter, ctx.user.id, "generation queue");
          if (input.requests.length !== input.count) throw new TRPCError({ code: "BAD_REQUEST", message: "The confirmed queue count does not match the pending page selection." });
          try {
            const jobs = [] as Array<Awaited<ReturnType<typeof generationService.submit>>>;
            for (const request of input.requests) jobs.push(await generationService.submit(db, ctx.user.id, { ...request, projectId: input.projectId, requestKind: "initial" }));
            return { confirmed: true, jobs };
          } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The bounded page queue could not be submitted." }); }
        }),
        create: protectedProcedure.input(projectIdInput.extend({
          pagePlanId: z.string().min(1).optional(),
          promptVersionId: z.string().min(1).optional(),
          generationModel: z.string().min(1).max(200),
          generationEndpoint: z.string().min(1).max(300),
          seed: z.number().int().optional(),
        })).mutation(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          }
          return insertGenerationJob(db, ctx.user.id, { id: crypto.randomUUID(), ...input });
        }),
        transition: protectedProcedure.input(z.object({
          jobId: z.string().min(1),
          toStatus: z.enum(lifecycleStatuses),
        })).mutation(({ ctx, input }) => {
          try {
            const job = transitionGenerationJob(db, ctx.user.id, input.jobId, input.toStatus);
            if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Generation job not found." });
            return job;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid generation job lifecycle transition." });
          }
        }),
      }),
      assets: router({
        transition: protectedProcedure.input(z.object({
          assetId: z.string().min(1),
          toStatus: z.enum(lifecycleStatuses),
        })).mutation(({ ctx, input }) => {
          try {
            const asset = transitionAssetStatus(db, ctx.user.id, input.assetId, input.toStatus);
            if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Generated asset not found." });
            return asset;
          } catch (error) {
            if (error instanceof TRPCError) throw error;
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid generated asset lifecycle transition." });
          }
        }),
      }),
      cover: router({
        get: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          return getLatestCoverPlan(db, ctx.user.id, input.projectId) ?? getCoverPlanForUser(db, ctx.user.id, input.projectId);
        }),
        templates: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          return listCoverTemplates(db, ctx.user.id, input.projectId);
        }),
        artPrompt: protectedProcedure.input(z.object({ role: z.enum(["front", "back", "decorative"]), brief: z.string().max(2_000).default("") })).query(({ input }) => coverArtPrompt(input.role, input.brief)),
        save: protectedProcedure.input(projectIdInput.extend({
          binding: z.literal("paperback"), trimWidthInches: z.number().positive(), trimHeightInches: z.number().positive(), finalInteriorPageCount: z.number().int().positive(), paperSelection: z.string().min(1).max(100), inkSelection: z.string().min(1).max(100), readingDirection: z.enum(["ltr", "rtl"]), title: z.string().max(500), subtitle: z.string().max(500).default(""), author: z.string().max(500), imprint: z.string().max(500).default(""), backCoverCopy: z.string().max(10_000).default(""), barcodeDecision: z.enum(["amazon_placed", "creator_supplied"]), spineTextPermitted: z.boolean(), frontArtAssetId: z.string().min(1).optional(), backArtAssetId: z.string().min(1).optional(), decorativeAssetIds: z.array(z.string().min(1)).max(24).default([]), placement: z.record(z.string(), z.unknown()).default({}), templateImportId: z.string().min(1).optional(), inputsConfirmed: z.boolean().default(false),
        })).mutation(({ ctx, input }) => {
          try { return createCoverPlanVersion(db, ctx.user.id, input.projectId, input as CoverPlanInput); }
          catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Cover plan could not be saved." }); }
        }),
        importTemplate: protectedProcedure.input(projectIdInput.extend({
          sourceUrl: z.string().url(), retrievedAt: z.string().datetime(), calculatorInputs: z.record(z.string(), z.unknown()), finalInteriorPageCount: z.number().int().positive(), guideMimeType: z.enum(["application/pdf", "image/png"]), guideBytesBase64: z.string().min(1).max(50_000_000), fullCoverWidthInches: z.number().positive(), fullCoverHeightInches: z.number().positive(), bounds: z.record(z.string(), z.unknown()), safeZones: z.record(z.string(), z.unknown()), bleedZones: z.record(z.string(), z.unknown()), barcodeMargin: z.record(z.string(), z.unknown()), spineSafeZone: z.record(z.string(), z.unknown()),
        })).mutation(async ({ ctx, input }) => {
          let guideBytes: Buffer;
          try { guideBytes = Buffer.from(input.guideBytesBase64, "base64"); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Template guide encoding is invalid." }); }
          try {
            const project = getProjectForUser(db, ctx.user.id, input.projectId);
            if (!project) throw new Error("Project not found.");
            return await importCoverTemplate(db, storage, ctx.user.id, input.projectId, { ...input, guideBytes, interiorFingerprint: makeInteriorFingerprint(project, input.finalInteriorPageCount) });
          }
          catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Template import failed." }); }
        }),
        invalidate: protectedProcedure.input(projectIdInput.extend({ finalInteriorPageCount: z.number().int().positive() })).mutation(({ ctx, input }) => {
          const project = getProjectForUser(db, ctx.user.id, input.projectId);
          if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          const fingerprint = makeInteriorFingerprint(project, input.finalInteriorPageCount);
          return { invalidatedCount: invalidateCoverPlansForInteriorChange(db, ctx.user.id, input.projectId, fingerprint), interiorFingerprint: fingerprint };
        }),
      }),
      layout: router({
        get: protectedProcedure.input(z.object({ templateId: z.string().min(1) })).query(({ ctx, input }) => {
          const template = getLayoutTemplateForUser(db, ctx.user.id, input.templateId);
          if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Layout template not found." });
          return template;
        }),
      }),
      validation: router({
        rulesets: router({
          list: protectedProcedure.query(({ ctx }) => listKdpRulesets(db, ctx.user.id, falAdminEnv)),
          createDraft: protectedProcedure.input(z.object({ version: z.string().min(1).max(80), effectiveDate: z.string().date(), config: z.record(z.string(), z.unknown()), sourceUrls: z.array(z.string().url()).min(1), reviewNotes: z.string().max(5000).optional() })).mutation(({ ctx, input }) => createKdpRulesetDraft(db, ctx.user.id, falAdminEnv, { ...input, config: input.config as unknown as KdpRulesetConfig })),
          activate: protectedProcedure.input(z.object({ id: z.string().min(1), reviewNotes: z.string().max(5000).optional() })).mutation(({ ctx, input }) => activateKdpRuleset(db, ctx.user.id, falAdminEnv, input.id, input.reviewNotes)),
          defaultConfig: protectedProcedure.query(({ ctx }) => { if (!isFalAdministrator(ctx.user.id, falAdminEnv)) throw new TRPCError({ code: "FORBIDDEN", message: "KDP ruleset administration is restricted to administrators." }); return { config: DEFAULT_KDP_RULESET, sourceUrls: DEFAULT_KDP_SOURCE_URLS }; }),
        }),
        run: protectedProcedure.input(kdpPreflightInput).mutation(async ({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          const reportInput: PaperbackPreflightInput = { ...input, interior: { ...input.interior, pdfBytes: Buffer.from(input.interior.pdfBytesBase64, "base64") }, cover: { ...input.cover, pdfBytes: Buffer.from(input.cover.pdfBytesBase64, "base64") } };
          try { return await persistPaperbackPreflight(db, storage, ctx.user.id, reportInput); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "KDP preflight could not be completed." }); }
        }),
        latestPreflight: protectedProcedure.input(projectIdInput).query(async ({ ctx, input }) => { if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." }); const run = db.prepare(`SELECT r.*, k.version AS ruleset_version FROM kdp_preflight_runs r JOIN kdp_rulesets k ON k.id = r.ruleset_id WHERE r.user_id = ? AND r.project_id = ? ORDER BY r.created_at DESC LIMIT 1`).get(ctx.user.id, input.projectId) as Record<string, unknown> | undefined; if (!run) return null; return { id: String(run.id), status: String(run.status), rulesetVersion: String(run.ruleset_version), blockingIssueCount: Number(run.blocking_issue_count), warningCount: Number(run.warning_count), informationalCount: Number(run.informational_count), jsonAccessUrl: await storage.createAccessUrl(String(run.report_json_storage_reference), 900), htmlAccessUrl: await storage.createAccessUrl(String(run.report_html_storage_reference), 900), pdfAccessUrl: await storage.createAccessUrl(String(run.report_pdf_storage_reference), 900) }; }),
        latest: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          return getLatestValidationRun(db, ctx.user.id, input.projectId);
        }),
      }),
      exports: router({
        list: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          return listExportPackages(db, ctx.user.id, input.projectId);
        }),
        createInterior: protectedProcedure.input(projectIdInput.extend({
          trimWidthInches: z.number().positive(), trimHeightInches: z.number().positive(), bleed: z.boolean(), pageCount: z.number().int().positive(), paperSelection: z.string().min(1).max(100), inkSelection: z.string().min(1).max(100), readingDirection: z.enum(["ltr", "rtl"]), autoPadOddPageCount: z.boolean().optional(), pages: z.array(interiorPageInput).min(1), fonts: z.array(z.object({ id: z.string().min(1), family: z.string().min(1).max(200), bytesBase64: z.string().min(1).max(20_000_000), permitted: z.boolean() })).max(8).default([]),
        })).mutation(async ({ ctx, input }) => {
          enforceLimit(exportLimiter, ctx.user.id, "interior export");
          try {
            const fonts: InteriorFont[] = input.fonts.map((font) => ({ id: font.id, family: font.family, bytes: Buffer.from(font.bytesBase64, "base64"), permitted: font.permitted }));
            const result = await assembleInteriorExport(db, storage, ctx.user.id, { ...input, fonts, pages: input.pages as Array<{ id: string; pageNumber: number; pageType: InteriorPageType; assetId?: string; assetVersion?: string; assetChecksumSha256?: string; textBlocks?: never[] }> });
            recordWorkflowEvent(ctx.user.id, input.projectId, "interior_export", String((result as { id?: string }).id ?? "created"), "export_created");
            return result;
          } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Interior export could not be assembled." }); }
        }),
        createCover: protectedProcedure.input(projectIdInput.extend({
          planVersionId: z.string().min(1), templateImportId: z.string().min(1), frontArtPlacement: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional(), backArtPlacement: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional(), spineTextPlacement: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional(), barcodePlacement: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional(), fonts: z.array(z.object({ id: z.string().min(1), family: z.string().min(1).max(200), bytesBase64: z.string().min(1).max(20_000_000), permitted: z.boolean() })).max(8).default([]),
        })).mutation(async ({ ctx, input }) => {
          enforceLimit(exportLimiter, ctx.user.id, "cover export");
          try { const fonts: CoverFont[] = input.fonts.map((font) => ({ id: font.id, family: font.family, bytes: Buffer.from(font.bytesBase64, "base64"), permitted: font.permitted })); const result = await composeCoverExport(db, storage, ctx.user.id, input.projectId, { ...input, fonts }); recordWorkflowEvent(ctx.user.id, input.projectId, "cover_export", String((result as { id?: string }).id ?? "created"), "export_created"); return result; }
          catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Full-wrap cover export could not be composed." }); }
        }),
        createFinalPackage: protectedProcedure.input(finalExportInput).mutation(async ({ ctx, input }) => { enforceLimit(exportLimiter, ctx.user.id, "final export"); try { const result = await createFinalExport(db, storage, ctx.user.id, input as FinalExportInput); recordWorkflowEvent(ctx.user.id, input.projectId, "export_package", result.exportPackageId, "export_created"); return result; } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Final export could not be created." }); } }),
        listFinalPackages: protectedProcedure.input(projectIdInput).query(async ({ ctx, input }) => { if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." }); const rows = db.prepare(`SELECT id, frozen_project_version AS frozenProjectVersion, COALESCE(kdp_preflight_run_id, validation_run_id) AS validationRunId, status, artifact_hashes_json AS artifactHashesJson, expires_at AS expiresAt, retention_status AS retentionStatus, created_at AS createdAt, zip_storage_reference AS zipReference FROM export_packages WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC`).all(ctx.user.id, input.projectId) as Array<Record<string, unknown>>; return Promise.all(rows.map(async (row) => ({ id: String(row.id), frozenProjectVersion: String(row.frozenProjectVersion ?? ""), validationRunId: String(row.validationRunId ?? ""), status: String(row.status), artifactHashes: JSON.parse(String(row.artifactHashesJson ?? "{}")), expiresAt: row.expiresAt ? String(row.expiresAt) : null, retentionStatus: String(row.retentionStatus), createdAt: String(row.createdAt), zipAccessUrl: row.zipReference && row.retentionStatus !== "expired" && (!row.expiresAt || new Date(String(row.expiresAt)).getTime() > Date.now()) ? await storage.createAccessUrl(String(row.zipReference), 900) : null }))); }),
        latestInterior: protectedProcedure.input(projectIdInput).query(async ({ ctx, input }) => {
          const run = db.prepare(`SELECT * FROM interior_export_runs WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1`).get(ctx.user.id, input.projectId) as Record<string, unknown> | undefined;
          if (!run) return null;
          return { id: String(run.id), status: String(run.status), pageCount: Number(run.page_count), blockingIssueCount: Number(run.blocking_issue_count), warningCount: Number(run.warning_count), finalPdfAccessUrl: run.interior_pdf_storage_reference ? await storage.createAccessUrl(String(run.interior_pdf_storage_reference), 900) : null, previewPdfAccessUrl: await storage.createAccessUrl(String(run.preview_pdf_storage_reference), 900), manifestAccessUrl: await storage.createAccessUrl(String(run.layout_manifest_storage_reference), 900), preflightAccessUrl: await storage.createAccessUrl(String(run.preflight_report_storage_reference), 900) };
        }),
      }),
      quality: router({
        generated: protectedProcedure.input(z.object({ assetId: z.string().min(1) })).query(({ ctx, input }) => {
          const asset = getGeneratedAssetForUser(db, ctx.user.id, input.assetId);
          if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Generated asset not found." });
          return getQualityResultForAsset(db, ctx.user.id, input.assetId, "generated");
        }),
        reference: protectedProcedure.input(z.object({ referenceId: z.string().min(1) })).query(({ ctx, input }) => {
          const reference = getReferenceAssetForUser(db, ctx.user.id, input.referenceId);
          if (!reference) throw new TRPCError({ code: "NOT_FOUND", message: "Reference asset not found." });
          return getQualityResultForAsset(db, ctx.user.id, input.referenceId, "reference");
        }),
      }),
      audit: router({
        list: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => {
          if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          return listAuditEvents(db, ctx.user.id, input.projectId);
        }),
      }),
    }),
    references: router({
      list: protectedProcedure.input(projectIdInput).query(async ({ ctx, input }) => {
        if (!getProjectForUser(db, ctx.user.id, input.projectId)) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
        const references = listReferenceAssets(db, ctx.user.id, input.projectId);
          return Promise.all(references.map(async (reference) => {
          const { storageKey: _storageKey, ...safeReference } = reference;
          return { ...safeReference, accessUrl: await storage.createAccessUrl(reference.storageKey, 15 * 60), quality: getQualityResultForAsset(db, ctx.user.id, reference.id, "reference") };
        }));
      }),
      upload: protectedProcedure.input(z.object({
        projectId: z.string().min(1),
        pagePlanId: z.string().min(1).optional(),
        referenceKind: z.enum(referenceKinds),
        originalFilename: z.string().trim().min(1).max(255),
        declaredMimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
        provenanceDeclaration: z.enum(provenanceDeclarations),
        rightsAttestation: z.literal(true),
        bytesBase64: z.string().min(1).max(14_000_000),
        replacesId: z.string().min(1).optional(),
      })).mutation(async ({ ctx, input }) => {
        enforceLimit(uploadLimiter, ctx.user.id, "upload");
        let bytes: Buffer;
        try {
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.bytesBase64) || input.bytesBase64.length % 4 === 1) throw new Error("invalid encoding");
          bytes = Buffer.from(input.bytesBase64, "base64");
          if (!bytes.length) throw new Error("empty encoding");
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded image encoding is invalid." });
        }
        try {
          const reference = await uploadReferenceAsset(db, storage, ctx.user.id, { ...input, bytes }, referenceLimits);
          const { storageKey: _storageKey, ...safeReference } = reference;
          return { ...safeReference, accessUrl: await storage.createAccessUrl(reference.storageKey, 15 * 60) };
        } catch (error) {
          const knownMessages = [
            "Project not found.",
            "Page plan not found.",
            "Reference to replace is unavailable.",
            "Rights attestation is required",
            "Unsupported visual reference type.",
            "The visual reference is empty.",
            "The visual reference exceeds the configured file-size limit.",
            "The file content does not match PNG, JPEG, or WebP.",
            "The visual reference has no readable dimensions.",
            "The visual reference exceeds the configured pixel-dimension limit.",
            "The visual reference exceeds the configured pixel-count limit.",
            "The visual reference is corrupted or unsafe to decode.",
          ];
          const rawMessage = error instanceof Error ? error.message : "";
          const message = knownMessages.find((candidate) => rawMessage === candidate || rawMessage.startsWith(candidate)) ?? "The visual reference could not be stored safely.";
          throw new TRPCError({ code: "BAD_REQUEST", message });
        }
      }),
      delete: protectedProcedure.input(z.object({ referenceId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
        const reference = getReferenceAssetForUser(db, ctx.user.id, input.referenceId);
        if (!reference) throw new TRPCError({ code: "NOT_FOUND", message: "Visual reference not found." });
        try {
          const deleted = await deleteReferenceAssetForUser(db, storage, ctx.user.id, input.referenceId);
          if (!deleted) throw new Error("not found");
          return { ok: true };
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The visual reference could not be deleted safely." });
        }
      }),
      canUseForGeneration: protectedProcedure.input(z.object({ referenceId: z.string().min(1) })).query(({ ctx, input }) => {
        try {
          const reference = assertReferenceCanBeUsedForGeneration(db, ctx.user.id, input.referenceId);
          return { canUse: true as const, referenceId: reference.id };
        } catch {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Rights attestation is required before using this visual reference for generation." });
        }
      }),
    }),
    project: router({
      list: protectedProcedure.query(({ ctx }) => listProjects(db, ctx.user.id)),
      get: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => {
        const project = getProjectForUser(db, ctx.user.id, input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
        }
        return project;
      }),
      create: protectedProcedure.input(projectInput).mutation(({ ctx, input }) => {
        const id = crypto.randomUUID();
        const project = createProject(db, ctx.user.id, { id, ...input });
        recordWorkflowEvent(ctx.user.id, id, "book_project", id, "project_created");
        return project;
      }),
      update: protectedProcedure
        .input(projectIdInput.extend(projectInput.partial().shape))
        .mutation(({ ctx, input }) => {
          const project = updateProjectForUser(db, ctx.user.id, input.projectId, {
            name: input.name,
            brief: input.brief,
          });
          if (!project) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          }
          return project;
        }),
      remove: protectedProcedure.input(projectIdInput).mutation(async ({ ctx, input }) => {
        const result = deleteProjectDataForUser(db, ctx.user.id, input.projectId);
        if (!result.removed) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
        const outcomes = await Promise.allSettled(result.storageKeys.map((key) => storage.delete(key)));
        const failedStorageDeletes = outcomes.filter((outcome) => outcome.status === "rejected").length;
        if (failedStorageDeletes) console.error("Project private-storage cleanup incomplete", { projectId: "[REDACTED]", failedStorageDeletes });
        return { ok: true, storageCleanup: failedStorageDeletes === 0 ? "complete" : "retention_retry_required" };
      }),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
