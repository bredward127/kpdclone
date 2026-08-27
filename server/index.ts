import express from "express";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { clearSession, getCurrentUser, isDevAuthEnabled, isTestAuthEnabled, isValidTestAuthPassword, setSession } from "./auth";
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
import crypto from "node:crypto";
import { applySecurityHeaders, createRateLimiter, redactSensitive } from "./security";

assertFalConfiguredForProduction();
assertFalWebhookConfiguredForProduction();

const db = createDatabase();
const storage = createLocalPrivateStorage();
const falConfig = loadFalConfig();
const generationService = falConfig ? createFalGenerationService({ adapter: getFalQueueClient(), storage, webhookUrl: process.env.FAL_WEBHOOK_URL }) : undefined;
const appRouter = createAppRouter(db, { storage, generationService });
const app = express();
const webhookLimiter = createRateLimiter(60_000, 120);
app.use((_req, res, next) => { applySecurityHeaders(res); next(); });

app.post("/api/fal/webhook", express.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
  const limit = webhookLimiter(`webhook:${req.ip ?? "unknown"}`);
  if (!limit.allowed) { res.setHeader("Retry-After", String(limit.retryAfterSeconds)); res.status(429).json({ message: "Webhook rate limit exceeded." }); return; }
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
  const requestId = String((payload as Record<string, unknown>).request_id);
  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  try {
    db.prepare("INSERT INTO fal_webhook_events (request_id, payload_sha256, received_at) VALUES (?, ?, ?)").run(requestId, payloadHash, new Date().toISOString());
  } catch {
    const prior = db.prepare("SELECT payload_sha256 FROM fal_webhook_events WHERE request_id = ?").get(requestId) as { payload_sha256?: string } | undefined;
    const reason = prior?.payload_sha256 !== payloadHash ? "payload_conflict" : "replay";
    db.prepare("INSERT INTO fal_webhook_conflicts (id, request_id, payload_sha256, reason, received_at) VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(), requestId, payloadHash, reason, new Date().toISOString());
    if (reason === "payload_conflict") { res.status(409).json({ message: "Webhook request ID was already used with a different payload." }); return; }
    res.status(409).json({ message: "Webhook request has already been accepted." });
    return;
  }
  res.status(202).json({ accepted: true });
  if (!generationService) return;
  void generationService.processWebhook(db, payload as Parameters<typeof generationService.processWebhook>[1]).then(() => { db.prepare("UPDATE fal_webhook_events SET processed_at = ? WHERE request_id = ?").run(new Date().toISOString(), requestId); }).catch((error) => { console.error("FAL webhook processing failed", redactSensitive({ requestId, error: error instanceof Error ? error.message : "unknown" }, [process.env.FAL_KEY ?? ""])); });
});

app.use(express.urlencoded({ extended: false, limit: "10kb" }));
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

app.get("/auth/test-login", (_req, res) => {
  if (!isTestAuthEnabled()) {
    res.status(404).json({ message: "Not found" });
    return;
  }
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Private test login</title></head><body><main><h1>Private test login</h1><p>This temporary login is for owner testing only. Disable it before inviting customers.</p><form method="post" action="/auth/test-login"><label for="password">Test password</label><input id="password" name="password" type="password" required autofocus><button type="submit">Sign in for testing</button></form></main></body></html>`);
});

app.post("/auth/test-login", (req, res) => {
  if (!isTestAuthEnabled() || typeof req.body?.password !== "string" || !isValidTestAuthPassword(req.body.password)) {
    res.status(401).type("html").send("<!doctype html><title>Unauthorized</title><p>Test login failed.</p>");
    return;
  }
  setSession(res, { id: "render-test-creator", name: "Render Test Creator", email: "render-test@example.com" });
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
  try { const bytes = await readPrivateStorageBytes(asset.storageReference); res.setHeader("Cache-Control", "private, max-age=300"); res.setHeader("Content-Disposition", `inline; filename="generated-asset-${asset.id}.bin"`); res.setHeader("X-Content-Type-Options", "nosniff"); res.type(asset.mimeType).send(bytes); }
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
    res.setHeader("Content-Disposition", `inline; filename="reference-${reference.id}.bin"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
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
