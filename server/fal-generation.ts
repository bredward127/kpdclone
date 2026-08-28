import crypto from "node:crypto";
import type { AppDatabase } from "./db";
import { getProjectForUser } from "./db";
import { createAuditEvent, getGenerationJobForUser, getGeneratedAssetForUser } from "./db-studio";
import { assertNoBlockingLint, getPromptVersionForUser } from "./prompt-composer";
import { classifyContentPolicy, recordContentPolicyReview } from "./publishing";
import { getFalModel } from "./fal-models";
import { validateReferenceImage, getReferenceValidationLimits } from "./reference-validation";
import { analyzeAssetQuality } from "./asset-quality";
import type { PrivateStorage } from "./storage";
import { FalProviderError, type FalImageOutput, type FalQueueStatus, type FalWebhookPayload } from "./fal-queue";

export type LocalGenerationStatus = "draft" | "queued" | "in_progress" | "completed" | "failed" | "cancelled" | "cancellation_requested";
export type ErrorClassification = "validation" | "provider_http" | "provider_timeout" | "provider_invalid_response" | "provider_cancelled" | "provider_not_found" | "result_download_expired" | "result_download_rejected" | "internal";

type ExpectedOutputConstraints = { mimeTypes?: string[]; maxPixels?: number; maxWidthPx?: number; maxHeightPx?: number; aspectRatio?: string };

export type GenerationAdapter = {
  submit(endpoint: string, input: Record<string, unknown>, options?: { webhookUrl?: string }): Promise<{ requestId: string; gatewayRequestId: string | null; responseUrl: string | null; statusUrl: string | null; cancelUrl: string | null }>;
  status(endpoint: string, requestId: string): Promise<{ status: FalQueueStatus; requestId: string; error?: string; errorType?: string }>;
  result(endpoint: string, requestId: string): Promise<Record<string, unknown>>;
  cancel(endpoint: string, requestId: string): Promise<"cancellation_requested" | "already_completed" | "not_found">;
  downloadImage(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string }>;
};

export type GenerationJobSummary = {
  localJobId: string;
  falRequestId: string;
  status: LocalGenerationStatus;
  providerStatus: string;
  retryCount: number;
};

function now(): string { return new Date().toISOString(); }
function json(value: unknown): string { return JSON.stringify(value ?? {}); }
function classify(error: unknown): ErrorClassification {
  if (error instanceof FalProviderError) return error.classification;
  return "internal";
}
function safeErrorMessage(error: unknown): string {
  if (error instanceof FalProviderError) return error.message;
  return "The generation request could not be completed safely.";
}

function setJob(db: AppDatabase, userId: string, jobId: string, values: Record<string, unknown>): void {
  const assignments = Object.keys(values).map((key) => `${key} = @${key}`).join(", ");
  db.prepare(`UPDATE generation_jobs SET ${assignments}, updated_at = @updatedAt WHERE id = @jobId AND user_id = @userId`).run({ ...values, updatedAt: now(), jobId, userId });
}

function findJobByFalRequestId(db: AppDatabase, falRequestId: string): { id: string; userId: string; projectId: string; pagePlanId: string | null; promptVersionId: string | null; generationEndpoint: string; localStatus: LocalGenerationStatus; webhookProcessedAt: string | null; expectedOutputConstraintsJson: string; retryCount: number; requestKind: "initial" | "variation" | "prompt_edit"; sourceAssetId: string | null } | null {
  return db.prepare(`SELECT id, user_id AS userId, project_id AS projectId, page_plan_id AS pagePlanId,
      prompt_version_id AS promptVersionId, generation_endpoint AS generationEndpoint,
      local_status AS localStatus, webhook_processed_at AS webhookProcessedAt,
      expected_output_constraints_json AS expectedOutputConstraintsJson, retry_count AS retryCount,
      request_kind AS requestKind, source_asset_id AS sourceAssetId
      FROM generation_jobs WHERE fal_request_id = ?`).get(falRequestId) as ReturnType<typeof findJobByFalRequestId>;
}

function findAssetForJob(db: AppDatabase, userId: string, jobId: string): { id: string; storageReference: string; status: string } | null {
  return db.prepare(`SELECT id, storage_reference AS storageReference, status FROM generated_assets WHERE user_id = ? AND generation_job_id = ? ORDER BY created_at DESC LIMIT 1`).get(userId, jobId) as { id: string; storageReference: string; status: string } | null;
}

function extractFirstImage(payload: Record<string, unknown>): FalImageOutput {
  const images = Array.isArray(payload.images) ? payload.images : [];
  const image = images[0];
  if (!image || typeof image !== "object" || typeof (image as Record<string, unknown>).url !== "string") throw new FalProviderError("FAL returned no usable image result.", { classification: "provider_invalid_response", retryable: false });
  const value = image as Record<string, unknown>;
  return { url: value.url as string, content_type: typeof value.content_type === "string" ? value.content_type : undefined, file_name: typeof value.file_name === "string" ? value.file_name : undefined, width: typeof value.width === "number" ? value.width : undefined, height: typeof value.height === "number" ? value.height : undefined };
}

export function createFalGenerationService(dependencies: { adapter: GenerationAdapter; storage: PrivateStorage; webhookUrl?: string; maxOutputBytes?: number; validationLimits?: ReturnType<typeof getReferenceValidationLimits>; maxActivePerUser?: number; maxActivePerProject?: number; modelApproval?: (endpointId: string) => boolean }) {
  const maxOutputBytes = dependencies.maxOutputBytes ?? dependencies.validationLimits?.maxBytes ?? getReferenceValidationLimits().maxBytes;
  const validationLimits = dependencies.validationLimits ?? getReferenceValidationLimits();
  const maxActivePerUser = dependencies.maxActivePerUser ?? 3;
  const maxActivePerProject = dependencies.maxActivePerProject ?? 2;
  const modelApproval = dependencies.modelApproval ?? ((endpointId: string) => getFalModel(endpointId)?.active === true);

  function enforceConcurrency(db: AppDatabase, userId: string, projectId: string): void {
    const userActive = db.prepare(`SELECT COUNT(*) AS count FROM generation_jobs WHERE user_id = ? AND local_status IN ('queued', 'in_progress', 'cancellation_requested')`).get(userId) as { count: number };
    const projectActive = db.prepare(`SELECT COUNT(*) AS count FROM generation_jobs WHERE user_id = ? AND project_id = ? AND local_status IN ('queued', 'in_progress', 'cancellation_requested')`).get(userId, projectId) as { count: number };
    if (userActive.count >= maxActivePerUser) throw new Error(`Per-user generation concurrency limit reached (${maxActivePerUser}). Stop queued work or wait for a job to finish.`);
    if (projectActive.count >= maxActivePerProject) throw new Error(`Per-project generation concurrency limit reached (${maxActivePerProject}). Stop queued work or wait for a job to finish.`);
  }

  async function ingestResult(db: AppDatabase, job: { id: string; userId: string; projectId: string; pagePlanId: string | null; promptVersionId: string | null; localStatus: LocalGenerationStatus; webhookProcessedAt: string | null; expectedOutputConstraintsJson?: string; requestKind?: "initial" | "variation" | "prompt_edit"; sourceAssetId?: string | null }, payload: Record<string, unknown>, providerStatus: string): Promise<{ assetId: string; jobId: string; duplicate: boolean }> {
    const existing = findAssetForJob(db, job.userId, job.id);
    if (existing) return { assetId: existing.id, jobId: job.id, duplicate: true };
    const output = extractFirstImage(payload);
    const downloaded = await dependencies.adapter.downloadImage(output.url, maxOutputBytes);
    const validated = await validateReferenceImage(downloaded.bytes, downloaded.contentType, validationLimits);
    const constraints = JSON.parse(job.expectedOutputConstraintsJson ?? "{}") as ExpectedOutputConstraints;
    if (constraints.mimeTypes?.length && !constraints.mimeTypes.includes(validated.mimeType)) throw new FalProviderError("FAL result MIME type does not meet the expected output constraints.", { classification: "result_download_rejected", retryable: false });
    if (constraints.maxPixels && validated.widthPx * validated.heightPx > constraints.maxPixels) throw new FalProviderError("FAL result exceeds the expected pixel-count constraint.", { classification: "result_download_rejected", retryable: false });
    if (constraints.maxWidthPx && validated.widthPx > constraints.maxWidthPx) throw new FalProviderError("FAL result exceeds the expected width constraint.", { classification: "result_download_rejected", retryable: false });
    if (constraints.maxHeightPx && validated.heightPx > constraints.maxHeightPx) throw new FalProviderError("FAL result exceeds the expected height constraint.", { classification: "result_download_rejected", retryable: false });
    const extension = validated.mimeType === "image/jpeg" ? "jpg" : validated.mimeType.slice("image/".length);
    const storageKey = `generated/${job.userId}/${job.projectId}/${job.id}/${validated.contentHashSha256}.${extension}`;
    await dependencies.storage.put(storageKey, downloaded.bytes, validated.mimeType);
    try {
      const assetId = crypto.randomUUID();
      const createdAt = now();
      db.transaction(() => {
        db.prepare(`INSERT INTO generated_assets
          (id, user_id, project_id, page_plan_id, generation_job_id, prompt_version_id,
           storage_reference, mime_type, width_px, height_px, byte_size, checksum_sha256,
           ai_provenance_classification, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_generated', 'completed', ?, ?)`).run(assetId, job.userId, job.projectId, job.pagePlanId, job.id, job.promptVersionId, storageKey, validated.mimeType, validated.widthPx, validated.heightPx, validated.byteSize, validated.contentHashSha256, createdAt, createdAt);
        if (job.requestKind && job.requestKind !== "initial" && job.sourceAssetId) {
          db.prepare(`INSERT INTO asset_variants
            (id, user_id, project_id, generated_asset_id, source_asset_id, variant_kind,
             storage_reference, mime_type, width_px, height_px, byte_size, checksum_sha256, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'alternate', ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`).run(crypto.randomUUID(), job.userId, job.projectId, assetId, job.sourceAssetId, storageKey, validated.mimeType, validated.widthPx, validated.heightPx, validated.byteSize, validated.contentHashSha256, createdAt, createdAt);
        }
        setJob(db, job.userId, job.id, { local_status: "completed", status: "completed", provider_status: providerStatus, provider_completed_at: createdAt, webhook_processed_at: createdAt, error_classification: null, error_code: null, error_message: null });
      })();
      const project = getProjectForUser(db, job.userId, job.projectId);
      await analyzeAssetQuality(db, {
        userId: job.userId,
        projectId: job.projectId,
        generatedAssetId: assetId,
        checksumSha256: validated.contentHashSha256,
        bytes: downloaded.bytes,
        declaredMimeType: validated.mimeType,
        allowAlpha: JSON.parse(job.expectedOutputConstraintsJson ?? "{}").allowAlpha === true,
        coloringBook: project?.bookType === "activity_book",
      });
      return { assetId, jobId: job.id, duplicate: false };
    } catch (error) {
      await dependencies.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async function submit(db: AppDatabase, userId: string, input: { projectId: string; pagePlanId: string; promptVersionId: string; generationModel: string; generationEndpoint: string; aspectRatio: string; seed?: number; referenceAssetIds: string[]; expectedOutputConstraints: Record<string, unknown>; idempotencyKey?: string; requestKind?: "initial" | "variation" | "prompt_edit"; sourceAssetId?: string }): Promise<GenerationJobSummary> {
    if (!getProjectForUser(db, userId, input.projectId)) throw new Error("Project not found.");
    if (input.idempotencyKey) {
      const existing = db.prepare(`SELECT id FROM generation_jobs WHERE user_id = ? AND idempotency_key = ?`).get(userId, input.idempotencyKey) as { id: string } | undefined;
      if (existing) {
        const saved = getGenerationJobForUser(db, userId, existing.id)!;
        return { localJobId: saved.id, falRequestId: saved.falRequestId ?? "", status: saved.localStatus, providerStatus: saved.providerStatus ?? "", retryCount: saved.retryCount };
      }
    }
    enforceConcurrency(db, userId, input.projectId);
    const prompt = getPromptVersionForUser(db, userId, input.promptVersionId);
    if (!prompt || prompt.projectId !== input.projectId || prompt.pagePlanId !== input.pagePlanId) throw new Error("Frozen prompt version not found.");
    if (!modelApproval(input.generationEndpoint)) throw new Error("The selected model configuration is not active and administrator-approved.");
    if (prompt.status !== "approved" || !prompt.contentHashSha256 || !prompt.prompt) throw new Error("Prompt version is not frozen and cannot be submitted.");
    // Server-side and not dismissable from the client: a blocking lint stops the
    // request here even if the version was frozen before the rule was tightened.
    assertNoBlockingLint(prompt.lintWarnings);
    const policyText = `${prompt.prompt}\n${prompt.negativePrompt}`;
    const policyDecision = classifyContentPolicy(policyText);
    recordContentPolicyReview(db, userId, input.projectId, "prompt", input.promptVersionId, policyText, false);
    if (policyDecision.status === "blocked") throw new Error(`Content policy blocked this FAL request: ${policyDecision.reasons.join("; ")}`);
    if (policyDecision.status === "needs_human_review") throw new Error(`This FAL request needs human review before submission: ${policyDecision.reasons.join("; ")}`);
    if (prompt.generationEndpoint !== input.generationEndpoint || prompt.generationModel !== input.generationModel || prompt.aspectRatio !== input.aspectRatio || (prompt.seed ?? null) !== (input.seed ?? null)) throw new Error("Generation parameters do not match the frozen prompt version.");
    if (input.sourceAssetId) {
      const source = getGeneratedAssetForUser(db, userId, input.sourceAssetId);
      if (!source || source.projectId !== input.projectId || source.pagePlanId !== input.pagePlanId || source.status !== "approved") throw new Error("Only an approved asset in this page can be used as variation lineage.");
    }
    const jobId = crypto.randomUUID();
    const createdAt = now();
    const modelInputs = { prompt: prompt.prompt, negative_prompt: prompt.negativePrompt, aspect_ratio: prompt.aspectRatio, seed: prompt.seed, reference_asset_ids: prompt.referenceAssetIds, model: prompt.generationModel };
    db.prepare(`INSERT INTO generation_jobs
      (id, user_id, project_id, page_plan_id, prompt_version_id, generation_model, generation_endpoint,
       seed, status, local_status, model_inputs_json, expected_output_constraints_json, idempotency_key, request_kind, source_asset_id, queued_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'draft', ?, ?, ?, ?, ?, NULL, ?, ?)`).run(jobId, userId, input.projectId, input.pagePlanId, input.promptVersionId, prompt.generationModel, prompt.generationEndpoint, prompt.seed, json(modelInputs), json(input.expectedOutputConstraints), input.idempotencyKey ?? null, input.requestKind ?? "initial", input.sourceAssetId ?? null, createdAt, createdAt);
    try {
      const submitted = await dependencies.adapter.submit(prompt.generationEndpoint, modelInputs, dependencies.webhookUrl ? { webhookUrl: dependencies.webhookUrl } : undefined);
      const queuedAt = now();
      setJob(db, userId, jobId, { fal_request_id: submitted.requestId, provider_job_id: submitted.requestId, local_status: "queued", status: "queued", provider_status: "IN_QUEUE", queued_at: queuedAt });
      return { localJobId: jobId, falRequestId: submitted.requestId, status: "queued", providerStatus: "IN_QUEUE", retryCount: 0 };
    } catch (error) {
      setJob(db, userId, jobId, { local_status: "failed", status: "failed", error_classification: classify(error), error_message: safeErrorMessage(error), completed_at: now() });
      throw error;
    }
  }

  async function cancel(db: AppDatabase, userId: string, jobId: string): Promise<GenerationJobSummary> {
    const job = getGenerationJobForUser(db, userId, jobId);
    if (!job || !job.falRequestId) throw new Error("Generation job not found.");
    if (["completed", "failed", "cancelled"].includes(job.localStatus)) return { localJobId: job.id, falRequestId: job.falRequestId, status: job.localStatus, providerStatus: job.providerStatus ?? "", retryCount: job.retryCount };
    setJob(db, userId, jobId, { local_status: "cancellation_requested", cancellation_requested_at: now() });
    const result = await dependencies.adapter.cancel(job.generationEndpoint, job.falRequestId);
    if (result === "not_found") setJob(db, userId, jobId, { local_status: "cancelled", status: "cancelled", provider_status: "NOT_FOUND", completed_at: now() });
    else if (result === "cancellation_requested") setJob(db, userId, jobId, { provider_status: "CANCELLATION_REQUESTED" });
    else setJob(db, userId, jobId, { provider_status: "ALREADY_COMPLETED" });
    const updated = getGenerationJobForUser(db, userId, jobId)!;
    return { localJobId: updated.id, falRequestId: updated.falRequestId!, status: updated.localStatus, providerStatus: updated.providerStatus ?? "", retryCount: updated.retryCount };
  }

  async function reconcile(db: AppDatabase, userId: string, jobId: string): Promise<GenerationJobSummary> {
    const job = getGenerationJobForUser(db, userId, jobId);
    if (!job || !job.falRequestId) throw new Error("Generation job not found.");
    if (job.localStatus === "completed") return { localJobId: job.id, falRequestId: job.falRequestId, status: job.localStatus, providerStatus: job.providerStatus ?? "", retryCount: job.retryCount };
    const status = await dependencies.adapter.status(job.generationEndpoint, job.falRequestId);
    if (status.status === "IN_QUEUE") setJob(db, userId, job.id, { local_status: "queued", status: "queued", provider_status: status.status });
    if (status.status === "IN_PROGRESS") setJob(db, userId, job.id, { local_status: "in_progress", status: "in_progress", provider_status: status.status, started_at: job.startedAt ?? now() });
    if (status.status === "COMPLETED") {
      setJob(db, userId, job.id, { local_status: "in_progress", status: "in_progress", provider_status: status.status });
      try {
        const payload = await dependencies.adapter.result(job.generationEndpoint, job.falRequestId);
        await ingestResult(db, job, payload, status.status);
      } catch (error) {
        setJob(db, userId, job.id, { local_status: "failed", status: "failed", provider_status: status.status, error_classification: classify(error), error_message: safeErrorMessage(error), completed_at: now() });
      }
    }
    const updated = getGenerationJobForUser(db, userId, job.id)!;
    return { localJobId: updated.id, falRequestId: updated.falRequestId!, status: updated.localStatus, providerStatus: updated.providerStatus ?? "", retryCount: updated.retryCount };
  }

  async function retry(db: AppDatabase, userId: string, jobId: string): Promise<GenerationJobSummary> {
    const job = getGenerationJobForUser(db, userId, jobId);
    if (!job || !job.falRequestId) throw new Error("Generation job not found.");
    if (job.localStatus !== "failed") throw new Error("Only failed generation jobs can be retried.");
    if (job.retryCount >= 3) throw new Error("Generation retry limit reached.");
    const modelInputs = job.modelInputs;
    const submitted = await dependencies.adapter.submit(job.generationEndpoint, modelInputs, dependencies.webhookUrl ? { webhookUrl: dependencies.webhookUrl } : undefined);
    setJob(db, userId, job.id, { fal_request_id: submitted.requestId, provider_job_id: submitted.requestId, local_status: "queued", status: "queued", provider_status: "IN_QUEUE", retry_count: job.retryCount + 1, error_classification: null, error_message: null, queued_at: now(), completed_at: null });
    const updated = getGenerationJobForUser(db, userId, job.id)!;
    return { localJobId: updated.id, falRequestId: updated.falRequestId!, status: updated.localStatus, providerStatus: updated.providerStatus ?? "", retryCount: updated.retryCount };
  }

  async function processWebhook(db: AppDatabase, falPayload: FalWebhookPayload): Promise<{ duplicate: boolean; jobId: string | null; assetId?: string }> {
    const job = findJobByFalRequestId(db, falPayload.request_id);
    if (!job) return { duplicate: false, jobId: null };
    createAuditEvent(db, job.userId, { projectId: job.projectId, actorUserId: job.userId, entityType: "generation_job", entityId: job.id, eventType: "provider_callback", metadataJson: JSON.stringify({ providerStatus: falPayload.status, duplicate: Boolean(job.webhookProcessedAt || job.localStatus === "completed") }) });
    if (job.webhookProcessedAt || job.localStatus === "completed") return { duplicate: true, jobId: job.id, assetId: findAssetForJob(db, job.userId, job.id)?.id };
    if (falPayload.status === "ERROR") {
      setJob(db, job.userId, job.id, { local_status: "failed", status: "failed", provider_status: "ERROR", error_classification: "provider_http", error_message: "FAL reported a generation error.", completed_at: now(), webhook_processed_at: now() });
      return { duplicate: false, jobId: job.id };
    }
    if (!falPayload.payload || typeof falPayload.payload !== "object") {
      setJob(db, job.userId, job.id, { local_status: "failed", status: "failed", provider_status: "OK", error_classification: "provider_invalid_response", error_message: "FAL returned no usable result payload.", completed_at: now(), webhook_processed_at: now() });
      return { duplicate: false, jobId: job.id };
    }
    try {
      const result = await ingestResult(db, job, falPayload.payload as Record<string, unknown>, "OK");
      return { duplicate: result.duplicate, jobId: result.jobId, assetId: result.assetId };
    } catch (error) {
      setJob(db, job.userId, job.id, { local_status: "failed", status: "failed", provider_status: "OK", error_classification: classify(error), error_message: safeErrorMessage(error), completed_at: now(), webhook_processed_at: now() });
      throw error;
    }
  }

  return { submit, cancel, reconcile, retry, processWebhook, ingestResult };
}

export type FalGenerationService = ReturnType<typeof createFalGenerationService>;
