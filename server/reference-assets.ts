import crypto from "node:crypto";
import type { AppDatabase } from "./db";
import { getProjectForUser } from "./db";
import { getPagePlanForUser } from "./db-studio";
import { validateReferenceImage, type ReferenceValidationLimits } from "./reference-validation";
import type { PrivateStorage } from "./storage";

export const referenceKinds = ["character_sheet", "sketch_reference", "moodboard", "cover_reference"] as const;
export type ReferenceKind = (typeof referenceKinds)[number];

export const provenanceDeclarations = ["user_owned", "licensed", "permission_granted"] as const;
export type ProvenanceDeclaration = (typeof provenanceDeclarations)[number];

export type ReferenceAssetRecord = {
  id: string;
  userId: string;
  projectId: string;
  pagePlanId: string | null;
  referenceKind: ReferenceKind;
  originalFilename: string;
  mimeType: string;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  storageKey: string;
  contentHashSha256: string;
  provenanceDeclaration: ProvenanceDeclaration;
  rightsAttestation: boolean;
  rightsAttestedAt: string | null;
  status: "active" | "deleted" | "replaced" | "archived";
  replacedById: string | null;
  replacesId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReferenceAssetWithAccess = ReferenceAssetRecord & { accessUrl: string };

export function getReferenceAssetForUser(db: AppDatabase, userId: string, referenceId: string): ReferenceAssetRecord | null {
  return (
    db.prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, page_plan_id AS pagePlanId,
              reference_kind AS referenceKind, original_filename AS originalFilename,
              mime_type AS mimeType, width_px AS widthPx, height_px AS heightPx,
              byte_size AS byteSize, storage_key AS storageKey,
              content_hash_sha256 AS contentHashSha256,
              provenance_declaration AS provenanceDeclaration,
              rights_attestation AS rightsAttestation, rights_attested_at AS rightsAttestedAt,
              status, replaced_by_id AS replacedById, replaces_id AS replacesId,
              created_at AS createdAt, updated_at AS updatedAt
       FROM reference_assets WHERE id = ? AND user_id = ?`,
    ).get(referenceId, userId) as ReferenceAssetRecord | undefined
  ) ?? null;
}

export function getReferenceAssetByStorageKeyForUser(db: AppDatabase, userId: string, storageKey: string): ReferenceAssetRecord | null {
  return (
    db.prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, page_plan_id AS pagePlanId,
              reference_kind AS referenceKind, original_filename AS originalFilename,
              mime_type AS mimeType, width_px AS widthPx, height_px AS heightPx,
              byte_size AS byteSize, storage_key AS storageKey,
              content_hash_sha256 AS contentHashSha256,
              provenance_declaration AS provenanceDeclaration,
              rights_attestation AS rightsAttestation, rights_attested_at AS rightsAttestedAt,
              status, replaced_by_id AS replacedById, replaces_id AS replacesId,
              created_at AS createdAt, updated_at AS updatedAt
       FROM reference_assets WHERE storage_key = ? AND user_id = ?`,
    ).get(storageKey, userId) as ReferenceAssetRecord | undefined
  ) ?? null;
}

export function listReferenceAssets(db: AppDatabase, userId: string, projectId: string): ReferenceAssetRecord[] {
  return db.prepare(
    `SELECT id, user_id AS userId, project_id AS projectId, page_plan_id AS pagePlanId,
            reference_kind AS referenceKind, original_filename AS originalFilename,
            mime_type AS mimeType, width_px AS widthPx, height_px AS heightPx,
            byte_size AS byteSize, storage_key AS storageKey,
            content_hash_sha256 AS contentHashSha256,
            provenance_declaration AS provenanceDeclaration,
            rights_attestation AS rightsAttestation, rights_attested_at AS rightsAttestedAt,
            status, replaced_by_id AS replacedById, replaces_id AS replacesId,
            created_at AS createdAt, updated_at AS updatedAt
     FROM reference_assets WHERE user_id = ? AND project_id = ? AND status = 'active'
     ORDER BY created_at DESC`,
  ).all(userId, projectId) as ReferenceAssetRecord[];
}

export function assertReferenceCanBeUsedForGeneration(db: AppDatabase, userId: string, referenceId: string): ReferenceAssetRecord {
  const reference = getReferenceAssetForUser(db, userId, referenceId);
  if (!reference || reference.status !== "active") throw new Error("Visual reference is unavailable.");
  if (!reference.rightsAttestation) throw new Error("Rights attestation is required before using this visual reference for generation.");
  return reference;
}

export async function deleteReferenceAssetForUser(
  db: AppDatabase,
  storage: PrivateStorage,
  userId: string,
  referenceId: string,
): Promise<ReferenceAssetRecord | null> {
  const reference = getReferenceAssetForUser(db, userId, referenceId);
  if (!reference || reference.status !== "active") return null;

  await storage.delete(reference.storageKey);
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE reference_assets SET status = 'deleted', deleted_at = @now, updated_at = @now
     WHERE id = @referenceId AND user_id = @userId AND status = 'active'`,
  ).run({ now, referenceId, userId });
  return result.changes === 1 ? getReferenceAssetForUser(db, userId, referenceId) : null;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function cleanFilename(filename: string): string {
  const basename = filename.replace(/\\/g, "/").split("/").pop() ?? "reference";
  return basename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "reference";
}

export async function uploadReferenceAsset(
  db: AppDatabase,
  storage: PrivateStorage,
  userId: string,
  input: {
    projectId: string;
    pagePlanId?: string;
    referenceKind: ReferenceKind;
    originalFilename: string;
    declaredMimeType: string;
    provenanceDeclaration: ProvenanceDeclaration;
    rightsAttestation: boolean;
    bytes: Uint8Array;
    replacesId?: string;
  },
  limits: ReferenceValidationLimits,
): Promise<ReferenceAssetRecord> {
  if (!getProjectForUser(db, userId, input.projectId)) throw new Error("Project not found.");
  if (input.pagePlanId) {
    const pagePlan = getPagePlanForUser(db, userId, input.pagePlanId);
    if (!pagePlan || pagePlan.projectId !== input.projectId) throw new Error("Page plan not found.");
  }
  if (!input.rightsAttestation) throw new Error("Rights attestation is required: confirm that you own this reference or have permission to use it before uploading.");
  if (input.replacesId) {
    const replacement = getReferenceAssetForUser(db, userId, input.replacesId);
    if (!replacement || replacement.projectId !== input.projectId || replacement.status !== "active") throw new Error("Reference to replace is unavailable.");
  }

  const validated = await validateReferenceImage(input.bytes, input.declaredMimeType, limits);
  const id = crypto.randomUUID();
  const extension = extensionForMimeType(validated.mimeType);
  const storageKey = `${userId}/projects/${input.projectId}/references/${id}.${extension}`;
  const now = new Date().toISOString();
  let storageAttempted = false;

  try {
    storageAttempted = true;
    await storage.put(storageKey, input.bytes, validated.mimeType);
    const reference = db.transaction(() => {
      if (input.replacesId) {
        db.prepare(
          `UPDATE reference_assets SET status = 'replaced', replaced_by_id = @id, updated_at = @now
           WHERE id = @replacesId AND user_id = @userId AND project_id = @projectId AND status = 'active'`,
        ).run({ id, now, replacesId: input.replacesId, userId, projectId: input.projectId });
      }
      db.prepare(
        `INSERT INTO reference_assets
          (id, user_id, project_id, page_plan_id, reference_kind, original_filename,
           mime_type, width_px, height_px, byte_size, storage_key, content_hash_sha256,
           provenance_declaration, rights_attestation, rights_attested_at,
           status, replaces_id, created_at, updated_at)
         VALUES (@id, @userId, @projectId, @pagePlanId, @referenceKind, @originalFilename,
                 @mimeType, @widthPx, @heightPx, @byteSize, @storageKey, @contentHashSha256,
                 @provenanceDeclaration, 1, @now, 'active', @replacesId, @now, @now)`,
      ).run({
        id,
        userId,
        projectId: input.projectId,
        pagePlanId: input.pagePlanId ?? null,
        referenceKind: input.referenceKind,
        originalFilename: cleanFilename(input.originalFilename),
        ...validated,
        storageKey,
        provenanceDeclaration: input.provenanceDeclaration,
        now,
        replacesId: input.replacesId ?? null,
      });
      return getReferenceAssetForUser(db, userId, id)!;
    })();
    return reference;
  } catch (error) {
    if (storageAttempted) {
      try {
        await storage.delete(storageKey);
      } catch {
        // The original database/storage error remains the actionable failure.
      }
    }
    throw error instanceof Error ? error : new Error("Visual reference upload failed.");
  }
}
