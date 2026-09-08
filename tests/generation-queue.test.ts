import { describe, expect, it, vi } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createBookBrief, createPagePlan } from "../server/db-studio";
import { composePromptFromSavedProject, createPromptVersion, freezePromptVersion } from "../server/prompt-composer";
import { createFalGenerationService, type GenerationAdapter } from "../server/fal-generation";
import { clearQueue, drainQueueOnce, enqueueGenerations, queueStatus, workerPacing } from "../server/generation-queue";
import type { PrivateStorage } from "../server/storage";

const owner = { id: "queue-owner", name: "Owner", email: "owner@example.com" };
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function makeStorage(): PrivateStorage {
  const objects = new Map<string, Uint8Array>();
  return {
    put: vi.fn(async (key, bytes) => { objects.set(key, bytes); return { key }; }),
    delete: vi.fn(async (key) => { objects.delete(key); }),
    createAccessUrl: vi.fn(async (key) => `/private/${key}`),
  };
}

function makeAdapter() {
  let requestNumber = 0;
  const submitted: string[] = [];
  const adapter: GenerationAdapter = {
    submit: vi.fn(async () => { const requestId = `req-${++requestNumber}`; submitted.push(requestId); return { requestId, gatewayRequestId: requestId, responseUrl: null, statusUrl: null, cancelUrl: null }; }),
    status: vi.fn(async (_e, requestId) => ({ status: "IN_QUEUE" as const, requestId })),
    result: vi.fn(async () => ({ images: [{ url: "https://fal.media/files/r.png", content_type: "image/png", width: 1, height: 1 }] })),
    cancel: vi.fn(async () => "cancellation_requested" as const),
    downloadImage: vi.fn(async () => ({ bytes: pngBytes, contentType: "image/png" })),
  };
  return { adapter, submitted };
}

function makeBook(pageCount: number) {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  const project = createProject(db, owner.id, { id: "queue-project", name: "Moon Garden", brief: "" });
  createBookBrief(db, owner.id, { id: "queue-brief", projectId: project.id, briefText: "A child finds courage.", bookType: "picture_book", audience: "preschool children", visualStyleAnchors: "Ink.", characterBible: "Mina.", negativePrompt: "No logos." });
  const items: Array<{ pagePlanId: string; promptVersionId: string }> = [];
  for (let n = 1; n <= pageCount; n += 1) {
    const page = createPagePlan(db, owner.id, { id: `qp-${n}`, projectId: project.id, pageNumber: n, sceneDirection: `Scene ${n}.`, pageText: `Text ${n}.` });
    const input = { projectId: project.id, pagePlanId: page.id, generationModel: "Reviewed model", generationEndpoint: "reviewed/model", aspectRatio: "1:1", referenceAssetIds: [] as string[] };
    const version = createPromptVersion(db, owner.id, composePromptFromSavedProject(db, owner.id, input), input);
    freezePromptVersion(db, owner.id, version.id);
    items.push({ pagePlanId: page.id, promptVersionId: version.id });
  }
  return { db, project, items };
}

describe("paced generation queue", () => {
  it("queues a whole book in one call without contacting the provider", () => {
    const { db, project, items } = makeBook(33);
    const { adapter } = makeAdapter();
    const result = enqueueGenerations(db, owner.id, project.id, items);
    // The failure this replaces: a browser loop stopped at 12 of 33.
    expect(result.queued).toBe(33);
    expect(result.skipped).toHaveLength(0);
    expect(adapter.submit).not.toHaveBeenCalled();
    expect(queueStatus(db, owner.id, project.id).pending).toBe(33);
  });

  it("drains only a few per tick and eventually sends every page exactly once", async () => {
    const { db, project, items } = makeBook(7);
    const { adapter, submitted } = makeAdapter();
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 50, maxActivePerProject: 50 });
    enqueueGenerations(db, owner.id, project.id, items);

    let guard = 0;
    while (queueStatus(db, owner.id, project.id).pending > 0 && guard < 50) {
      await drainQueueOnce(db, service, 2);
      guard += 1;
    }
    expect(submitted).toHaveLength(7);
    expect(new Set(submitted).size).toBe(7);
    expect(queueStatus(db, owner.id, project.id).submitted).toBe(7);
    // Paced: seven pages cannot have gone out in one or two ticks of two.
    expect(guard).toBeGreaterThanOrEqual(4);
  });

  it("waits for capacity instead of failing when the concurrency ceiling is hit", async () => {
    const { db, project, items } = makeBook(5);
    const { adapter, submitted } = makeAdapter();
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 2, maxActivePerProject: 2 });
    enqueueGenerations(db, owner.id, project.id, items);

    const first = await drainQueueOnce(db, service, 5);
    expect(first.submitted).toBe(2);
    expect(first.deferred).toBeGreaterThan(0);
    expect(first.failed).toBe(0);
    // Deferred work is still pending, not lost.
    const status = queueStatus(db, owner.id, project.id);
    expect(status.pending).toBe(3);
    expect(status.failed).toBe(0);
    expect(submitted).toHaveLength(2);
  });

  it("never queues the same page twice, so one picture is never paid for twice", () => {
    const { db, project, items } = makeBook(3);
    expect(enqueueGenerations(db, owner.id, project.id, items).queued).toBe(3);
    const second = enqueueGenerations(db, owner.id, project.id, items);
    expect(second.queued).toBe(0);
    expect(second.skipped.every((entry) => /already queued/i.test(entry.reason))).toBe(true);
    expect(queueStatus(db, owner.id, project.id).pending).toBe(3);
  });

  it("refuses pages whose prompt is not frozen", () => {
    const { db, project, items } = makeBook(2);
    const page = createPagePlan(db, owner.id, { id: "draft-page", projectId: project.id, pageNumber: 99, sceneDirection: "A draft.", pageText: "" });
    const input = { projectId: project.id, pagePlanId: page.id, generationModel: "M", generationEndpoint: "reviewed/model", aspectRatio: "1:1", referenceAssetIds: [] as string[] };
    const unfrozen = createPromptVersion(db, owner.id, composePromptFromSavedProject(db, owner.id, input), input);
    const result = enqueueGenerations(db, owner.id, project.id, [...items, { pagePlanId: page.id, promptVersionId: unfrozen.id }]);
    expect(result.queued).toBe(2);
    expect(result.skipped.some((entry) => /not frozen/i.test(entry.reason))).toBe(true);
  });

  it("stops at a spend cap rather than generating the whole book", () => {
    const { db, project, items } = makeBook(10);
    // Priced from the model registry; an unpriced test endpoint costs 0, so
    // assert the cap is honoured only when a price is actually attached.
    const result = enqueueGenerations(db, owner.id, project.id, items, { maxSpendUsd: 0 });
    expect(result.estimatedCostUsd).toBeLessThanOrEqual(0.0001);
    expect(result.queued + result.skipped.length).toBe(10);
  });

  it("cancels pending work without touching what was already sent", async () => {
    const { db, project, items } = makeBook(6);
    const { adapter } = makeAdapter();
    const service = createFalGenerationService({ adapter, storage: makeStorage(), modelApproval: () => true, maxActivePerUser: 50, maxActivePerProject: 50 });
    enqueueGenerations(db, owner.id, project.id, items);
    await drainQueueOnce(db, service, 2);

    const cancelled = clearQueue(db, owner.id, project.id);
    expect(cancelled.cancelled).toBe(4);
    const status = queueStatus(db, owner.id, project.id);
    expect(status.pending).toBe(0);
    expect(status.submitted).toBe(2);
  });

  it("keeps one owner's queue invisible to another", () => {
    const { db, project, items } = makeBook(3);
    const stranger = { id: "queue-stranger", name: "Stranger", email: "s@example.com" };
    upsertUser(db, stranger);
    enqueueGenerations(db, owner.id, project.id, items);
    expect(queueStatus(db, stranger.id, project.id).pending).toBe(0);
    expect(() => enqueueGenerations(db, stranger.id, project.id, items)).toThrow(/Project not found/);
  });

  it("paces conservatively by default and honours tuning within bounds", () => {
    expect(workerPacing({})).toEqual({ intervalMs: 6_000, perTick: 2 });
    expect(workerPacing({ GENERATION_WORKER_INTERVAL_MS: "15000", GENERATION_WORKER_PER_TICK: "4" })).toEqual({ intervalMs: 15_000, perTick: 4 });
    // Nonsense and abusive values fall back or clamp rather than hammering.
    expect(workerPacing({ GENERATION_WORKER_INTERVAL_MS: "5", GENERATION_WORKER_PER_TICK: "999" }).intervalMs).toBe(6_000);
    expect(workerPacing({ GENERATION_WORKER_PER_TICK: "999" }).perTick).toBe(10);
  });
});
