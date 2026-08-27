import { z } from "zod";

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
  pricing: {
    unit: string;
    amount: number | null;
    currency: string | null;
    display: string | null;
  };
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
      amount: null,
      currency: null,
      display: null,
    },
    active: false,
    docsReviewedAt: "2026-08-27",
    docsUrl: "https://fal.ai/docs/model-api-reference/image-generation-api/gpt-image-1.5",
    requiresAdminApproval: true,
  },
];

export function getFalModel(endpointId: string): FalModelConfig | null {
  return falModelRegistry.find((model) => model.endpointId === endpointId) ?? null;
}

export function listSelectableFalModels(): FalModelConfig[] {
  return falModelRegistry.filter((model) => model.active && model.requiresAdminApproval === true && Boolean(model.docsReviewedAt));
}
