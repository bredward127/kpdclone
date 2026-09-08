import { describe, expect, it, vi } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createBookBrief, createPagePlan } from "../server/db-studio";
import { composePromptFromSavedProject, createPromptVersion, freezePromptVersion } from "../server/prompt-composer";
import { createFalGenerationService, type GenerationAdapter } from "../server/fal-generation";
import { drainQueueOnce, enqueueGenerations, isCapacityRefusal, queueStatus } from "../server/generation-queue";
import { createFalQueueClient, FalProviderError } from "../server/fal-queue";
import { loadFalConfig, type FalConfig } from "../server/fal";
import type { PrivateStorage } from "../server/storage";

const owner = { id: "timeout-owner", name: "Owner", email: "owner@example.com" };
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

/** A provider that accepts the connection and then never answers. */
function hangingFetch(): typeof fetch {
  return ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal!.reason ?? new Error("aborted")));
  })) as unknown as typeof fetch;
}

function config(overrides: Partial<FalConfig> = {}): FalConfig {
  return {
    apiKey: "test-only",
    baseUrl: "https://api.fal.ai",
    queueBaseUrl: "https://queue.fal.run",
    syncBaseUrl: "https://fal.run",
    timeoutMs: 25,
    submitTimeoutMs: 5_000,
    downloadTimeoutMs: 5_000,
    ...overrides,
  };
}

function makeStorage(): PrivateStorage {
  const objects = new Map<string, Uint8Array>();
  return {
    put: vi.fn(async (key, bytes) => { objects.set(key, bytes); return { key }; }),
    delete: vi.fn(async (key) => { objects.delete(key); }),
    createAccessUrl: vi.fn(async (key) => `/private/${key}`),
  };
}

/** One frozen page, ready to be queued. */
function makePage() {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  const project = createProject(db, owner.id, { id: "timeout-project", name: "Moon Garden", brief: "" });
  createBookBrief(db, owner.id, { id: "timeout-brief", projectId: project.id, briefText: "A child finds courage.", bookType: "picture_book", audience: "preschool children", visualStyleAnchors: "Ink.", characterBible: "Mina.", negativePrompt: "No logos." });
  const page = createPagePlan(db, owner.id, { id: "tp-1", projectId: project.id, pageNumber: 1, sceneDirection: "Scene 1.", pageText: "Text 1." });
  const input = { projectId: project.id, pagePlanId: page.id, generationModel: "Reviewed model", generationEndpoint: "reviewed/model", aspectRatio: "1:1", referenceAssetIds: [] as string[] };
  const version = createPromptVersion(db, owner.id, composePromptFromSavedProject(db, owner.id, input), input);
  freezePromptVersion(db, owner.id, version.id);
  return { db, project, items: [{ pagePlanId: page.id, promptVersionId: version.id }] };
}

function adapterThatFails(message: string) {
  const adapter: GenerationAdapter = {
    submit: vi.fn(async () => { throw new FalProviderError(message, { classification: "provider_timeout", retryable: true }); }),
    status: vi.fn(async (_e, requestId) => ({ status: "IN_QUEUE" as const, requestId })),
    result: vi.fn(async () => ({ images: [{ url: "https://fal.media/files/r.png", content_type: "image/png", width: 1, height: 1 }] })),
    cancel: vi.fn(async () => "cancellation_requested" as const),
    downloadImage: vi.fn(async () => ({ bytes: pngBytes, contentType: "image/png" })),
  };
  return adapter;
}

describe("submitting is given a budget sized for the payload, not for a status poll", () => {
  it("gives submit and result download far longer than a status poll, and lets the deployment tune each", () => {
    const defaults = loadFalConfig({ FAL_KEY: "k" })!;
    // The regression this guards: one 5s budget shared by every call aborted
    // multi-megabyte submits before the body finished uploading, so nothing
    // ever reached the provider.
    expect(defaults.submitTimeoutMs).toBeGreaterThanOrEqual(60_000);
    expect(defaults.submitTimeoutMs).toBeGreaterThan(defaults.timeoutMs * 4);
    expect(defaults.downloadTimeoutMs).toBeGreaterThan(defaults.timeoutMs);

    const tuned = loadFalConfig({ FAL_KEY: "k", FAL_TIMEOUT_MS: "20000", FAL_SUBMIT_TIMEOUT_MS: "300000", FAL_DOWNLOAD_TIMEOUT_MS: "90000" })!;
    expect(tuned).toMatchObject({ timeoutMs: 20_000, submitTimeoutMs: 300_000, downloadTimeoutMs: 90_000 });

    // Nonsense and extremes are clamped rather than trusted.
    const clamped = loadFalConfig({ FAL_KEY: "k", FAL_TIMEOUT_MS: "abc", FAL_SUBMIT_TIMEOUT_MS: "1", FAL_DOWNLOAD_TIMEOUT_MS: "99999999" })!;
    expect(clamped.timeoutMs).toBe(defaults.timeoutMs);
    expect(clamped.submitTimeoutMs).toBe(5_000);
    expect(clamped.downloadTimeoutMs).toBe(600_000);
  });

  it("aborts a status poll on the short budget but keeps a slow submit alive", async () => {
    const client = createFalQueueClient(config(), { fetchImpl: hangingFetch() });

    await expect(client.status("fal-ai/nano-banana-2/edit", "req-1")).rejects.toThrow(/status check gave up after/i);

    const submit = client.submit("fal-ai/nano-banana-2/edit", { prompt: "A fox." }).then(() => "settled").catch(() => "settled");
    const outcome = await Promise.race([submit, new Promise((resolve) => setTimeout(() => resolve("still uploading"), 200))]);
    expect(outcome).toBe("still uploading");
  });

  it("names the operation and its budget so a stuck page says what went wrong", async () => {
    const client = createFalQueueClient(config({ submitTimeoutMs: 5_000 }), { fetchImpl: hangingFetch() });
    await expect(client.status("fal-ai/nano-banana-2/edit", "req-1")).rejects.toThrow(/FAL queue status check gave up after 0s\./);

    const unreachable = createFalQueueClient(config(), { fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
    await expect(unreachable.submit("fal-ai/nano-banana-2/edit", {})).rejects.toThrow(/FAL queue submit could not be reached\./);
  });
});

describe("a queue that cannot reach the provider says so instead of looping silently", () => {
  it("classifies capacity refusals as self-clearing and everything else as a fault", () => {
    expect(isCapacityRefusal('Per-user generation concurrency limit reached (12). Wait for a job to finish, or press "Cancel stuck jobs".')).toBe(true);
    expect(isCapacityRefusal("Too many generation requests. Retry in 59 seconds.")).toBe(true);
    expect(isCapacityRefusal("FAL rejected the queue operation (HTTP 429): rate limited")).toBe(true);
    expect(isCapacityRefusal("FAL queue submit gave up after 120s.")).toBe(false);
    expect(isCapacityRefusal("FAL queue submit could not be reached.")).toBe(false);
  });

  it("fails a page after its attempts are spent when submits keep timing out", async () => {
    const { db, project, items } = makePage();
    const adapter = adapterThatFails("FAL queue submit gave up after 120s.");
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 50, maxActivePerProject: 50 });
    enqueueGenerations(db, owner.id, project.id, items);

    for (let tick = 0; tick < 6; tick += 1) await drainQueueOnce(db, service, 2);

    const status = queueStatus(db, owner.id, project.id);
    // Before this fix the row went back to pending with its attempt refunded,
    // so it retried forever: the author saw a busy queue and no error at all.
    expect(status.pending).toBe(0);
    expect(status.failed).toBe(1);
    expect(status.failures[0].lastError).toMatch(/gave up after 120s/);
    expect(adapter.submit).toHaveBeenCalledTimes(3);
  });

  it("reports a page that is retrying while it is still waiting, not only once it dies", async () => {
    const { db, project, items } = makePage();
    const service = createFalGenerationService({ adapter: adapterThatFails("FAL queue submit could not be reached."), storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 50, maxActivePerProject: 50 });
    enqueueGenerations(db, owner.id, project.id, items);
    await drainQueueOnce(db, service, 2);

    const status = queueStatus(db, owner.id, project.id);
    expect(status.pending).toBe(1);
    expect(status.retrying[0]).toMatchObject({ pagePlanId: "tp-1", attempts: 1 });
    expect(status.retrying[0].lastError).toMatch(/could not be reached/);
    expect(status.waitingForCapacity).toBe(0);
  });

  it("really sends a page whose first attempt never reached the provider", async () => {
    const { db, project, items } = makePage();
    let attempt = 0;
    const adapter: GenerationAdapter = {
      submit: vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw new FalProviderError("FAL queue submit gave up after 120s.", { classification: "provider_timeout", retryable: true });
        return { requestId: "req-real", gatewayRequestId: "req-real", responseUrl: null, statusUrl: null, cancelUrl: null };
      }),
      status: vi.fn(async (_e, requestId) => ({ status: "IN_QUEUE" as const, requestId })),
      result: vi.fn(async () => ({ images: [{ url: "https://fal.media/files/r.png", content_type: "image/png", width: 1, height: 1 }] })),
      cancel: vi.fn(async () => "cancellation_requested" as const),
      downloadImage: vi.fn(async () => ({ bytes: pngBytes, contentType: "image/png" })),
    };
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 50, maxActivePerProject: 50 });
    enqueueGenerations(db, owner.id, project.id, items);

    await drainQueueOnce(db, service, 2);
    await drainQueueOnce(db, service, 2);

    // The regression: the retry found the first attempt's dead job by its
    // idempotency key and replayed it as a success, so the queue reported the
    // page sent while the provider had never seen a request for it.
    expect(adapter.submit).toHaveBeenCalledTimes(2);
    expect(queueStatus(db, owner.id, project.id).submitted).toBe(1);
    const jobs = db.prepare(`SELECT fal_request_id AS falRequestId, local_status AS localStatus FROM generation_jobs WHERE user_id = ? ORDER BY created_at`).all(owner.id) as Array<{ falRequestId: string | null; localStatus: string }>;
    expect(jobs.map((job) => job.falRequestId)).toContain("req-real");
    const live = db.prepare(`SELECT generation_job_id AS jobId FROM generation_queue WHERE user_id = ? AND status = 'submitted'`).get(owner.id) as { jobId: string };
    const linked = db.prepare(`SELECT fal_request_id AS falRequestId FROM generation_jobs WHERE id = ?`).get(live.jobId) as { falRequestId: string | null };
    expect(linked.falRequestId).toBe("req-real");
  });

  it("still refuses to send a second billable request for work the provider already took", async () => {
    const { db, project, items } = makePage();
    const adapter: GenerationAdapter = {
      submit: vi.fn(async () => ({ requestId: "req-once", gatewayRequestId: "req-once", responseUrl: null, statusUrl: null, cancelUrl: null })),
      status: vi.fn(async (_e, requestId) => ({ status: "IN_QUEUE" as const, requestId })),
      result: vi.fn(async () => ({ images: [{ url: "https://fal.media/files/r.png", content_type: "image/png", width: 1, height: 1 }] })),
      cancel: vi.fn(async () => "cancellation_requested" as const),
      downloadImage: vi.fn(async () => ({ bytes: pngBytes, contentType: "image/png" })),
    };
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 50, maxActivePerProject: 50 });
    const request = { projectId: project.id, pagePlanId: items[0].pagePlanId, promptVersionId: items[0].promptVersionId, generationModel: "Reviewed model", generationEndpoint: "reviewed/model", aspectRatio: "1:1", referenceAssetIds: [], expectedOutputConstraints: {}, idempotencyKey: "same-key", requestKind: "initial" as const };

    const first = await service.submit(db, owner.id, request);
    const second = await service.submit(db, owner.id, request);

    expect(adapter.submit).toHaveBeenCalledTimes(1);
    expect(second.localJobId).toBe(first.localJobId);
    expect(second.falRequestId).toBe("req-once");
  });

  it("keeps waiting on a capacity refusal without spending an attempt or alarming the author", async () => {
    const { db, project, items } = makePage();
    const adapter = adapterThatFails('Per-user generation concurrency limit reached (12). Wait for a job to finish, or press "Cancel stuck jobs".');
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 50, maxActivePerProject: 50 });
    enqueueGenerations(db, owner.id, project.id, items);

    for (let tick = 0; tick < 6; tick += 1) await drainQueueOnce(db, service, 2);

    const status = queueStatus(db, owner.id, project.id);
    expect(status.pending).toBe(1);
    expect(status.failed).toBe(0);
    expect(status.retrying).toHaveLength(0);
    expect(status.waitingForCapacity).toBe(1);
    expect(adapter.submit).toHaveBeenCalledTimes(6);
  });
});
