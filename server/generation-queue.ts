import crypto from "node:crypto";
import type { AppDatabase } from "./db";
import { getProjectForUser } from "./db";
import { getPromptVersionForUser } from "./prompt-composer";
import { getFalModel } from "./fal-models";
import { estimateImageCostUsd } from "../shared/image-cost";
import type { FalGenerationService } from "./fal-generation";

export type QueueRow = {
  id: string;
  userId: string;
  projectId: string;
  pagePlanId: string;
  promptVersionId: string;
  status: "pending" | "submitting" | "submitted" | "failed" | "cancelled";
  attempts: number;
  lastError: string | null;
  generationJobId: string | null;
  estimatedCostUsd: number;
  batchId: string;
  createdAt: string;
};

const MAX_ATTEMPTS = 3;

function now(): string { return new Date().toISOString(); }

/**
 * True only for a refusal that resolves on its own as in-flight work drains:
 * our own per-user/per-project cap, or the provider's rate limit.
 */
export function isCapacityRefusal(message: string): boolean {
  return /concurrency limit reached|Too many generation requests|rate limit|HTTP 429/i.test(message);
}

/**
 * How many submissions the worker makes per tick, and how long it waits between
 * ticks. Deliberately conservative: the provider queues work anyway, so pacing
 * costs nothing but avoids the submit limiter and gives the author a running
 * count instead of a wall of failures.
 */
export function workerPacing(env: NodeJS.ProcessEnv = process.env): { intervalMs: number; perTick: number } {
  const interval = Number(env.GENERATION_WORKER_INTERVAL_MS);
  const perTick = Number(env.GENERATION_WORKER_PER_TICK);
  return {
    intervalMs: Number.isFinite(interval) && interval >= 1_000 ? Math.min(interval, 120_000) : 6_000,
    perTick: Number.isFinite(perTick) && perTick >= 1 ? Math.min(Math.floor(perTick), 10) : 2,
  };
}

export type EnqueueResult = {
  batchId: string;
  queued: number;
  skipped: Array<{ pagePlanId: string; reason: string }>;
  estimatedCostUsd: number;
};

/**
 * Record the intent to generate these pages. No provider call happens here, so
 * a 50-page book is enqueued in one fast request that cannot be cut short.
 */
export function enqueueGenerations(
  db: AppDatabase,
  userId: string,
  projectId: string,
  items: Array<{ pagePlanId: string; promptVersionId: string }>,
  options: { maxSpendUsd?: number } = {},
): EnqueueResult {
  const project = getProjectForUser(db, userId, projectId);
  if (!project) throw new Error("Project not found.");
  const batchId = crypto.randomUUID();
  const skipped: EnqueueResult["skipped"] = [];
  let estimatedCostUsd = 0;
  let queued = 0;

  const insert = db.prepare(
    `INSERT INTO generation_queue (id, user_id, project_id, page_plan_id, prompt_version_id, status, estimated_cost_usd, batch_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  );

  const run = db.transaction(() => {
    for (const item of items) {
      const prompt = getPromptVersionForUser(db, userId, item.promptVersionId);
      if (!prompt || prompt.projectId !== projectId || prompt.pagePlanId !== item.pagePlanId) {
        skipped.push({ pagePlanId: item.pagePlanId, reason: "The frozen prompt for this page could not be found." });
        continue;
      }
      if (prompt.status !== "approved") {
        skipped.push({ pagePlanId: item.pagePlanId, reason: "This page's prompt is not frozen." });
        continue;
      }
      // Already waiting or in flight: never queue a page twice, or the author
      // pays twice for one picture.
      const live = db.prepare(`SELECT id FROM generation_queue WHERE user_id = ? AND page_plan_id = ? AND status IN ('pending', 'submitting')`).get(userId, item.pagePlanId) as { id: string } | undefined;
      if (live) { skipped.push({ pagePlanId: item.pagePlanId, reason: "This page is already queued." }); continue; }
      const active = db.prepare(`SELECT id FROM generation_jobs WHERE user_id = ? AND page_plan_id = ? AND local_status IN ('queued', 'in_progress', 'cancellation_requested')`).get(userId, item.pagePlanId) as { id: string } | undefined;
      if (active) { skipped.push({ pagePlanId: item.pagePlanId, reason: "This page already has work in flight." }); continue; }

      const model = getFalModel(prompt.generationEndpoint);
      const perImage = model ? estimateImageCostUsd(model.pricing, project.imageQuality, 1) ?? 0 : 0;
      if (options.maxSpendUsd !== undefined && estimatedCostUsd + perImage > options.maxSpendUsd) {
        skipped.push({ pagePlanId: item.pagePlanId, reason: `Stopped at the ${options.maxSpendUsd.toFixed(2)} USD cap for this batch.` });
        continue;
      }

      // Settled rows for this page would collide with the per-status unique
      // index, and their history lives in generation_jobs anyway.
      db.prepare(`DELETE FROM generation_queue WHERE user_id = ? AND page_plan_id = ? AND status IN ('failed', 'cancelled', 'submitted')`).run(userId, item.pagePlanId);
      insert.run(crypto.randomUUID(), userId, projectId, item.pagePlanId, item.promptVersionId, perImage, batchId, now(), now());
      estimatedCostUsd += perImage;
      queued += 1;
    }
  });
  run();

  return { batchId, queued, skipped, estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)) };
}

export function queueStatus(db: AppDatabase, userId: string, projectId: string) {
  const counts = db.prepare(
    `SELECT status, COUNT(*) AS count FROM generation_queue WHERE user_id = ? AND project_id = ? GROUP BY status`,
  ).all(userId, projectId) as Array<{ status: QueueRow["status"]; count: number }>;
  const byStatus = Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])) as Partial<Record<QueueRow["status"], number>>;
  const failures = db.prepare(
    `SELECT page_plan_id AS pagePlanId, last_error AS lastError FROM generation_queue
     WHERE user_id = ? AND project_id = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 10`,
  ).all(userId, projectId) as Array<{ pagePlanId: string; lastError: string | null }>;
  // A page waiting *because something went wrong* reads as an idle queue
  // unless its error is reported while it is still pending. Waiting for a
  // free concurrency slot is not a problem, so it is counted separately
  // rather than alarming the author about a queue that is working.
  const waiting = db.prepare(
    `SELECT page_plan_id AS pagePlanId, last_error AS lastError, attempts FROM generation_queue
     WHERE user_id = ? AND project_id = ? AND status IN ('pending', 'submitting') AND last_error IS NOT NULL
     ORDER BY updated_at DESC LIMIT 20`,
  ).all(userId, projectId) as Array<{ pagePlanId: string; lastError: string; attempts: number }>;
  const retrying = waiting.filter((row) => !isCapacityRefusal(row.lastError)).slice(0, 5);
  const waitingForCapacity = waiting.length - retrying.length;
  const spend = db.prepare(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM generation_queue
     WHERE user_id = ? AND project_id = ? AND status IN ('pending', 'submitting', 'submitted')`,
  ).get(userId, projectId) as { total: number };
  const pending = (byStatus.pending ?? 0) + (byStatus.submitting ?? 0);
  return {
    pending,
    submitted: byStatus.submitted ?? 0,
    failed: byStatus.failed ?? 0,
    cancelled: byStatus.cancelled ?? 0,
    estimatedRemainingCostUsd: Number((((byStatus.pending ?? 0) + (byStatus.submitting ?? 0)) && spend.total ? spend.total : 0).toFixed(4)),
    failures,
    retrying,
    waitingForCapacity,
    draining: pending > 0,
  };
}

/** Drop everything still waiting. Work already sent to the provider is not affected. */
export function clearQueue(db: AppDatabase, userId: string, projectId: string): { cancelled: number } {
  const result = db.prepare(
    `UPDATE generation_queue SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND project_id = ? AND status IN ('pending', 'submitting')`,
  ).run(now(), userId, projectId);
  return { cancelled: result.changes };
}

/**
 * Submit at most `perTick` queued pages. Claims each row before calling the
 * provider so a second worker (or a restart mid-tick) cannot submit it twice.
 *
 * A concurrency refusal is not a failure: the row goes back to pending and is
 * retried on a later tick, which is what lets a long book drain steadily
 * instead of erroring out.
 */
export async function drainQueueOnce(
  db: AppDatabase,
  service: FalGenerationService,
  perTick: number,
): Promise<{ submitted: number; deferred: number; failed: number }> {
  const claimed: QueueRow[] = [];
  const claim = db.transaction(() => {
    const rows = db.prepare(
      `SELECT id, user_id AS userId, project_id AS projectId, page_plan_id AS pagePlanId,
              prompt_version_id AS promptVersionId, status, attempts, last_error AS lastError,
              generation_job_id AS generationJobId, estimated_cost_usd AS estimatedCostUsd,
              batch_id AS batchId, created_at AS createdAt
       FROM generation_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
    ).all(perTick) as QueueRow[];
    for (const row of rows) {
      db.prepare(`UPDATE generation_queue SET status = 'submitting', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'`).run(now(), row.id);
      claimed.push(row);
    }
  });
  claim();
  if (!claimed.length) return { submitted: 0, deferred: 0, failed: 0 };

  let submitted = 0;
  let deferred = 0;
  let failed = 0;

  for (const row of claimed) {
    try {
      const prompt = getPromptVersionForUser(db, row.userId, row.promptVersionId);
      if (!prompt) throw new Error("The frozen prompt for this page no longer exists.");
      const result = await service.submit(db, row.userId, {
        projectId: row.projectId,
        pagePlanId: row.pagePlanId,
        promptVersionId: row.promptVersionId,
        generationModel: prompt.generationModel,
        generationEndpoint: prompt.generationEndpoint,
        aspectRatio: prompt.aspectRatio,
        seed: prompt.seed ?? undefined,
        referenceAssetIds: prompt.referenceAssetIds,
        expectedOutputConstraints: { mimeTypes: ["image/png", "image/jpeg", "image/webp"], maxPixels: 25_000_000 },
        // Keyed to the queue row, so a retry of the same row cannot produce a
        // second billable image.
        idempotencyKey: `queue-${row.id}`,
        requestKind: "initial",
      });
      db.prepare(`UPDATE generation_queue SET status = 'submitted', generation_job_id = ?, last_error = NULL, updated_at = ? WHERE id = ?`).run(result.localJobId, now(), row.id);
      submitted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "This page could not be submitted.";
      // Capacity, not a fault: wait and try again rather than burning an
      // attempt. This is the only refusal allowed to retry forever, because
      // it clears by itself as jobs already in flight finish.
      //
      // A timeout or an unreachable provider is deliberately NOT in here.
      // Retrying those without consuming an attempt makes a broken provider
      // look like a queue that is quietly working: pages sit at "queued"
      // forever, nothing reaches the provider, and no error ever surfaces.
      if (isCapacityRefusal(message)) {
        db.prepare(`UPDATE generation_queue SET status = 'pending', attempts = MAX(0, attempts - 1), last_error = ?, updated_at = ? WHERE id = ?`).run(message, now(), row.id);
        deferred += 1;
        // Nothing will succeed this tick once capacity is gone.
        break;
      }
      if (row.attempts + 1 >= MAX_ATTEMPTS) {
        db.prepare(`UPDATE generation_queue SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`).run(message, now(), row.id);
        failed += 1;
      } else {
        db.prepare(`UPDATE generation_queue SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`).run(message, now(), row.id);
        deferred += 1;
      }
    }
  }
  return { submitted, deferred, failed };
}

/** Owners with jobs the provider may have finished, so only they are polled. */
export function usersWithActiveWork(db: AppDatabase): string[] {
  return (db.prepare(
    `SELECT DISTINCT user_id AS userId FROM generation_jobs
     WHERE local_status IN ('queued', 'in_progress', 'cancellation_requested') LIMIT 50`,
  ).all() as Array<{ userId: string }>).map((row) => row.userId);
}

/**
 * Start the background worker. Ticks are serialised: a slow tick delays the
 * next one rather than overlapping with it and double-submitting.
 */
export function startGenerationWorker(
  db: AppDatabase,
  service: FalGenerationService,
  env: NodeJS.ProcessEnv = process.env,
): { stop: () => void } {
  const { intervalMs, perTick } = workerPacing(env);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        // Collect finished work first: it frees the concurrency slots the
        // queue is waiting on, so images land and the queue keeps moving even
        // with no webhook configured.
        for (const owner of usersWithActiveWork(db)) {
          await service.reconcileActiveJobs(db, owner, undefined, 15_000).catch(() => undefined);
        }
        await drainQueueOnce(db, service, perTick);
      } catch (error) {
        console.error("Generation worker tick failed", { message: error instanceof Error ? error.message : "unknown" });
      } finally {
        running = false;
      }
    })();
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
