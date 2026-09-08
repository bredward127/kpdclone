import type { AppDatabase } from "./db";
import { assertReferenceCanBeUsedForGeneration } from "./reference-assets";
import { readPrivateStorageBytes } from "./storage";

/**
 * Turn a project's reference art into inputs an image-conditioned endpoint can
 * actually consume.
 *
 * The endpoint accepts "public image URLs or supported data URIs". Data URIs
 * are the right choice here: the reference art stays in private storage and
 * never gets a publicly reachable link, and nothing has to be uploaded to a
 * third-party CDN first. The cost is request size, so the totals are capped.
 */

/** Base64 inflates bytes by 4/3, and the whole request has to stay sane. */
const DEFAULT_MAX_TOTAL_ENCODED_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES = 6;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export type ReferenceImageInput = { id: string; dataUri: string; encodedBytes: number; filename: string; kind: string };
export type ReferenceImageResult = {
  images: ReferenceImageInput[];
  skipped: Array<{ id: string; reason: string }>;
};

export function maxReferenceBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.FAL_MAX_REFERENCE_PAYLOAD_BYTES);
  return Number.isFinite(raw) && raw >= 64 * 1024 ? Math.min(raw, 20 * 1024 * 1024) : DEFAULT_MAX_TOTAL_ENCODED_BYTES;
}

/**
 * Resolve reference ids to data URIs, newest first, stopping at the size and
 * count caps. Anything unusable is reported rather than silently dropped: an
 * author who uploaded a character sheet needs to know if it did not reach the
 * model, because that is the whole basis of continuity between pages.
 */
export async function loadReferenceImages(
  db: AppDatabase,
  userId: string,
  referenceIds: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReferenceImageResult> {
  const images: ReferenceImageInput[] = [];
  const skipped: ReferenceImageResult["skipped"] = [];
  const budget = maxReferenceBytes(env);
  let used = 0;

  for (const id of referenceIds) {
    if (images.length >= MAX_IMAGES) { skipped.push({ id, reason: `Only the first ${MAX_IMAGES} reference images are sent to the model.` }); continue; }

    let reference;
    try {
      // Re-checks ownership, active status and the rights attestation.
      reference = assertReferenceCanBeUsedForGeneration(db, userId, id);
    } catch (error) {
      skipped.push({ id, reason: error instanceof Error ? error.message : "This reference could not be used." });
      continue;
    }

    if (!ALLOWED_MIME.has(reference.mimeType)) {
      skipped.push({ id, reason: `${reference.originalFilename} is ${reference.mimeType}; only PNG, JPEG and WebP can be sent.` });
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await readPrivateStorageBytes(reference.storageKey);
    } catch {
      skipped.push({ id, reason: `${reference.originalFilename} could not be read from storage.` });
      continue;
    }

    const encoded = Math.ceil(bytes.byteLength / 3) * 4;
    if (used + encoded > budget) {
      skipped.push({ id, reason: `${reference.originalFilename} was left out to keep the request under ${Math.round(budget / (1024 * 1024))}MB.` });
      continue;
    }

    images.push({
      id: reference.id,
      dataUri: `data:${reference.mimeType};base64,${bytes.toString("base64")}`,
      encodedBytes: encoded,
      filename: reference.originalFilename,
      kind: reference.referenceKind,
    });
    used += encoded;
  }

  return { images, skipped };
}
