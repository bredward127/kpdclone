import { describe, expect, it, vi } from "vitest";
import { getFalModel, nanoBananaEditInputSchema } from "../server/fal-models";
import { maxReferenceBytes } from "../server/reference-images";

describe("nano-banana-2/edit payload", () => {
  const model = getFalModel("fal-ai/nano-banana-2/edit")!;

  const args = {
    prompt: "A shy raccoon opens the garden gate.",
    negativePrompt: "no scary faces\nlettering, watermark",
    aspectRatio: "1:1" as const,
    seed: 7,
    quality: "low" as const,
    referenceImageUris: ["data:image/png;base64,AAAA"],
  };

  it("is registered as image-conditioned and required", () => {
    expect(model.acceptsReferenceImages).toBe(true);
    expect(model.requiresReferenceImage).toBe(true);
    // No quality tier on this endpoint; resolution carries it instead.
    expect(model.honoursQualityTier).toBe(false);
  });

  it("sends reference art in image_urls, which is what was missing before", () => {
    const input = model.buildInput(args) as Record<string, unknown>;
    expect(input.image_urls).toEqual(["data:image/png;base64,AAAA"]);
    // The old payload sent internal database ids the provider could not resolve.
    expect(input).not.toHaveProperty("reference_asset_ids");
  });

  it("omits fields this endpoint does not accept", () => {
    const input = model.buildInput(args) as Record<string, unknown>;
    // gpt-image's fields were previously sent to every endpoint.
    expect(input).not.toHaveProperty("image_size");
    expect(input).not.toHaveProperty("quality");
    expect(input).not.toHaveProperty("negative_prompt");
    expect(input).not.toHaveProperty("model");
  });

  it("folds the negative constraints into the prompt, since there is no negative field", () => {
    const input = model.buildInput(args) as Record<string, unknown>;
    const prompt = String(input.prompt);
    expect(prompt).toContain("A shy raccoon opens the garden gate.");
    expect(prompt).toContain("lettering");
    expect(prompt).toContain("MUST NOT APPEAR");
  });

  it("maps the chosen quality tier onto the endpoint's resolution", () => {
    expect((model.buildInput({ ...args, quality: "low" }) as Record<string, unknown>).resolution).toBe("0.5K");
    expect((model.buildInput({ ...args, quality: "medium" }) as Record<string, unknown>).resolution).toBe("1K");
    expect((model.buildInput({ ...args, quality: "high" }) as Record<string, unknown>).resolution).toBe("2K");
  });

  it("asks for one image at the strictest safety tolerance", () => {
    const input = model.buildInput(args) as Record<string, unknown>;
    expect(input.num_images).toBe(1);
    expect(input.safety_tolerance).toBe("1");
    expect(input.limit_generations).toBe(true);
    // sync_mode unset: results must arrive as fal.media URLs, which is the
    // only host the result downloader accepts.
    expect(input.sync_mode).toBeUndefined();
  });

  it("omits the seed when there isn't one rather than sending null", () => {
    const input = model.buildInput({ ...args, seed: null }) as Record<string, unknown>;
    expect(input).not.toHaveProperty("seed");
    expect((model.buildInput(args) as Record<string, unknown>).seed).toBe(7);
  });

  it("produces a payload that satisfies the endpoint's own schema", () => {
    expect(nanoBananaEditInputSchema.safeParse(model.buildInput(args)).success).toBe(true);
  });

  it("fails its own schema when no reference image is supplied", () => {
    // image_urls is only optional if video/audio/pdf context is given, none of
    // which this app sends, so an empty list must never reach the provider.
    expect(nanoBananaEditInputSchema.safeParse(model.buildInput({ ...args, referenceImageUris: [] })).success).toBe(false);
  });

  it("only offers aspect ratios the endpoint documents", () => {
    for (const ratio of model.supportedAspectRatios) {
      expect(nanoBananaEditInputSchema.safeParse(model.buildInput({ ...args, aspectRatio: ratio })).success).toBe(true);
    }
  });

  it("reports an unknown price rather than a guessed one", () => {
    // The per-image price was not supplied with the schema. Showing a wrong
    // number is worse than showing none when the author is watching spend.
    expect(model.pricing.perImageUsd).toBeNull();
    expect(model.pricing.flatPerImageUsd).toBeNull();
  });
});

describe("text-to-image endpoints keep their own shape", () => {
  it("gpt-image-1.5 still gets image_size and quality, and takes no reference art", () => {
    const model = getFalModel("fal-ai/gpt-image-1.5")!;
    expect(model.acceptsReferenceImages).toBe(false);
    const input = model.buildInput({ prompt: "p", negativePrompt: "n", aspectRatio: "3:2", quality: "medium", referenceImageUris: [] }) as Record<string, unknown>;
    expect(input.image_size).toBe("1536x1024");
    expect(input.quality).toBe("medium");
    expect(input).not.toHaveProperty("image_urls");
  });

  it("flux maps portrait and square ratios to the right pixel size", () => {
    const model = getFalModel("fal-ai/flux/schnell")!;
    const portrait = model.buildInput({ prompt: "p", negativePrompt: "", aspectRatio: "2:3", quality: "low", referenceImageUris: [] }) as Record<string, unknown>;
    expect(portrait.image_size).toBe("1024x1536");
    const square = model.buildInput({ prompt: "p", negativePrompt: "", aspectRatio: "1:1", quality: "low", referenceImageUris: [] }) as Record<string, unknown>;
    expect(square.image_size).toBe("1024x1024");
  });
});

describe("reference payload budget", () => {
  it("defaults to a bounded size and clamps tuning", () => {
    expect(maxReferenceBytes({})).toBe(6 * 1024 * 1024);
    expect(maxReferenceBytes({ FAL_MAX_REFERENCE_PAYLOAD_BYTES: "1048576" })).toBe(1024 * 1024);
    // Absurd values clamp instead of letting a request grow without limit.
    expect(maxReferenceBytes({ FAL_MAX_REFERENCE_PAYLOAD_BYTES: "999999999" })).toBe(20 * 1024 * 1024);
    expect(maxReferenceBytes({ FAL_MAX_REFERENCE_PAYLOAD_BYTES: "10" })).toBe(6 * 1024 * 1024);
  });
});
