import crypto from "node:crypto";
import type { AppDatabase } from "./db";
import { canTransition } from "../shared/studio";
import type { LifecycleStatus, PageApprovalState, AiProvenanceClassification } from "../shared/studio";

export type BookBriefRecord = {
  id: string;
  userId: string;
  projectId: string;
  briefText: string;
  bookType: string;
  audience: string;
  visualStyleAnchors: string;
  characterBible: string;
  /** Recurring objects and locations, repeated verbatim into every page prompt. */
  propAndSettingBible: string;
  negativePrompt: string;
  version: number;
  status: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export type PagePlanRecord = {
  id: string;
  userId: string;
  projectId: string;
  pageNumber: number;
  spreadNumber: number | null;
  sceneDirection: string;
  pageText: string;
  approvalState: PageApprovalState;
  rejectionReason: string | null;
  status: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export function getBriefForProject(db: AppDatabase, userId: string, projectId: string): BookBriefRecord | null {
  return (
    db
      .prepare(
        `SELECT id, user_id AS userId, project_id AS projectId, brief_text AS briefText,
                book_type AS bookType, audience, visual_style_anchors AS visualStyleAnchors,
                character_bible AS characterBible, prop_and_setting_bible AS propAndSettingBible, negative_prompt AS negativePrompt,
                version, status, created_at AS createdAt, updated_at AS updatedAt
         FROM book_briefs
         WHERE user_id = ? AND project_id = ?
         ORDER BY version DESC LIMIT 1`,
      )
      .get(userId, projectId) as BookBriefRecord | undefined
  ) ?? null;
}

export function listPagePlans(db: AppDatabase, userId: string, projectId: string): PagePlanRecord[] {
  return db
    .prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, page_number AS pageNumber,
              spread_number AS spreadNumber, scene_direction AS sceneDirection,
              page_text AS pageText, approval_state AS approvalState,
              rejection_reason AS rejectionReason, status,
              created_at AS createdAt, updated_at AS updatedAt
       FROM page_plans
       WHERE user_id = ? AND project_id = ?
       ORDER BY page_number ASC`,
    )
    .all(userId, projectId) as PagePlanRecord[];
}

export function updatePageApproval(
  db: AppDatabase,
  userId: string,
  pagePlanId: string,
  input: { approvalState: PageApprovalState; rejectionReason?: string },
): boolean {
  if (input.approvalState === "rejected" && !input.rejectionReason?.trim()) {
    throw new Error("A rejection reason is required when rejecting a page plan.");
  }
  const updatedAt = new Date().toISOString();
  const status: LifecycleStatus = input.approvalState === "rejected" ? "needs_review" : input.approvalState;
  const result = db
    .prepare(
      `UPDATE page_plans
       SET approval_state = @approvalState, rejection_reason = @rejectionReason,
           status = @status, updated_at = @updatedAt
       WHERE id = @pagePlanId AND user_id = @userId`,
    )
    .run({ ...input, status, pagePlanId, userId, updatedAt, rejectionReason: input.rejectionReason ?? null });
  return result.changes === 1;
}

export function createAuditEvent(
  db: AppDatabase,
  userId: string,
  input: {
    projectId?: string;
    actorUserId: string;
    entityType: string;
    entityId: string;
    eventType: string;
    fromStatus?: LifecycleStatus;
    toStatus?: LifecycleStatus;
    metadataJson?: string;
  },
): void {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_events (id, user_id, project_id, actor_user_id, entity_type, entity_id, event_type, from_status, to_status, metadata_json, created_at, updated_at)
     VALUES (@id, @userId, @projectId, @actorUserId, @entityType, @entityId, @eventType, @fromStatus, @toStatus, @metadataJson, @now, @now)`,
  ).run({
    ...input,
    id,
    userId,
    now,
    projectId: input.projectId ?? null,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    metadataJson: input.metadataJson ?? "{}",
  });
}

export type GenerationJobRecord = {
  id: string;
  userId: string;
  projectId: string;
  pagePlanId: string | null;
  promptVersionId: string | null;
  providerJobId: string | null;
  falRequestId: string | null;
  generationModel: string;
  generationEndpoint: string;
  seed: number | null;
  status: LifecycleStatus;
  localStatus: "draft" | "queued" | "in_progress" | "completed" | "failed" | "cancelled" | "cancellation_requested";
  providerStatus: string | null;
  modelInputs: Record<string, unknown>;
  expectedOutputConstraints: Record<string, unknown>;
  retryCount: number;
  errorClassification: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancellationRequestedAt: string | null;
  webhookProcessedAt: string | null;
  providerCompletedAt: string | null;
  idempotencyKey: string | null;
  requestKind: "initial" | "variation" | "prompt_edit";
  sourceAssetId: string | null;
  userCancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GeneratedAssetRecord = {
  id: string;
  userId: string;
  projectId: string;
  pagePlanId: string | null;
  generationJobId: string | null;
  promptVersionId: string | null;
  storageReference: string;
  mimeType: string;
  widthPx: number | null;
  heightPx: number | null;
  byteSize: number | null;
  checksumSha256: string | null;
  aiProvenanceClassification: AiProvenanceClassification;
  status: LifecycleStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseGenerationJob(row: Record<string, unknown> | undefined): GenerationJobRecord | null {
  if (!row) return null;
  return {
    ...row,
    modelInputs: JSON.parse(String(row.modelInputsJson ?? "{}")),
    expectedOutputConstraints: JSON.parse(String(row.expectedOutputConstraintsJson ?? "{}")),
  } as GenerationJobRecord;
}

export function getGenerationJobForUser(db: AppDatabase, userId: string, jobId: string): GenerationJobRecord | null {
  const row = db
    .prepare(
        `SELECT id, user_id AS userId, project_id AS projectId, page_plan_id AS pagePlanId,
                prompt_version_id AS promptVersionId, provider_job_id AS providerJobId,
                fal_request_id AS falRequestId, generation_model AS generationModel,
                generation_endpoint AS generationEndpoint, seed, status, local_status AS localStatus,
                provider_status AS providerStatus, model_inputs_json AS modelInputsJson,
                expected_output_constraints_json AS expectedOutputConstraintsJson,
                retry_count AS retryCount, error_classification AS errorClassification,
                error_code AS errorCode, error_message AS errorMessage,
                queued_at AS queuedAt, started_at AS startedAt, completed_at AS completedAt,
                cancellation_requested_at AS cancellationRequestedAt,
                webhook_processed_at AS webhookProcessedAt, provider_completed_at AS providerCompletedAt,
                idempotency_key AS idempotencyKey, request_kind AS requestKind,
                source_asset_id AS sourceAssetId, user_cancelled_at AS userCancelledAt,
                created_at AS createdAt, updated_at AS updatedAt
         FROM generation_jobs WHERE id = ? AND user_id = ?`,
      )
      .get(jobId, userId) as Record<string, unknown> | undefined;
  return parseGenerationJob(row);
}

export function getGeneratedAssetForUser(db: AppDatabase, userId: string, assetId: string): GeneratedAssetRecord | null {
  return (
    db
      .prepare(
        `SELECT id, user_id AS userId, project_id AS projectId, page_plan_id AS pagePlanId,
                generation_job_id AS generationJobId, prompt_version_id AS promptVersionId,
                storage_reference AS storageReference, mime_type AS mimeType,
                width_px AS widthPx, height_px AS heightPx, byte_size AS byteSize,
                checksum_sha256 AS checksumSha256,
                ai_provenance_classification AS aiProvenanceClassification,
                status, rejection_reason AS rejectionReason,
                created_at AS createdAt, updated_at AS updatedAt
         FROM generated_assets WHERE id = ? AND user_id = ?`,
      )
      .get(assetId, userId) as GeneratedAssetRecord | undefined
  ) ?? null;
}

export function transitionGenerationJob(
  db: AppDatabase,
  userId: string,
  jobId: string,
  toStatus: LifecycleStatus,
  actorUserId = userId,
): GenerationJobRecord | null {
  const current = getGenerationJobForUser(db, userId, jobId);
  if (!current) return null;
  if (!canTransition(current.status, toStatus)) {
    throw new Error(`Invalid generation job transition from ${current.status} to ${toStatus}`);
  }

  const now = new Date().toISOString();
  const timestamps = {
    queuedAt: toStatus === "queued" ? now : current.queuedAt,
    startedAt: toStatus === "in_progress" ? now : current.startedAt,
    completedAt: ["completed", "failed", "cancelled"].includes(toStatus) ? now : current.completedAt,
  };
  db.transaction(() => {
    db.prepare(
      `UPDATE generation_jobs
       SET status = @toStatus, queued_at = @queuedAt, started_at = @startedAt,
           completed_at = @completedAt, updated_at = @now
       WHERE id = @jobId AND user_id = @userId`,
    ).run({ toStatus, jobId, userId, now, ...timestamps });
    createAuditEvent(db, userId, {
      projectId: current.projectId,
      actorUserId,
      entityType: "generation_job",
      entityId: jobId,
      eventType: "status_changed",
      fromStatus: current.status,
      toStatus,
    });
  })();

  return getGenerationJobForUser(db, userId, jobId);
}

export function transitionAssetStatus(
  db: AppDatabase,
  userId: string,
  assetId: string,
  toStatus: LifecycleStatus,
  actorUserId = userId,
): GeneratedAssetRecord | null {
  const current = getGeneratedAssetForUser(db, userId, assetId);
  if (!current) return null;
  if (!canTransition(current.status, toStatus)) {
    throw new Error(`Invalid generated asset transition from ${current.status} to ${toStatus}`);
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE generated_assets SET status = @toStatus, updated_at = @now
       WHERE id = @assetId AND user_id = @userId`,
    ).run({ toStatus, assetId, userId, now });
    createAuditEvent(db, userId, {
      projectId: current.projectId,
      actorUserId,
      entityType: "generated_asset",
      entityId: assetId,
      eventType: "status_changed",
      fromStatus: current.status,
      toStatus,
    });
  })();

  return getGeneratedAssetForUser(db, userId, assetId);
}


export function insertGenerationJob(
  db: AppDatabase,
  userId: string,
  input: {
    id: string;
    projectId: string;
    pagePlanId?: string;
    promptVersionId?: string;
    generationModel: string;
    generationEndpoint: string;
    seed?: number;
  },
): GenerationJobRecord {
  db.prepare(
    `INSERT INTO generation_jobs
      (id, user_id, project_id, page_plan_id, prompt_version_id, generation_model, generation_endpoint, seed)
     VALUES (@id, @userId, @projectId, @pagePlanId, @promptVersionId, @generationModel, @generationEndpoint, @seed)`,
  ).run({ ...input, userId, pagePlanId: input.pagePlanId ?? null, promptVersionId: input.promptVersionId ?? null, seed: input.seed ?? null });
  return getGenerationJobForUser(db, userId, input.id)!;
}

export function createBookBrief(
  db: AppDatabase,
  userId: string,
  input: {
    id: string;
    projectId: string;
    briefText: string;
    bookType: string;
    audience: string;
    visualStyleAnchors: string;
    characterBible: string;
    propAndSettingBible?: string;
    negativePrompt: string;
  },
): BookBriefRecord {
  const previous = getBriefForProject(db, userId, input.projectId);
  const version = (previous?.version ?? 0) + 1;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO book_briefs
      (id, user_id, project_id, brief_text, book_type, audience, visual_style_anchors, character_bible, prop_and_setting_bible, negative_prompt, version, created_at, updated_at)
     VALUES (@id, @userId, @projectId, @briefText, @bookType, @audience, @visualStyleAnchors, @characterBible, @propAndSettingBible, @negativePrompt, @version, @now, @now)`,
  ).run({ ...input, propAndSettingBible: input.propAndSettingBible ?? "", userId, version, now });
  return getBriefForProject(db, userId, input.projectId)!;
}

export function getPagePlanForUser(db: AppDatabase, userId: string, pagePlanId: string): PagePlanRecord | null {
  return (
    db
      .prepare(
        `SELECT id, user_id AS userId, project_id AS projectId, page_number AS pageNumber,
                spread_number AS spreadNumber, scene_direction AS sceneDirection,
                page_text AS pageText, approval_state AS approvalState,
                rejection_reason AS rejectionReason, status,
                created_at AS createdAt, updated_at AS updatedAt
         FROM page_plans WHERE id = ? AND user_id = ?`,
      )
      .get(pagePlanId, userId) as PagePlanRecord | undefined
  ) ?? null;
}

export function createPagePlan(
  db: AppDatabase,
  userId: string,
  input: { id: string; projectId: string; pageNumber: number; spreadNumber?: number; sceneDirection: string; pageText: string },
): PagePlanRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO page_plans (id, user_id, project_id, page_number, spread_number, scene_direction, page_text, created_at, updated_at)
     VALUES (@id, @userId, @projectId, @pageNumber, @spreadNumber, @sceneDirection, @pageText, @now, @now)`,
  ).run({ ...input, userId, spreadNumber: input.spreadNumber ?? null, now });
  return getPagePlanForUser(db, userId, input.id)!;
}

export function updatePagePlan(
  db: AppDatabase,
  userId: string,
  pagePlanId: string,
  input: { sceneDirection: string; pageText: string; spreadNumber?: number },
): PagePlanRecord | null {
  const current = getPagePlanForUser(db, userId, pagePlanId);
  if (!current) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE page_plans
     SET scene_direction = @sceneDirection, page_text = @pageText,
         spread_number = @spreadNumber, updated_at = @now
     WHERE id = @pagePlanId AND user_id = @userId`,
  ).run({ pagePlanId, userId, sceneDirection: input.sceneDirection, pageText: input.pageText, spreadNumber: input.spreadNumber ?? current.spreadNumber, now });
  return getPagePlanForUser(db, userId, pagePlanId);
}

/**
 * Remove one page plan. Prompt versions and generated assets reference the page
 * with ON DELETE SET NULL, so their history survives the deletion rather than
 * disappearing with the page.
 */
export function deletePagePlan(db: AppDatabase, userId: string, pagePlanId: string): boolean {
  const result = db.prepare(`DELETE FROM page_plans WHERE id = ? AND user_id = ?`).run(pagePlanId, userId);
  return result.changes > 0;
}

export type CoverPlanRecord = {
  id: string;
  userId: string;
  projectId: string;
  title: string;
  author: string;
  imprint: string;
  trimWidthInches: number;
  trimHeightInches: number;
  bleedInches: number;
  spineWidthInches: number;
  frontCopy: string;
  backCopy: string;
  frontAssetId: string | null;
  backAssetId: string | null;
  status: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export type ExportPackageRecord = {
  id: string;
  userId: string;
  projectId: string;
  validationRunId: string | null;
  packageKind: string;
  interiorStorageReference: string | null;
  coverStorageReference: string | null;
  manifestStorageReference: string | null;
  zipStorageReference: string | null;
  status: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export function getCoverPlanForUser(db: AppDatabase, userId: string, projectId: string): CoverPlanRecord | null {
  return (
    db.prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, title, author, imprint,
              trim_width_inches AS trimWidthInches, trim_height_inches AS trimHeightInches,
              bleed_inches AS bleedInches, spine_width_inches AS spineWidthInches,
              front_copy AS frontCopy, back_copy AS backCopy,
              front_asset_id AS frontAssetId, back_asset_id AS backAssetId,
              status, created_at AS createdAt, updated_at AS updatedAt
       FROM cover_plans WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 1`,
    ).get(userId, projectId) as CoverPlanRecord | undefined
  ) ?? null;
}

export function getLayoutTemplateForUser(db: AppDatabase, userId: string, templateId: string): Record<string, unknown> | null {
  return (
    db.prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, name, template_key AS templateKey,
              template_schema AS templateSchema, trim_width_inches AS trimWidthInches,
              trim_height_inches AS trimHeightInches, bleed_inches AS bleedInches,
              status, created_at AS createdAt, updated_at AS updatedAt
       FROM layout_templates WHERE user_id = ? AND id = ?`,
    ).get(userId, templateId) as Record<string, unknown> | undefined
  ) ?? null;
}

export function listExportPackages(db: AppDatabase, userId: string, projectId: string): ExportPackageRecord[] {
  return db.prepare(
    `SELECT id, user_id AS userId, project_id AS projectId,
            validation_run_id AS validationRunId, package_kind AS packageKind,
            interior_storage_reference AS interiorStorageReference,
            cover_storage_reference AS coverStorageReference,
            manifest_storage_reference AS manifestStorageReference,
            zip_storage_reference AS zipStorageReference,
            status, created_at AS createdAt, updated_at AS updatedAt
     FROM export_packages WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC`,
  ).all(userId, projectId) as ExportPackageRecord[];
}

export function getLatestValidationRun(db: AppDatabase, userId: string, projectId: string): Record<string, unknown> | null {
  return (
    db.prepare(
      `SELECT id, user_id AS userId, project_id AS projectId,
              export_package_id AS exportPackageId, status, result_summary AS resultSummary,
              error_count AS errorCount, warning_count AS warningCount,
              created_at AS createdAt, updated_at AS updatedAt
       FROM validation_runs WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).get(userId, projectId) as Record<string, unknown> | undefined
  ) ?? null;
}

export function listAuditEvents(db: AppDatabase, userId: string, projectId: string): Array<Record<string, unknown>> {
  return db.prepare(
    `SELECT id, user_id AS userId, project_id AS projectId, actor_user_id AS actorUserId,
            entity_type AS entityType, entity_id AS entityId, event_type AS eventType,
            from_status AS fromStatus, to_status AS toStatus, metadata_json AS metadataJson,
            created_at AS createdAt, updated_at AS updatedAt
     FROM audit_events WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC`,
  ).all(userId, projectId) as Array<Record<string, unknown>>;
}

export function listGenerationJobsForUser(db: AppDatabase, userId: string, projectId: string, pagePlanId?: string): GenerationJobRecord[] {
  const rows = db.prepare(`SELECT id FROM generation_jobs WHERE user_id = ? AND project_id = ? ${pagePlanId ? "AND page_plan_id = ?" : ""} ORDER BY created_at DESC`).all(...(pagePlanId ? [userId, projectId, pagePlanId] : [userId, projectId])) as Array<{ id: string }>;
  return rows.map((row) => getGenerationJobForUser(db, userId, row.id)).filter((row): row is GenerationJobRecord => Boolean(row));
}

export function listGeneratedAssetsForPage(db: AppDatabase, userId: string, projectId: string, pagePlanId: string): GeneratedAssetRecord[] {
  const rows = db.prepare(`SELECT id FROM generated_assets WHERE user_id = ? AND project_id = ? AND page_plan_id = ? ORDER BY created_at DESC`).all(userId, projectId, pagePlanId) as Array<{ id: string }>;
  return rows.map((row) => getGeneratedAssetForUser(db, userId, row.id)).filter((row): row is GeneratedAssetRecord => Boolean(row));
}

export type AssetVariantRecord = {
  id: string;
  userId: string;
  projectId: string;
  generatedAssetId: string;
  sourceAssetId: string | null;
  variantKind: string;
  storageReference: string;
  mimeType: string;
  widthPx: number | null;
  heightPx: number | null;
  byteSize: number | null;
  checksumSha256: string | null;
  status: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
};

export function listAssetVariantsForUser(db: AppDatabase, userId: string, projectId: string, generatedAssetId?: string): AssetVariantRecord[] {
  const rows = db.prepare(`SELECT id, user_id AS userId, project_id AS projectId, generated_asset_id AS generatedAssetId, source_asset_id AS sourceAssetId, variant_kind AS variantKind, storage_reference AS storageReference, mime_type AS mimeType, width_px AS widthPx, height_px AS heightPx, byte_size AS byteSize, checksum_sha256 AS checksumSha256, status, created_at AS createdAt, updated_at AS updatedAt FROM asset_variants WHERE user_id = ? AND project_id = ? ${generatedAssetId ? "AND generated_asset_id = ?" : ""} ORDER BY created_at DESC`).all(...(generatedAssetId ? [userId, projectId, generatedAssetId] : [userId, projectId])) as AssetVariantRecord[];
  return rows;
}

export function reviewGeneratedAsset(db: AppDatabase, userId: string, assetId: string, input: { decision: "approved" | "rejected" | "archived"; rejectionReason?: string }): GeneratedAssetRecord | null {
  const current = getGeneratedAssetForUser(db, userId, assetId);
  if (!current) return null;
  if (input.decision === "rejected" && !input.rejectionReason?.trim()) throw new Error("A rejection reason is required.");
  const nextStatus: LifecycleStatus = input.decision === "rejected" ? "needs_review" : input.decision;
  if (!canTransition(current.status, nextStatus)) throw new Error(`Invalid asset review transition from ${current.status} to ${nextStatus}`);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE generated_assets SET status = ?, rejection_reason = ?, updated_at = ? WHERE id = ? AND user_id = ?`).run(nextStatus, input.decision === "rejected" ? input.rejectionReason!.trim() : null, now, assetId, userId);
    createAuditEvent(db, userId, { projectId: current.projectId, actorUserId: userId, entityType: "generated_asset", entityId: assetId, eventType: input.decision === "approved" ? "asset_approved" : input.decision === "rejected" ? "asset_rejected" : "asset_archived", fromStatus: current.status, toStatus: nextStatus, metadataJson: JSON.stringify({ rejectionReason: input.rejectionReason ?? null }) });
  })();
  return getGeneratedAssetForUser(db, userId, assetId);
}

export function getGeneratedAssetByStorageReferenceForUser(db: AppDatabase, userId: string, storageReference: string): GeneratedAssetRecord | null {
  const row = db.prepare(`SELECT id FROM generated_assets WHERE user_id = ? AND storage_reference = ? AND status != 'archived' LIMIT 1`).get(userId, storageReference) as { id: string } | undefined;
  return row ? getGeneratedAssetForUser(db, userId, row.id) : null;
}
