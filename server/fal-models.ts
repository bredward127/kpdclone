import { z } from "zod";
import type { ImagePricing } from "../shared/image-cost";

export const falModelInputSchema = z.object({
  prompt: z.string().min(1),
  image_size: z.enum(["1024x1024", "1536x1024", "1024x1536"]),
  background: z.enum(["auto", "transparent", "opaque"]).optional(),
  quality: z.string().optional(),
  num_images: z.number().int().min(1).max(1).optional(),
  output_format: z.string().optional(),
  sync_mode: z.boolean().optional(),
});

export type FalModelConfig = {
  endpointId: string;
  endpointUrl: string;
  displayName: string;
  allowedInputSchema: typeof falModelInputSchema;
  supportedAspectRatios: readonly ["1:1", "3:2", "2:3"];
  pricing: ImagePricing & { unit: string; currency: string; display: string };
  /** True when the endpoint bills by quality tier and accepts a `quality` input. */
  honoursQualityTier: boolean;
  active: boolean;
  docsReviewedAt: string;
  docsUrl: string;
  requiresAdminApproval: true;
};

export const falModelRegistry: readonly FalModelConfig[] = [
  {
    endpointId: "fal-ai/gpt-image-1.5",
    endpointUrl: "https://fal.run/fal-ai/gpt-image-1.5",
    displayName: "GPT Image 1.5",
    allowedInputSchema: falModelInputSchema,
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
    active: false,
    docsReviewedAt: "2026-08-27",
    docsUrl: "https://fal.ai/docs/model-api-reference/image-generation-api/gpt-image-1.5",
    requiresAdminApproval: true,
  },
  {
    // Roughly forty times cheaper than gpt-image-1.5 at its top tier, and well
    // suited to flat black line art, which has no gradients or lighting for a
    // heavier model to preserve.
    endpointId: "fal-ai/flux/schnell",
    endpointUrl: "https://fal.run/fal-ai/flux/schnell",
    displayName: "FLUX.1 schnell",
    allowedInputSchema: falModelInputSchema,
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
