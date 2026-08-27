import express from "express";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { clearSession, getCurrentUser, isDevAuthEnabled, setSession } from "./auth";
import { assertFalConfiguredForProduction } from "./fal";
import { createDatabase } from "./db";
import { createAppRouter } from "./routers";
import { getReferenceAssetByStorageKeyForUser } from "./reference-assets";
import { readPrivateStorageBytes, verifyStorageAccessSignature } from "./storage";

assertFalConfiguredForProduction();

const db = createDatabase();
const appRouter = createAppRouter(db);
const app = express();

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

export { app, appRouter };
