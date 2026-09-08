import { describe, expect, it, vi } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createBookBrief, createPagePlan, getGenerationJobForUser } from "../server/db-studio";
import { composePromptFromSavedProject, createPromptVersion, freezePromptVersion } from "../server/prompt-composer";
import { createFalGenerationService, type GenerationAdapter } from "../server/fal-generation";
import { FalProviderError } from "../server/fal-queue";
import type { PrivateStorage } from "../server/storage";

const owner = { id: "conc-owner", name: "Owner", email: "owner@example.com" };
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function makeStorage(): PrivateStorage {
  const objects = new Map<string, Uint8Array>();
  return {
    put: vi.fn(async (key, bytes) => { objects.set(key, bytes); return { key }; }),
    delete: vi.fn(async (key) => { objects.delete(key); }),
    createAccessUrl: vi.fn(async (key) => `/private/${key}`),
  };
}

/**
 * Models the provider the way a deployment without webhooks sees it: work is
 * submitted, the provider finishes it on its own schedule, and nothing is ever
 * pushed back to us. `statuses` is what FAL would report if asked.
 */
function makeAdapter() {
  let requestNumber = 0;
  const statuses = new Map<string, "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED">();
  const unknown = new Set<string>();
  const adapter: GenerationAdapter = {
    submit: vi.fn(async () => { const requestId = `req-${++requestNumber}`; statuses.set(requestId, "IN_QUEUE"); return { requestId, gatewayRequestId: requestId, responseUrl: null, statusUrl: null, cancelUrl: null }; }),
    status: vi.fn(async (_endpoint, requestId) => {
      if (unknown.has(requestId)) throw new FalProviderError("FAL request was not found.", { classification: "provider_not_found", retryable: false, providerStatus: 404 });
      return { status: statuses.get(requestId) ?? "IN_QUEUE", requestId };
    }),
    result: vi.fn(async () => ({ images: [{ url: "https://fal.media/files/result.png", content_type: "image/png", width: 1, height: 1 }] })),
    cancel: vi.fn(async () => "cancellation_requested" as const),
    downloadImage: vi.fn(async () => ({ bytes: pngBytes, contentType: "image/png" })),
  };
  return { adapter, statuses, unknown };
}

function makeProject(pageCount: number) {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  const project = createProject(db, owner.id, { id: "conc-project", name: "Moon Garden", brief: "A picture book." });
  createBookBrief(db, owner.id, { id: "conc-brief", projectId: project.id, briefText: "A child finds courage.", bookType: "picture_book", audience: "preschool children", visualStyleAnchors: "Indigo gouache.", characterBible: "Mina wears a yellow raincoat.", negativePrompt: "No logos." });
  const prompts: string[] = [];
  for (let n = 1; n <= pageCount; n += 1) {
    const page = createPagePlan(db, owner.id, { id: `conc-page-${n}`, projectId: project.id, pageNumber: n, sceneDirection: `Scene ${n}.`, pageText: `Text ${n}.` });
    const input = { projectId: project.id, pagePlanId: page.id, generationModel: "Reviewed model", generationEndpoint: "reviewed/model", aspectRatio: "1:1", referenceAssetIds: [] as string[] };
    const version = createPromptVersion(db, owner.id, composePromptFromSavedProject(db, owner.id, input), input);
    freezePromptVersion(db, owner.id, version.id);
    prompts.push(version.id);
  }
  return { db, project, prompts };
}

function submitInput(projectId: string, pageNumber: number, promptVersionId: string) {
  return { projectId, pagePlanId: `conc-page-${pageNumber}`, promptVersionId, generationModel: "Reviewed model", generationEndpoint: "reviewed/model", aspectRatio: "1:1", referenceAssetIds: [] as string[], expectedOutputConstraints: { mimeTypes: ["image/png"], maxPixels: 25_000_000 } };
}

describe("generation concurrency recovery without webhooks", () => {
  it("reclaims slots from jobs the provider already finished, instead of locking the account out", async () => {
    const { db, project, prompts } = makeProject(4);
    const { adapter, statuses } = makeAdapter();
    // No webhookUrl: this is the deployment shape that wedged.
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 2, maxActivePerProject: 2 });

    const first = await service.submit(db, owner.id, submitInput(project.id, 1, prompts[0]));
    const second = await service.submit(db, owner.id, submitInput(project.id, 2, prompts[1]));
    expect(getGenerationJobForUser(db, owner.id, first.localJobId)?.localStatus).toBe("queued");

    // Ceiling reached while both are genuinely still queued at the provider.
    await expect(service.submit(db, owner.id, submitInput(project.id, 3, prompts[2]))).rejects.toThrow(/concurrency limit reached/);

    // The provider finishes both, and — having no webhook — tells us nothing.
    statuses.set(first.falRequestId, "COMPLETED");
    statuses.set(second.falRequestId, "COMPLETED");

    // The next submission must succeed: it reconciles, discovers both are done,
    // ingests their images and frees the slots.
    const third = await service.submit(db, owner.id, submitInput(project.id, 3, prompts[2]));
    expect(third.status).toBe("queued");
    expect(getGenerationJobForUser(db, owner.id, first.localJobId)?.localStatus).toBe("completed");
    expect(getGenerationJobForUser(db, owner.id, second.localJobId)?.localStatus).toBe("completed");
  });

  it("settles jobs the provider no longer knows about so they cannot hold a slot forever", async () => {
    const { db, project, prompts } = makeProject(3);
    const { adapter, unknown } = makeAdapter();
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 1, maxActivePerProject: 1 });

    const stuck = await service.submit(db, owner.id, submitInput(project.id, 1, prompts[0]));
    // The provider has lost the request: it can never complete or call back.
    unknown.add(stuck.falRequestId);

    const next = await service.submit(db, owner.id, submitInput(project.id, 2, prompts[1]));
    expect(next.status).toBe("queued");
    const settled = getGenerationJobForUser(db, owner.id, stuck.localJobId);
    expect(settled?.localStatus).toBe("failed");
    expect(settled?.errorClassification).toBe("provider_not_found");
  });

  it("ingests finished images on demand so pages stop showing work in flight", async () => {
    const { db, project, prompts } = makeProject(2);
    const { adapter, statuses } = makeAdapter();
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true });

    const job = await service.submit(db, owner.id, submitInput(project.id, 1, prompts[0]));
    statuses.set(job.falRequestId, "COMPLETED");

    // minAgeMs 0 so a job submitted moments ago is still checked.
    const result = await service.reconcileActiveJobs(db, owner.id, project.id, 0);
    expect(result.checked).toBe(1);
    expect(result.advanced).toBe(1);
    expect(getGenerationJobForUser(db, owner.id, job.localJobId)?.localStatus).toBe("completed");
  });

  it("leaves a job active when the provider is unreachable, so a later sweep can retry", async () => {
    const { db, project, prompts } = makeProject(2);
    const { adapter } = makeAdapter();
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true });
    const job = await service.submit(db, owner.id, submitInput(project.id, 1, prompts[0]));

    adapter.status = vi.fn(async () => { throw new FalProviderError("FAL is unavailable.", { classification: "provider_http", retryable: true, providerStatus: 503 }); });
    const result = await service.reconcileActiveJobs(db, owner.id, project.id, 0);
    expect(result.checked).toBe(1);
    expect(result.advanced).toBe(0);
    expect(getGenerationJobForUser(db, owner.id, job.localJobId)?.localStatus).toBe("queued");
  });

  it("defaults to limits that allow a book to be generated in bulk", async () => {
    const { db, project, prompts } = makeProject(6);
    const { adapter } = makeAdapter();
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true });
    // The old ceiling was 3 per user / 2 per project, so a sixth page could
    // never be queued even with every job healthy.
    for (let n = 1; n <= 6; n += 1) {
      const submitted = await service.submit(db, owner.id, submitInput(project.id, n, prompts[n - 1]));
      expect(submitted.status).toBe("queued");
    }
  });
});
