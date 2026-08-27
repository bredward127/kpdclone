import express from "express";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { clearSession, getCurrentUser, isDevAuthEnabled, setSession } from "./auth";
import { assertFalConfiguredForProduction, assertFalWebhookConfiguredForProduction, loadFalConfig } from "./fal";
import { verifyFalWebhookSignature } from "./fal-queue";
import { createFalGenerationService } from "./fal-generation";
import { getFalQueueClient } from "./fal-queue";
import { createLocalPrivateStorage } from "./storage";
import { createDatabase } from "./db";
import { createAppRouter } from "./routers";
import { getReferenceAssetByStorageKeyForUser } from "./reference-assets";
import { getGeneratedAssetByStorageReferenceForUser } from "./db-studio";
import { readPrivateStorageBytes, verifyStorageAccessSignature } from "./storage";

assertFalConfiguredForProduction();
assertFalWebhookConfiguredForProduction();

const db = createDatabase();
const storage = createLocalPrivateStorage();
const falConfig = loadFalConfig();
const generationService = falConfig ? createFalGenerationService({ adapter: getFalQueueClient(), storage, webhookUrl: process.env.FAL_WEBHOOK_URL }) : undefined;
const appRouter = createAppRouter(db, { storage, generationService });
const app = express();

app.post("/api/fal/webhook", express.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
  if (process.env.FAL_WEBHOOK_ENABLED !== "true") {
    res.status(503).json({ message: "FAL webhooks are disabled until webhook verification is enabled." });
    return;
  }
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  const headers = {
    "x-fal-webhook-request-id": typeof req.headers["x-fal-webhook-request-id"] === "string" ? req.headers["x-fal-webhook-request-id"] : undefined,
    "x-fal-webhook-user-id": typeof req.headers["x-fal-webhook-user-id"] === "string" ? req.headers["x-fal-webhook-user-id"] : undefined,
    "x-fal-webhook-timestamp": typeof req.headers["x-fal-webhook-timestamp"] === "string" ? req.headers["x-fal-webhook-timestamp"] : undefined,
    "x-fal-webhook-signature": typeof req.headers["x-fal-webhook-signature"] === "string" ? req.headers["x-fal-webhook-signature"] : undefined,
  };
  try {
    const verified = await verifyFalWebhookSignature(rawBody, headers, { jwksUrl: process.env.FAL_WEBHOOK_JWKS_URL });
    if (!verified) {
      res.status(401).json({ message: "FAL webhook signature is invalid." });
      return;
    }
  } catch {
    res.status(503).json({ message: "FAL webhook verification is temporarily unavailable." });
    return;
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch {
    res.status(400).json({ message: "FAL webhook payload is malformed." });
    return;
  }
  if (!payload || typeof payload !== "object" || typeof (payload as Record<string, unknown>).request_id !== "string" || ((payload as Record<string, unknown>).status !== "OK" && (payload as Record<string, unknown>).status !== "ERROR")) {
    res.status(400).json({ message: "FAL webhook payload is malformed." });
    return;
  }
  res.status(202).json({ accepted: true });
  if (!generationService) return;
  void generationService.processWebhook(db, payload as Parameters<typeof generationService.processWebhook>[1]).catch(() => undefined);
});

app.use(express.json({ limit: process.env.VISUAL_REFERENCE_JSON_LIMIT ?? "20mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "kdp-kids-book-studio" });
});

app.get("/auth/dev-login", (req, res) => {
  if (!isDevAuthEnabled()) {
    res.status(404).json({ message: "Not found" });
    return;
  }

  const user = {
    id: String(req.query.userId || "demo-creator"),
    name: String(req.query.name || "Demo Creator"),
    email: String(req.query.email || "creator@example.com"),
  };
  setSession(res, user);
  res.redirect("/");
});

app.post("/auth/logout", (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

app.get("/api/generated-assets/file", async (req, res) => {
  const key = typeof req.query.key === "string" ? req.query.key : "";
  const expires = typeof req.query.expires === "string" ? Number(req.query.expires) : NaN;
  const signature = typeof req.query.signature === "string" ? req.query.signature : "";
  const user = getCurrentUser(req, db);
  if (!user || !verifyStorageAccessSignature(key, expires, signature)) { res.status(401).json({ message: "Generated asset access is unauthorized." }); return; }
  const asset = getGeneratedAssetByStorageReferenceForUser(db, user.id, key);
  if (!asset) { res.status(404).json({ message: "Generated asset not found." }); return; }
  try { const bytes = await readPrivateStorageBytes(asset.storageReference); res.setHeader("Cache-Control", "private, max-age=300"); res.type(asset.mimeType).send(bytes); }
  catch { res.status(404).json({ message: "Generated asset not found." }); }
});

app.get("/api/reference-assets/file", async (req, res) => {
  const key = typeof req.query.key === "string" ? req.query.key : "";
  const expires = typeof req.query.expires === "string" ? Number(req.query.expires) : NaN;
  const signature = typeof req.query.signature === "string" ? req.query.signature : "";
  const user = getCurrentUser(req, db);
  if (!user || !verifyStorageAccessSignature(key, expires, signature)) {
    res.status(401).json({ message: "Reference access is unauthorized." });
    return;
  }
  const reference = getReferenceAssetByStorageKeyForUser(db, user.id, key);
  if (!reference || reference.status !== "active") {
    res.status(404).json({ message: "Visual reference not found." });
    return;
  }
  try {
    const bytes = await readPrivateStorageBytes(reference.storageKey);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.type(reference.mimeType).send(bytes);
  } catch {
    res.status(404).json({ message: "Visual reference not found." });
  }
});

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req, res }) => ({
      db,
      user: getCurrentUser(req, db),
      res,
    }),
  }),
);

const clientDist = path.resolve(process.cwd(), "dist/client");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`KDP Kids Book Studio listening on :${port}`);
});

export { app, appRouter, generationService };
