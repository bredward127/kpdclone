import express from "express";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { clearSession, getCurrentUser, isDevAuthEnabled, setSession } from "./auth";
import { createDatabase } from "./db";
import { createAppRouter } from "./routers";

const db = createDatabase();
const appRouter = createAppRouter(db);
const app = express();

app.use(express.json({ limit: "1mb" }));

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
