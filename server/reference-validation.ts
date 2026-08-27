import crypto from "node:crypto";
import sharp from "sharp";

export const acceptedReferenceMimeTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export type AcceptedReferenceMimeType = (typeof acceptedReferenceMimeTypes)[number];

export type ReferenceValidationLimits = {
  maxBytes: number;
  maxPixels: number;
  maxDimension: number;
};

export type ValidatedReferenceImage = {
  mimeType: AcceptedReferenceMimeType;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  contentHashSha256: string;
};

const formatToMimeType: Record<string, AcceptedReferenceMimeType> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function getReferenceValidationLimits(env: NodeJS.ProcessEnv = process.env): ReferenceValidationLimits {
  return {
    maxBytes: positiveInteger(env.VISUAL_REFERENCE_MAX_BYTES, 10 * 1024 * 1024),
    maxPixels: positiveInteger(env.VISUAL_REFERENCE_MAX_PIXELS, 25_000_000),
    maxDimension: positiveInteger(env.VISUAL_REFERENCE_MAX_DIMENSION, 10_000),
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function validateReferenceImage(
  bytes: Uint8Array,
  declaredMimeType: string,
  limits = getReferenceValidationLimits(),
): Promise<ValidatedReferenceImage> {
  if (!acceptedReferenceMimeTypes.includes(declaredMimeType as AcceptedReferenceMimeType)) {
    throw new Error("Unsupported visual reference type. Use PNG, JPEG, or WebP.");
  }
  if (bytes.byteLength === 0) throw new Error("The visual reference is empty.");
  if (bytes.byteLength > limits.maxBytes) throw new Error("The visual reference exceeds the configured file-size limit.");

  try {
    const image = sharp(Buffer.from(bytes), { limitInputPixels: limits.maxPixels, sequentialRead: true });
    const metadata = await image.metadata();
    const format = metadata.format ? formatToMimeType[metadata.format] : undefined;
    if (!format || format !== declaredMimeType) {
      throw new Error("The file content does not match PNG, JPEG, or WebP.");
    }
    if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
      throw new Error("The visual reference has no readable dimensions.");
    }
    if (metadata.width > limits.maxDimension || metadata.height > limits.maxDimension) {
      throw new Error("The visual reference exceeds the configured pixel-dimension limit.");
    }
    if (metadata.width * metadata.height > limits.maxPixels) {
      throw new Error("The visual reference exceeds the configured pixel-count limit.");
    }

    // Force a bounded decode so truncated/corrupt files and decompression bombs fail before storage.
    await image.clone().rotate().toBuffer();

    return {
      mimeType: format,
      widthPx: metadata.width,
      heightPx: metadata.height,
      byteSize: bytes.byteLength,
      contentHashSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The ")) throw error;
    throw new Error("The visual reference is corrupted or unsafe to decode.");
  }
}
