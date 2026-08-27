import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getFalQueueClient } from "../server/fal-queue";

const confirmation = process.env.CONFIRM_LIVE_FAL;
if (process.env.CI) throw new Error("Live FAL smoke tests are disabled in CI.");
if (process.env.LIVE_FAL_SMOKE !== "1" || confirmation !== "GENERATE_ONE_TEST_IMAGE") throw new Error("This smoke test is opt-in only. Set LIVE_FAL_SMOKE=1 and CONFIRM_LIVE_FAL=GENERATE_ONE_TEST_IMAGE to generate exactly one disposable test image.");
if (!process.env.FAL_KEY) throw new Error("FAL_KEY is required for the live smoke test and is never printed or logged.");
const endpoint = process.env.FAL_SMOKE_ENDPOINT;
if (!endpoint) throw new Error("FAL_SMOKE_ENDPOINT must identify an administrator-reviewed inexpensive image endpoint.");

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kdp-fal-smoke-"));
const client = getFalQueueClient(process.env);
let requestId: string | null = null;
try {
  const submitted = await client.submit(endpoint, { prompt: "A simple original line-art garden seedling on white paper; no text, logos, trademarks, or recognizable characters.", num_images: 1, output_format: "png" });
  requestId = submitted.requestId;
  let status = await client.status(endpoint, requestId);
  const deadline = Date.now() + 180_000;
  while (status.status !== "COMPLETED" && Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 2_000)); status = await client.status(endpoint, requestId); }
  if (status.status !== "COMPLETED") throw new Error("Live FAL smoke test timed out; no retry is attempted.");
  const result = await client.result(endpoint, requestId);
  const image = Array.isArray(result.images) ? result.images[0] as { url?: string } : undefined;
  if (!image?.url) throw new Error("Live FAL smoke test returned no image URL.");
  const downloaded = await client.downloadImage(image.url, 20 * 1024 * 1024);
  await fs.writeFile(path.join(tempDir, "one-test-image"), downloaded.bytes);
  if (process.env.FAL_SMOKE_ADMIN === "1") console.info(`Live FAL smoke test completed. Provider request ID: ${requestId}`);
  else console.info("Live FAL smoke test completed. Provider request ID is restricted to authorized administrators.");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  requestId = null;
}
