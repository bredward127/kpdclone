import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createBookBrief, createPagePlan, getGeneratedAssetForUser, getGenerationJobForUser, listAssetVariantsForUser, reviewGeneratedAsset } from "../server/db-studio";
import { createPromptVersion, composePromptFromSavedProject, freezePromptVersion } from "../server/prompt-composer";
import { createFalGenerationService, type GenerationAdapter } from "../server/fal-generation";
import { FalProviderError, verifyFalWebhookSignature } from "../server/fal-queue";
import type { PrivateStorage } from "../server/storage";

const owner = { id: "fal-owner", name: "FAL Owner", email: "fal-owner@example.com" };
const stranger = { id: "fal-stranger", name: "FAL Stranger", email: "fal-stranger@example.com" };
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function makeStorage() {
  const objects = new Map<string, Uint8Array>();
  const storage: PrivateStorage = {
    put: vi.fn(async (key, bytes) => { objects.set(key, bytes); return { key }; }),
    delete: vi.fn(async (key) => { objects.delete(key); }),
    createAccessUrl: vi.fn(async (key) => `/private/${key}`),
  };
  return { storage, objects };
}

function makeAdapter() {
  let requestNumber = 0;
  const statuses = new Map<string, "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED">();
  const adapter: GenerationAdapter = {
    submit: vi.fn(async () => { const requestId = `fal-request-${++requestNumber}`; statuses.set(requestId, "IN_QUEUE"); return { requestId, gatewayRequestId: requestId, responseUrl: null, statusUrl: null, cancelUrl: null }; }),
    status: vi.fn(async (_endpoint, requestId) => ({ status: statuses.get(requestId) ?? "IN_QUEUE", requestId })),
    result: vi.fn(async () => ({ images: [{ url: "https://fal.media/files/result.png", content_type: "image/png", width: 1, height: 1 }] })),
    cancel: vi.fn(async () => "cancellation_requested" as const),
    downloadImage: vi.fn(async () => ({ bytes: pngBytes, contentType: "image/png" })),
  };
  return { adapter, statuses };
}

function makeFixture() {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  upsertUser(db, stranger);
  const project = createProject(db, owner.id, { id: "fal-project", name: "Moon Garden", brief: "A picture book." });
  const brief = createBookBrief(db, owner.id, { id: "fal-brief", projectId: project.id, briefText: "A child finds courage.", bookType: "picture_book", audience: "preschool children", visualStyleAnchors: "Indigo gouache, rounded shapes, soft rim light.", characterBible: "Mina wears a yellow raincoat.", negativePrompt: "No logos." });
  const page = createPagePlan(db, owner.id, { id: "fal-page", projectId: project.id, pageNumber: 1, sceneDirection: "Mina opens the garden gate.", pageText: "The gate creaked." });
  const input = { projectId: project.id, pagePlanId: page.id, generationModel: "Reviewed model", generationEndpoint: "reviewed/model", aspectRatio: "1:1", seed: 7, referenceAssetIds: [] as string[], userEdits: { promptAddition: "Keep the gate on the left." } };
  const composed = composePromptFromSavedProject(db, owner.id, input);
  const prompt = createPromptVersion(db, owner.id, composed, input);
  freezePromptVersion(db, owner.id, prompt.id);
  return { db, project, page, prompt: prompt, input };
}

async function makeJob() {
  const fixture = makeFixture();
  const { adapter, statuses } = makeAdapter();
  const { storage } = makeStorage();
  const service = createFalGenerationService({ adapter, storage, webhookUrl: "https://studio.example.com/api/fal/webhook", modelApproval: () => true });
  const job = await service.submit(fixture.db, owner.id, { ...fixture.input, promptVersionId: fixture.prompt.id, expectedOutputConstraints: { mimeTypes: ["image/png"], maxPixels: 25_000_000 } });
  return { ...fixture, adapter, statuses, storage, service, job };
}

describe("FAL queue generation contract", () => {
  it("rejects drafts, validates ownership, submits frozen prompts, and persists the provider request immediately", async () => {
    const draft = makeFixture();
    const { adapter, storage } = makeAdapterAndStorage();
    const service = createFalGenerationService({ adapter, storage, modelApproval: () => true });
    const draftPrompt = createPromptVersion(draft.db, owner.id, composePromptFromSavedProject(draft.db, owner.id, draft.input), draft.input);
    await expect(service.submit(draft.db, owner.id, { ...draft.input, promptVersionId: draftPrompt.id, expectedOutputConstraints: {} })).rejects.toThrow("not frozen");
    await expect(service.submit(draft.db, stranger.id, { ...draft.input, promptVersionId: draft.prompt.id, expectedOutputConstraints: {} })).rejects.toThrow("Project not found");
    const submitted = await service.submit(draft.db, owner.id, { ...draft.input, promptVersionId: draft.prompt.id, expectedOutputConstraints: { maxPixels: 25_000_000 } });
    expect(submitted.localJobId).toMatch(/[0-9a-f-]{36}/);
    expect(submitted.falRequestId).toBe("fal-request-1");
    const saved = getGenerationJobForUser(draft.db, owner.id, submitted.localJobId)!;
    expect(saved.falRequestId).toBe("fal-request-1");
    expect(saved.localStatus).toBe("queued");
    expect(saved.providerStatus).toBe("IN_QUEUE");
    expect(saved.modelInputs).toMatchObject({ prompt: draft.prompt.prompt, aspect_ratio: "1:1" });
  });

  it("reconciles one known request through queued, in-progress, and completed states", async () => {
    const { service, db, job, statuses, adapter } = await makeJob();
    expect((await service.reconcile(db, owner.id, job.localJobId)).status).toBe("queued");
    statuses.set(job.falRequestId, "IN_PROGRESS");
    expect((await service.reconcile(db, owner.id, job.localJobId)).status).toBe("in_progress");
    statuses.set(job.falRequestId, "COMPLETED");
    const completed = await service.reconcile(db, owner.id, job.localJobId);
    expect(completed.status).toBe("completed");
    expect(getGeneratedAssetForUser(db, owner.id, completed.localJobId)).toBeNull();
    expect(adapter.result).toHaveBeenCalledOnce();
  });

  it("ingests a completed webhook into private storage and handles duplicate delivery idempotently", async () => {
    const { service, db, job, storage } = await makeJob();
    const payload = { request_id: job.falRequestId, gateway_request_id: job.falRequestId, status: "OK" as const, payload: { images: [{ url: "https://fal.media/files/temporary.png", content_type: "image/png" }] } };
    const first = await service.processWebhook(db, payload);
    expect(first.duplicate).toBe(false);
    expect(first.assetId).toBeTruthy();
    expect(storage.put).toHaveBeenCalledOnce();
    const second = await service.processWebhook(db, payload);
    expect(second).toMatchObject({ duplicate: true, assetId: first.assetId });
    expect(storage.put).toHaveBeenCalledOnce();
    expect(getGenerationJobForUser(db, owner.id, job.localJobId)?.localStatus).toBe("completed");
  });

  it("records provider failures, retries with a new provider request, and passes cancellation", async () => {
    const first = await makeJob();
    await first.service.processWebhook(first.db, { request_id: first.job.falRequestId, status: "ERROR", error: "provider failure" });
    expect(getGenerationJobForUser(first.db, owner.id, first.job.localJobId)?.localStatus).toBe("failed");
    const retried = await first.service.retry(first.db, owner.id, first.job.localJobId);
    expect(retried.retryCount).toBe(1);
    expect(retried.falRequestId).not.toBe(first.job.falRequestId);
    const cancelled = await first.service.cancel(first.db, owner.id, first.job.localJobId);
    expect(cancelled.status).toBe("cancellation_requested");
    expect(first.adapter.cancel).toHaveBeenCalledWith(first.input.generationEndpoint, retried.falRequestId);
  });

  it("classifies expired provider URLs and never persists a transient URL as an asset", async () => {
    const fixture = await makeJob();
    fixture.adapter.downloadImage = vi.fn(async () => { throw new FalProviderError("FAL result URL expired or was unavailable.", { classification: "result_download_expired", retryable: true }); });
    await expect(fixture.service.processWebhook(fixture.db, { request_id: fixture.job.falRequestId, status: "OK", payload: { images: [{ url: "https://fal.media/files/expired.png" }] } })).rejects.toMatchObject({ classification: "result_download_expired" });
    const failed = getGenerationJobForUser(fixture.db, owner.id, fixture.job.localJobId);
    expect(failed?.localStatus).toBe("failed");
    expect(failed?.errorClassification).toBe("result_download_expired");
    expect(getGeneratedAssetForUser(fixture.db, owner.id, fixture.job.localJobId)).toBeNull();
  });
});

function makeAdapterAndStorage() {
  const { adapter } = makeAdapter();
  const { storage } = makeStorage();
  return { adapter, storage };
}

describe("FAL webhook verification contract", () => {
  it("accepts the current ED25519/JWKS signature format and rejects malformed or stale callbacks", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const body = Buffer.from(JSON.stringify({ request_id: "req-signature", status: "OK", payload: {} }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
    const message = Buffer.from(`req-signature\nfal-user\n${timestamp}\n${bodyHash}`);
    const signature = crypto.sign(null, message, privateKey).toString("hex");
    const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));
    const headers = { "x-fal-webhook-request-id": "req-signature", "x-fal-webhook-user-id": "fal-user", "x-fal-webhook-timestamp": timestamp, "x-fal-webhook-signature": signature };
    await expect(verifyFalWebhookSignature(body, headers, { fetchImpl, jwksUrl: "https://jwks.example/test" })).resolves.toBe(true);
    await expect(verifyFalWebhookSignature(body, { ...headers, "x-fal-webhook-signature": "not-hex" }, { fetchImpl, jwksUrl: "https://jwks.example/test" })).resolves.toBe(false);
    await expect(verifyFalWebhookSignature(body, { ...headers, "x-fal-webhook-timestamp": String(Number(timestamp) - 301) }, { fetchImpl, jwksUrl: "https://jwks.example/test" })).resolves.toBe(false);
  });
});


describe("Page Studio controls", () => {
  it("returns the same local job for a duplicate idempotency key", async () => {
    const fixture = makeFixture();
    const { adapter, storage } = makeAdapterAndStorage();
    const service = createFalGenerationService({ adapter, storage, modelApproval: () => true });
    const request = { ...fixture.input, promptVersionId: fixture.prompt.id, expectedOutputConstraints: {}, idempotencyKey: "same-page-click-key" };
    const first = await service.submit(fixture.db, owner.id, request);
    const second = await service.submit(fixture.db, owner.id, request);
    expect(second).toEqual(first);
    expect(adapter.submit).toHaveBeenCalledOnce();
  });

  it("enforces per-project concurrency before a second page job is accepted", async () => {
    const fixture = makeFixture();
    const { adapter, storage } = makeAdapterAndStorage();
    const service = createFalGenerationService({ adapter, storage, modelApproval: () => true, maxActivePerUser: 3, maxActivePerProject: 1 });
    await service.submit(fixture.db, owner.id, { ...fixture.input, promptVersionId: fixture.prompt.id, expectedOutputConstraints: {}, idempotencyKey: "first-page-key" });
    await expect(service.submit(fixture.db, owner.id, { ...fixture.input, promptVersionId: fixture.prompt.id, expectedOutputConstraints: {}, idempotencyKey: "second-page-key" })).rejects.toThrow(/per-project generation concurrency limit/i);
  });

  it("requires an approved source asset and creates a new alternate variant without overwriting it", async () => {
    const fixture = await makeJob();
    const completed = await fixture.service.processWebhook(fixture.db, { request_id: fixture.job.falRequestId, status: "OK", payload: { images: [{ url: "https://fal.media/files/original.png", content_type: "image/png" }] } });
    const sourceAsset = getGeneratedAssetForUser(fixture.db, owner.id, completed.assetId!)!;
    await expect(fixture.service.submit(fixture.db, owner.id, { ...fixture.input, promptVersionId: fixture.prompt.id, expectedOutputConstraints: {}, requestKind: "variation", sourceAssetId: sourceAsset.id, idempotencyKey: "variation-before-approval" })).rejects.toThrow(/approved asset/i);
    reviewGeneratedAsset(fixture.db, owner.id, sourceAsset.id, { decision: "approved" });
    const variation = await fixture.service.submit(fixture.db, owner.id, { ...fixture.input, promptVersionId: fixture.prompt.id, expectedOutputConstraints: {}, requestKind: "variation", sourceAssetId: sourceAsset.id, idempotencyKey: "variation-after-approval" });
    await fixture.service.processWebhook(fixture.db, { request_id: variation.falRequestId, status: "OK", payload: { images: [{ url: "https://fal.media/files/variation.png", content_type: "image/png" }] } });
    expect(getGeneratedAssetForUser(fixture.db, owner.id, sourceAsset.id)?.status).toBe("approved");
    expect(listAssetVariantsForUser(fixture.db, owner.id, fixture.project.id).some((variant) => variant.sourceAssetId === sourceAsset.id && variant.variantKind === "alternate")).toBe(true);
  });

  it("does not allow another user to cancel an owned job", async () => {
    const fixture = await makeJob();
    await expect(fixture.service.cancel(fixture.db, stranger.id, fixture.job.localJobId)).rejects.toThrow(/not found/i);
    expect(fixture.adapter.cancel).not.toHaveBeenCalled();
  });
});
