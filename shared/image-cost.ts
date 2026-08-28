/**
 * Per-image cost, so the studio can price a batch before spending money on it.
 *
 * GPT Image 1.5 is billed by quality tier at 1024x1024: low $0.009,
 * medium $0.034, high $0.133. The app never sent a `quality` field, so the
 * provider applied its own default and every page was billed at the top tier.
 * That is the ~$0.13-0.15 per page that showed up on the bill.
 *
 * Line art has no subtle gradients or lighting to preserve, so the low tier is
 * the right default for a coloring book: it is the same drawing for a fifteenth
 * of the money. Verify these numbers against the provider's pricing page before
 * relying on them for a large run; they are recorded here so the interface can
 * show a figure rather than leaving the author to find out afterwards.
 * Source: fal.ai model pricing, checked 2026-08-28.
 */

export type ImageQuality = "low" | "medium" | "high";
export const IMAGE_QUALITIES: readonly ImageQuality[] = ["low", "medium", "high"];

export type ImagePricing = {
  /** Cost in US dollars for one 1024x1024 image at each quality tier. */
  perImageUsd: Record<ImageQuality, number> | null;
  /** Flat cost per image where the model does not price by quality tier. */
  flatPerImageUsd: number | null;
  note: string;
};

export function estimateImageCostUsd(pricing: ImagePricing, quality: ImageQuality, images: number): number | null {
  const count = Math.max(0, Math.floor(images));
  if (pricing.flatPerImageUsd !== null) return Number((pricing.flatPerImageUsd * count).toFixed(4));
  if (pricing.perImageUsd) return Number((pricing.perImageUsd[quality] * count).toFixed(4));
  return null;
}

export function formatUsd(amount: number | null): string {
  if (amount === null) return "unknown cost";
  if (amount === 0) return "$0.00";
  return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

/** 1024-based sizes the image endpoints accept, chosen from the aspect ratio. */
export function imageSizeForAspectRatio(aspectRatio: string): "1024x1024" | "1536x1024" | "1024x1536" {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w === h) return "1024x1024";
  return w > h ? "1536x1024" : "1024x1536";
}
