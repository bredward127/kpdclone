import { initTRPC, TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import { clearSession } from "./auth";
import { isFalAdministrator } from "./fal-admin";
import { getFalConnectionStatus, type FalConnectionStatus } from "./fal";
import { createBookBrief, createPagePlan, getBriefForProject, getCoverPlanForUser, getLayoutTemplateForUser, getLatestValidationRun, getPagePlanForUser, insertGenerationJob, listAuditEvents, listExportPackages, listPagePlans, transitionAssetStatus, transitionGenerationJob, updatePageApproval } from "./db-studio";
import { lifecycleStatuses, pageApprovalStates } from "../shared/studio";
import { createLocalPrivateStorage, type PrivateStorage } from "./storage";
import { deleteReferenceAssetForUser, getReferenceAssetForUser, listReferenceAssets, referenceKinds, provenanceDeclarations, assertReferenceCanBeUsedForGeneration, uploadReferenceAsset } from "./reference-assets";
import { getReferenceValidationLimits } from "./reference-validation";
import { falModelRegistry } from "./fal-models";
import { createProject, deleteProjectForUser, getProjectForUser, listProjects, updateProjectForUser, upsertUser, type AppDatabase, type UserRecord } from "./db";

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

export function createAppRouter(
  db: AppDatabase,
  options: {
    falStatus?: () => Promise<FalConnectionStatus>;
    falAdminEnv?: NodeJS.ProcessEnv;
    storage?: PrivateStorage;
  } = {},
) {
  const falStatus = options.falStatus ?? (() => getFalConnectionStatus());
  const falAdminEnv = options.falAdminEnv ?? process.env;
  const storage = options.storage ?? createLocalPrivateStorage();
  const referenceLimits = getReferenceValidationLimits();

  return router({
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
          return createBookBrief(db, ctx.user.id, { id: crypto.randomUUID(), ...input });
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
          return getCoverPlanForUser(db, ctx.user.id, input.projectId);
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
          return { ...safeReference, accessUrl: await storage.createAccessUrl(reference.storageKey, 15 * 60) };
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
        return createProject(db, ctx.user.id, { id, ...input });
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
      remove: protectedProcedure.input(projectIdInput).mutation(({ ctx, input }) => {
        const removed = deleteProjectForUser(db, ctx.user.id, input.projectId);
        if (!removed) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
        }
        return { ok: true };
      }),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
