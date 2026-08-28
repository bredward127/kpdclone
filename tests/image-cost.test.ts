import { describe, expect, it, vi } from "vitest";
import { estimateImageCostUsd, formatUsd, imageSizeForAspectRatio } from "../shared/image-cost";
import { falModelRegistry, getFalModel } from "../server/fal-models";
import { createDatabase, createProject, updateProjectForUser, upsertUser } from "../server/db";
import { createBookBrief, createPagePlan, getGenerationJobForUser } from "../server/db-studio";
import { composePromptFromSavedProject, createPromptVersion, freezePromptVersion } from "../server/prompt-composer";
import { createFalGenerationService, type GenerationAdapter } from "../server/fal-generation";
import type { PrivateStorage } from "../server/storage";

const owner = { id: "cost-owner", name: "Owner", email: "owner@example.com" };
const GPT = getFalModel("fal-ai/gpt-image-1.5")!;

describe("per-image cost", () => {
  it("prices a 24-page book at each tier", () => {
    expect(estimateImageCostUsd(GPT.pricing, "low", 24)).toBeCloseTo(0.216, 4);
    expect(estimateImageCostUsd(GPT.pricing, "medium", 24)).toBeCloseTo(0.816, 4);
    expect(estimateImageCostUsd(GPT.pricing, "high", 24)).toBeCloseTo(3.192, 4);
  });

  it("shows low as far cheaper than the default the app was silently using", () => {
    const low = estimateImageCostUsd(GPT.pricing, "low", 1)!;
    const high = estimateImageCostUsd(GPT.pricing, "high", 1)!;
    expect(high / low).toBeGreaterThan(14);
  });

  it("prices a flat-rate model without quality tiers", () => {
    const flux = getFalModel("fal-ai/flux/schnell")!;
    expect(flux.honoursQualityTier).toBe(false);
    expect(estimateImageCostUsd(flux.pricing, "high", 24)).toBeCloseTo(0.072, 4);
  });

  it("records real pricing for every registered model", () => {
    for (const model of falModelRegistry) {
      expect(model.pricing.perImageUsd ?? model.pricing.flatPerImageUsd, `${model.endpointId} has no price`).toBeTruthy();
      expect(model.pricing.display).toBeTruthy();
    }
  });

  it("formats small and large amounts readably", () => {
    expect(formatUsd(0.003)).toBe("$0.0030");
    expect(formatUsd(3.192)).toBe("$3.19");
    expect(formatUsd(null)).toBe("unknown cost");
  });

  it("maps aspect ratios onto the sizes the endpoints accept", () => {
    expect(imageSizeForAspectRatio("1:1")).toBe("1024x1024");
    expect(imageSizeForAspectRatio("3:2")).toBe("1536x1024");
    expect(imageSizeForAspectRatio("2:3")).toBe("1024x1536");
  });
});

describe("quality reaches the provider", () => {
  function submitFixture(quality: "low" | "medium" | "high") {
    const db = createDatabase(":memory:");
    upsertUser(db, owner);
    const project = createProject(db, owner.id, { id: "q1", name: "Book", brief: "A book." });
    updateProjectForUser(db, owner.id, project.id, { imageQuality: quality });
    createBookBrief(db, owner.id, { id: "qb", projectId: project.id, briefText: "A child wakes.", bookType: "coloring_book", audience: "4-8", visualStyleAnchors: "Even outlines.", characterBible: "Mina.", propAndSettingBible: "A pine nightstand.", negativePrompt: "No logos." });
    const page = createPagePlan(db, owner.id, { id: "qp", projectId: project.id, pageNumber: 1, sceneDirection: "Mina stretches.", pageText: "Hi." });
    const input = { projectId: project.id, pagePlanId: page.id, generationModel: GPT.displayName, generationEndpoint: GPT.endpointId, aspectRatio: "1:1", referenceAssetIds: [] as string[], userEdits: {} };
    const prompt = createPromptVersion(db, owner.id, composePromptFromSavedProject(db, owner.id, input), input);
    freezePromptVersion(db, owner.id, prompt.id);
    const storage: PrivateStorage = { put: vi.fn(async (key: string) => ({ key })), delete: vi.fn(async () => {}), createAccessUrl: vi.fn(async (key: string) => `/p/${key}`) };
    const adapter: GenerationAdapter = {
      submit: vi.fn(async () => ({ requestId: "r", gatewayRequestId: "r", responseUrl: null, statusUrl: null, cancelUrl: null })),
      status: vi.fn(async () => ({ status: "IN_QUEUE" as const, requestId: "r" })),
      result: vi.fn(async () => ({})), cancel: vi.fn(async () => "cancellation_requested" as const),
      downloadImage: vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: "image/png" })),
    };
    const service = createFalGenerationService({ adapter, storage, modelApproval: () => true });
    return { db, service, input, promptVersionId: prompt.id };
  }

  it("sends the project's quality tier and a concrete image size", async () => {
    // Neither field was sent before, so the provider billed at its own default.
    const { db, service, input, promptVersionId } = submitFixture("low");
    const job = await service.submit(db, owner.id, { ...input, promptVersionId, expectedOutputConstraints: {} });
    const stored = getGenerationJobForUser(db, owner.id, job.localJobId);
    const sent = stored!.modelInputs;
    expect(sent.quality).toBe("low");
    expect(sent.image_size).toBe("1024x1024");
  });

  it("carries a raised tier through when the author chooses one", async () => {
    const { db, service, input, promptVersionId } = submitFixture("high");
    const job = await service.submit(db, owner.id, { ...input, promptVersionId, expectedOutputConstraints: {} });
    const stored = getGenerationJobForUser(db, owner.id, job.localJobId);
    expect(stored!.modelInputs.quality).toBe("high");
  });
});
