import { z } from "zod";
import type { ImagePricing, ImageQuality } from "../shared/image-cost";

/**
 * Endpoints do not share an input shape, so each one owns its own schema and
 * its own input builder. A single shared schema previously meant every model
 * was sent gpt-image's fields: `image_size` and `quality` went to endpoints
 * that do not accept them, and `reference_asset_ids` — internal database ids —
 * went to every endpoint, none of which could resolve them. That is why
 * uploaded reference art never influenced a single generated page.
 */

export const gptImageInputSchema = z.object({
  prompt: z.string().min(1),
  image_size: z.enum(["1024x1024", "1536x1024", "1024x1536"]),
  background: z.enum(["auto", "transparent", "opaque"]).optional(),
  quality: z.string().optional(),
  num_images: z.number().int().min(1).max(1).optional(),
  output_format: z.string().optional(),
  sync_mode: z.boolean().optional(),
});

/** fal-ai/nano-banana-2/edit. Image-conditioned: `image_urls` carries the art. */
export const nanoBananaEditInputSchema = z.object({
  prompt: z.string().min(1),
  // "Public image URLs or supported data URIs." Private art is inlined as a
  // data URI so it never needs a publicly reachable link.
  image_urls: z.array(z.string().min(1)).min(1).max(6),
  num_images: z.number().int().min(1).max(4).optional(),
  seed: z.number().int().optional(),
  aspect_ratio: z.enum(["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "4:1", "1:4", "8:1", "1:8"]).optional(),
  output_format: z.enum(["jpeg", "png", "webp"]).optional(),
  safety_tolerance: z.enum(["1", "2", "3", "4", "5", "6"]).optional(),
  resolution: z.enum(["0.5K", "1K", "2K", "4K"]).optional(),
  system_prompt: z.string().optional(),
  limit_generations: z.boolean().optional(),
  enable_web_search: z.boolean().optional(),
  thinking_level: z.enum(["minimal", "high"]).optional(),
  // sync_mode returns a data URI instead of a hosted file. Left unset: the
  // result downloader accepts only fal.media URLs, and keeping results out of
  // the response body keeps them out of logs.
  sync_mode: z.boolean().optional(),
});

export const fluxInputSchema = z.object({
  prompt: z.string().min(1),
  image_size: z.enum(["1024x1024", "1536x1024", "1024x1536"]),
  num_images: z.number().int().min(1).max(1).optional(),
  output_format: z.string().optional(),
  seed: z.number().int().optional(),
  sync_mode: z.boolean().optional(),
});

export type ModelInputArgs = {
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  seed?: number | null;
  quality: ImageQuality;
  /** Data URIs for reference art, already validated and size-capped. */
  referenceImageUris: readonly string[];
  /** Continuity anchors, for endpoints that take a system-level instruction. */
  systemPrompt?: string;
};

export type FalModelConfig = {
  endpointId: string;
  endpointUrl: string;
  displayName: string;
  allowedInputSchema: z.ZodTypeAny;
  supportedAspectRatios: readonly string[];
  pricing: ImagePricing & { unit: string; currency: string; display: string };
  /** True when the endpoint bills by quality tier and accepts a `quality` input. */
  honoursQualityTier: boolean;
  /** True when the endpoint requires at least one input image. */
  requiresReferenceImage: boolean;
  /** True when the endpoint accepts reference images at all. */
  acceptsReferenceImages: boolean;
  /** Builds the provider payload for this endpoint specifically. */
  buildInput: (args: ModelInputArgs) => Record<string, unknown>;
  active: boolean;
  docsReviewedAt: string;
  docsUrl: string;
  requiresAdminApproval: true;
};

function imageSizeFor(aspectRatio: string): "1024x1024" | "1536x1024" | "1024x1536" {
  if (aspectRatio === "3:2") return "1536x1024";
  if (aspectRatio === "2:3") return "1024x1536";
  return "1024x1024";
}

/**
 * Endpoints without a negative-prompt field still have to be told not to draw
 * lettering, so the constraints are folded into the prompt instead of dropped.
 */
export function withNegativeInPrompt(prompt: string, negativePrompt: string): string {
  const cleaned = negativePrompt.trim();
  return cleaned ? `${prompt}\n\nMUST NOT APPEAR IN THE IMAGE — treat each as forbidden:\n${cleaned}` : prompt;
}

/** The quality tier the author chose, expressed as this endpoint's resolution. */
function resolutionForQuality(quality: ImageQuality): "0.5K" | "1K" | "2K" {
  if (quality === "high") return "2K";
  if (quality === "medium") return "1K";
  return "0.5K";
}

export const falModelRegistry: readonly FalModelConfig[] = [
  {
    endpointId: "fal-ai/gpt-image-1.5",
    endpointUrl: "https://fal.run/fal-ai/gpt-image-1.5",
    displayName: "GPT Image 1.5",
    allowedInputSchema: gptImageInputSchema,
    supportedAspectRatios: ["1:1", "3:2", "2:3"],
    pricing: {
      unit: "image",
      currency: "USD",
      display: "$0.009 low / $0.034 medium / $0.133 high per 1024x1024 image",
      perImageUsd: { low: 0.009, medium: 0.034, high: 0.133 },
      flatPerImageUsd: null,
      note: "Billed by quality tier. The app previously sent no quality field, so every image was billed at the provider default -- the top tier.",
    },
    honoursQualityTier: true,
    requiresReferenceImage: false,
    // Text-to-image only: there is no field to put an image in, which is why
    // reference art could never influence its output.
    acceptsReferenceImages: false,
    buildInput: (args) => ({
      prompt: args.prompt,
      image_size: imageSizeFor(args.aspectRatio),
      num_images: 1,
      output_format: "png",
      quality: args.quality,
    }),
    active: false,
    docsReviewedAt: "2026-08-27",
    docsUrl: "https://fal.ai/docs/model-api-reference/image-generation-api/gpt-image-1.5",
    requiresAdminApproval: true,
  },
  {
    endpointId: "fal-ai/nano-banana-2/edit",
    endpointUrl: "https://fal.run/fal-ai/nano-banana-2/edit",
    displayName: "Nano Banana 2 Edit (reference-guided)",
    allowedInputSchema: nanoBananaEditInputSchema,
    supportedAspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16"],
    pricing: {
      unit: "image",
      currency: "USD",
      display: "price not yet recorded — confirm on the model page before a large run",
      // Deliberately unrecorded rather than guessed. estimateImageCostUsd
      // returns null for this, so the interface says "unknown cost" instead of
      // showing a number that might be wrong by an order of magnitude.
      perImageUsd: null,
      flatPerImageUsd: null,
      note: "Per-image price was not supplied with the endpoint schema. Record it here from the model's pricing before generating a whole book, so batches can be priced up front.",
    },
    honoursQualityTier: false,
    requiresReferenceImage: true,
    acceptsReferenceImages: true,
    buildInput: (args) => ({
      prompt: withNegativeInPrompt(args.prompt, args.negativePrompt),
      image_urls: [...args.referenceImageUris],
      num_images: 1,
      // "auto" would let the model pick; the book's trim decides this.
      aspect_ratio: args.aspectRatio,
      output_format: "png",
      // Strictest tolerance: this produces children's book interiors.
      safety_tolerance: "1",
      resolution: resolutionForQuality(args.quality),
      // One image per round, and no intermediate frames.
      limit_generations: true,
      ...(args.systemPrompt ? { system_prompt: args.systemPrompt } : {}),
      ...(args.seed !== null && args.seed !== undefined ? { seed: args.seed } : {}),
    }),
    active: false,
    docsReviewedAt: "2026-09-08",
    docsUrl: "https://fal.ai/models/fal-ai/nano-banana-2/edit",
    requiresAdminApproval: true,
  },
  {
    // Roughly forty times cheaper than gpt-image-1.5 at its top tier, and well
    // suited to flat black line art, which has no gradients or lighting for a
    // heavier model to preserve.
    endpointId: "fal-ai/flux/schnell",
    endpointUrl: "https://fal.run/fal-ai/flux/schnell",
    displayName: "FLUX.1 schnell",
    allowedInputSchema: fluxInputSchema,
    supportedAspectRatios: ["1:1", "3:2", "2:3"],
    pricing: {
      unit: "image",
      currency: "USD",
      display: "$0.003 per megapixel (about $0.003 per 1024x1024 image)",
      perImageUsd: null,
      flatPerImageUsd: 0.003,
      note: "Billed per megapixel, rounded up. A 1024x1024 image is one megapixel.",
    },
    honoursQualityTier: false,
    requiresReferenceImage: false,
    acceptsReferenceImages: false,
    buildInput: (args) => ({
      prompt: withNegativeInPrompt(args.prompt, args.negativePrompt),
      image_size: imageSizeFor(args.aspectRatio),
      num_images: 1,
      output_format: "png",
      ...(args.seed !== null && args.seed !== undefined ? { seed: args.seed } : {}),
    }),
    active: false,
    docsReviewedAt: "2026-08-28",
    docsUrl: "https://fal.ai/models/fal-ai/flux/schnell",
    requiresAdminApproval: true,
  },
];

export function getFalModel(endpointId: string): FalModelConfig | null {
  return falModelRegistry.find((model) => model.endpointId === endpointId) ?? null;
}

export function listSelectableFalModels(env: NodeJS.ProcessEnv = process.env): FalModelConfig[] {
  const explicitlyActivated = new Set((env.FAL_ACTIVE_ENDPOINTS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  return falModelRegistry.filter((model) => (model.active || explicitlyActivated.has(model.endpointId)) && model.requiresAdminApproval === true && Boolean(model.docsReviewedAt));
}
