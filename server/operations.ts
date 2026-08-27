import crypto from "node:crypto";
import type { AppDatabase } from "./db";
import type { PrivateStorage } from "./storage";
import type { FalGenerationService } from "./fal-generation";
import { createFinalExport, type FinalExportInput } from "./export-center";

export type OperationsDashboard = {
  generatedAt: string;
  generationJobsByStatus: Array<{ status: string; count: number }>;
  providerErrorsByCode: Array<{ code: string; count: number }>;
  webhook: { accepted: number; processed: number; pending: number; conflicts: number };
  exports: Array<{ status: string; count: number }>;
  storageFailures: Array<{ code: string; count: number }>;
  validationFailures: Array<{ category: string; count: number }>;
};

function grouped(db: AppDatabase, sql: string, key: string): Array<{ [key: string]: string | number }> {
  return db.prepare(sql).all().map((row) => { const item = row as Record<string, unknown>; return { [key]: String(item[key]), count: Number(item.count) }; });
}

export function getRecoveryCandidates(db: AppDatabase) {
  return {
    incompleteJobs: db.prepare("SELECT id, local_status AS status, updated_at AS updatedAt FROM generation_jobs WHERE local_status IN ('queued', 'in_progress', 'cancellation_requested') ORDER BY updated_at ASC LIMIT 50").all(),
    retryableStorage: db.prepare("SELECT id, status, attempts, updated_at AS updatedAt FROM storage_copy_operations WHERE status = 'retryable' AND attempts < 3 ORDER BY updated_at ASC LIMIT 50").all(),
    regenerableExports: db.prepare("SELECT id, frozen_project_version AS frozenProjectVersion, created_at AS createdAt FROM export_packages WHERE status = 'completed' AND source_input_json IS NOT NULL ORDER BY created_at DESC LIMIT 50").all(),
  };
}

export function getOperationsDashboard(db: AppDatabase): OperationsDashboard {
  const generationJobsByStatus = grouped(db, "SELECT COALESCE(local_status, status, 'unknown') AS status, COUNT(*) AS count FROM generation_jobs GROUP BY COALESCE(local_status, status, 'unknown')", "status") as OperationsDashboard["generationJobsByStatus"];
  const providerErrorsByCode = grouped(db, "SELECT COALESCE(error_classification, 'unknown') AS code, COUNT(*) AS count FROM generation_jobs WHERE COALESCE(local_status, status) = 'failed' GROUP BY COALESCE(error_classification, 'unknown')", "code") as OperationsDashboard["providerErrorsByCode"];
  const exports = grouped(db, "SELECT COALESCE(status, 'unknown') AS status, COUNT(*) AS count FROM export_packages GROUP BY COALESCE(status, 'unknown')", "status") as OperationsDashboard["exports"];
  const storageFailures = grouped(db, "SELECT COALESCE(last_error_code, 'unknown') AS code, COUNT(*) AS count FROM storage_copy_operations WHERE status IN ('failed', 'retryable') GROUP BY COALESCE(last_error_code, 'unknown')", "code") as OperationsDashboard["storageFailures"];
  const validationFailures = grouped(db, "SELECT CASE WHEN error_count > 0 THEN 'blocking' WHEN warning_count > 0 THEN 'warning' ELSE 'none' END AS category, COUNT(*) AS count FROM validation_runs GROUP BY category", "category") as OperationsDashboard["validationFailures"];
  const webhook = db.prepare("SELECT COUNT(*) AS accepted, SUM(CASE WHEN processed_at IS NOT NULL THEN 1 ELSE 0 END) AS processed, SUM(CASE WHEN processed_at IS NULL THEN 1 ELSE 0 END) AS pending FROM fal_webhook_events").get() as { accepted?: number; processed?: number; pending?: number };
  return { generatedAt: new Date().toISOString(), generationJobsByStatus, providerErrorsByCode, webhook: { accepted: Number(webhook.accepted ?? 0), processed: Number(webhook.processed ?? 0), pending: Number(webhook.pending ?? 0), conflicts: 0 }, exports, storageFailures, validationFailures };
}

export function recordOperationalRecovery(db: AppDatabase, actorUserId: string, action: string, targetId: string, outcome: string, safeCode: string): void {
  db.prepare("INSERT INTO operational_recovery_events (id, actor_user_id, action, target_id, outcome, safe_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), actorUserId, action, targetId, outcome, safeCode, new Date().toISOString());
}

export async function reconcileOneJob(db: AppDatabase, service: FalGenerationService, adminId: string, jobId: string): Promise<unknown> {
  const job = db.prepare("SELECT id, user_id AS userId, fal_request_id AS falRequestId, local_status AS localStatus FROM generation_jobs WHERE id = ?").get(jobId) as { id: string; userId: string; falRequestId: string | null; localStatus: string } | undefined;
  if (!job) throw new Error("Generation job not found.");
  if (!job.falRequestId || ["completed", "failed", "cancelled"].includes(job.localStatus)) throw new Error("Job is not eligible for reconciliation.");
  try { const result = await service.reconcile(db, job.userId, job.id); recordOperationalRecovery(db, adminId, "reconcile_job", job.id, "succeeded", "reconciled_once"); return result; } catch (error) { recordOperationalRecovery(db, adminId, "reconcile_job", job.id, "failed", "reconcile_failed"); throw error; }
}

export async function retryOneStorageCopy(db: AppDatabase, storage: PrivateStorage, adminId: string, operationId: string): Promise<{ operationId: string; status: string }> {
  const operation = db.prepare("SELECT id, source_reference AS sourceReference, destination_reference AS destinationReference, status, attempts FROM storage_copy_operations WHERE id = ?").get(operationId) as { id: string; sourceReference: string; destinationReference: string; status: string; attempts: number } | undefined;
  if (!operation) throw new Error("Storage operation not found.");
  if (operation.status !== "retryable" || operation.attempts >= 3 || !storage.createReadStream || !storage.putStream) throw new Error("Storage operation is not safely retryable.");
  db.prepare("UPDATE storage_copy_operations SET status = 'pending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'retryable'").run(new Date().toISOString(), operation.id);
  try { await storage.putStream(operation.destinationReference, storage.createReadStream(operation.sourceReference), "application/octet-stream"); db.prepare("UPDATE storage_copy_operations SET status = 'completed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), operation.id); recordOperationalRecovery(db, adminId, "retry_storage_copy", operation.id, "succeeded", "copied_once"); return { operationId, status: "completed" }; } catch (error) { db.prepare("UPDATE storage_copy_operations SET status = 'retryable', last_error_code = ?, updated_at = ? WHERE id = ?").run("storage_copy_failed", new Date().toISOString(), operation.id); recordOperationalRecovery(db, adminId, "retry_storage_copy", operation.id, "failed", "copy_failed"); throw error; }
}

export async function regenerateOneExport(db: AppDatabase, storage: PrivateStorage, adminId: string, exportPackageId: string): Promise<unknown> {
  const row = db.prepare("SELECT id, user_id AS userId, source_input_json AS sourceInput FROM export_packages WHERE id = ? AND status = 'completed'").get(exportPackageId) as { id: string; userId: string; sourceInput: string | null } | undefined;
  if (!row?.sourceInput) throw new Error("The selected export has no immutable recovery snapshot.");
  const input = JSON.parse(row.sourceInput) as FinalExportInput;
  const result = await createFinalExport(db, storage, row.userId, input);
  recordOperationalRecovery(db, adminId, "regenerate_export", row.id, "succeeded", "regenerated_frozen_version");
  return result;
}

export async function cleanupExpiredObjects(db: AppDatabase, storage: PrivateStorage, now = new Date()): Promise<{ expiredExports: number; abandonedJobs: number; deletedObjects: number }> {
  const expired = db.prepare("SELECT zip_storage_reference AS value, interior_storage_reference AS interior, cover_storage_reference AS cover, manifest_storage_reference AS manifest, listing_metadata_storage_reference AS listing, readme_storage_reference AS readme, cover_preview_storage_reference AS preview FROM export_packages WHERE expires_at IS NOT NULL AND expires_at <= ? AND retention_status = 'active'").all(now.toISOString()) as Array<Record<string, unknown>>;
  let deletedObjects = 0;
  for (const row of expired) for (const value of Object.values(row)) if (typeof value === "string" && value) { try { await storage.delete(value); deletedObjects += 1; } catch { /* retain the record for operator retry */ } }
  db.prepare("UPDATE export_packages SET retention_status = 'expired', updated_at = ? WHERE expires_at IS NOT NULL AND expires_at <= ? AND retention_status = 'active'").run(now.toISOString(), now.toISOString());
  const cutoff = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const abandoned = db.prepare("SELECT COUNT(*) AS count FROM generation_jobs WHERE local_status = 'cancelled' AND updated_at <= ?").get(cutoff) as { count?: number };
  const drafts = db.prepare("SELECT storage_reference AS value FROM generated_assets WHERE status = 'cancelled' AND updated_at <= ? UNION ALL SELECT storage_reference AS value FROM asset_variants WHERE status = 'cancelled' AND updated_at <= ?").all(cutoff, cutoff) as Array<{ value: string }>;
  for (const row of drafts) { try { await storage.delete(row.value); deletedObjects += 1; } catch { /* retry on a later cleanup run */ } }
  return { expiredExports: expired.length, abandonedJobs: Number(abandoned.count ?? 0), deletedObjects };
}
