import { describe, expect, it, vi } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createBookBrief, createPagePlan } from "../server/db-studio";
import { composePromptFromSavedProject, createPromptVersion, freezePromptVersion } from "../server/prompt-composer";
import { createFalGenerationService, type GenerationAdapter } from "../server/fal-generation";
import { falModelRegistry, listSelectableFalModels } from "../server/fal-models";
import type { PrivateStorage } from "../server/storage";

const owner = { id: "approval-owner", name: "Owner", email: "owner@example.com" };
const REGISTERED = falModelRegistry[0];

function makeService() {
  const storage: PrivateStorage = { put: vi.fn(async (key: string) => ({ key })), delete: vi.fn(async () => {}), createAccessUrl: vi.fn(async (key: string) => `/private/${key}`) };
  const adapter: GenerationAdapter = {
    submit: vi.fn(async () => ({ requestId: "r1", gatewayRequestId: "r1", responseUrl: null, statusUrl: null, cancelUrl: null })),
    status: vi.fn(async () => ({ status: "IN_QUEUE" as const, requestId: "r1" })),
    result: vi.fn(async () => ({})),
    cancel: vi.fn(async () => "cancellation_requested" as const),
    downloadImage: vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: "image/png" })),
  };
  // No modelApproval override: this exercises the real default, which every
  // other generation test stubs out with () => true.
  return { service: createFalGenerationService({ adapter, storage }), adapter };
}

function fixture(endpointId: string) {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  const project = createProject(db, owner.id, { id: "p1", name: "Book", brief: "A picture book." });
  createBookBrief(db, owner.id, { id: "b1", projectId: project.id, briefText: "A child finds courage.", bookType: "picture_book", audience: "preschool", visualStyleAnchors: "Soft gouache.", characterBible: "Mina wears yellow.", negativePrompt: "No logos." });
  const page = createPagePlan(db, owner.id, { id: "pg1", projectId: project.id, pageNumber: 1, sceneDirection: "Mina opens the gate.", pageText: "It creaked." });
  const input = { projectId: project.id, pagePlanId: page.id, generationModel: REGISTERED.displayName, generationEndpoint: endpointId, aspectRatio: "1:1", referenceAssetIds: [] as string[], userEdits: {} };
  const prompt = createPromptVersion(db, owner.id, composePromptFromSavedProject(db, owner.id, input), input);
  freezePromptVersion(db, owner.id, prompt.id);
  return { db, input, promptVersionId: prompt.id };
}

describe("model approval agrees with the model list the interface reads", () => {
  it("accepts an endpoint activated through FAL_ACTIVE_ENDPOINTS", async () => {
    // The registry ships this endpoint with active:false; the deployment turns
    // it on with the environment variable. The list query honoured that and the
    // submit check did not, so the model was offered, a prompt was frozen
    // against it, and submission then refused it as not administrator-approved.
    const previous = process.env.FAL_ACTIVE_ENDPOINTS;
    process.env.FAL_ACTIVE_ENDPOINTS = REGISTERED.endpointId;
    try {
      expect(listSelectableFalModels().map((model) => model.endpointId)).toContain(REGISTERED.endpointId);
      const { service } = makeService();
      const { db, input, promptVersionId } = fixture(REGISTERED.endpointId);
      await expect(service.submit(db, owner.id, { ...input, promptVersionId, expectedOutputConstraints: {} }))
        .resolves.toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env.FAL_ACTIVE_ENDPOINTS; else process.env.FAL_ACTIVE_ENDPOINTS = previous;
    }
  });

  it("still refuses an endpoint that is not in the active list", async () => {
    const previous = process.env.FAL_ACTIVE_ENDPOINTS;
    delete process.env.FAL_ACTIVE_ENDPOINTS;
    try {
      const { service } = makeService();
      const { db, input, promptVersionId } = fixture(REGISTERED.endpointId);
      await expect(service.submit(db, owner.id, { ...input, promptVersionId, expectedOutputConstraints: {} }))
        .rejects.toThrow(/not active and administrator-approved/);
    } finally {
      if (previous !== undefined) process.env.FAL_ACTIVE_ENDPOINTS = previous;
    }
  });

  it("refuses an endpoint that is not in the registry at all", async () => {
    const previous = process.env.FAL_ACTIVE_ENDPOINTS;
    process.env.FAL_ACTIVE_ENDPOINTS = "someone/made-this-up";
    try {
      const { service } = makeService();
      const { db, input, promptVersionId } = fixture("someone/made-this-up");
      await expect(service.submit(db, owner.id, { ...input, promptVersionId, expectedOutputConstraints: {} }))
        .rejects.toThrow(/not active and administrator-approved/);
    } finally {
      if (previous === undefined) delete process.env.FAL_ACTIVE_ENDPOINTS; else process.env.FAL_ACTIVE_ENDPOINTS = previous;
    }
  });
});
