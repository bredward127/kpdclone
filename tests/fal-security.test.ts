import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "../server/db";
import { createFalClient, assertFalConfiguredForProduction, getFalConnectionStatus, loadFalConfig } from "../server/fal";
import { createAppRouter } from "../server/routers";

const syntheticSentinel = ["synthetic", "fal", "sentinel", "for", "tests"].join("-");
const admin = { id: "admin-1", name: "Admin", email: "admin@example.com" };
const creator = { id: "creator-1", name: "Creator", email: "creator@example.com" };

function flatten(value: unknown): string {
  return JSON.stringify(value);
}

describe("FAL secret boundary", () => {
  it("loads FAL_KEY only into a server-side typed config and fails production startup without it", () => {
    const config = loadFalConfig({ FAL_KEY: syntheticSentinel, NODE_ENV: "production" });
    expect(config).toMatchObject({ apiKey: syntheticSentinel, baseUrl: "https://api.fal.ai" });

    expect(() => assertFalConfiguredForProduction({ NODE_ENV: "production" })).toThrow("FAL_KEY is absent");
    expect(() => assertFalConfiguredForProduction({ NODE_ENV: "production" })).toThrow(/FAL_KEY/);
    expect(() => assertFalConfiguredForProduction({ NODE_ENV: "production" })).not.toThrow(syntheticSentinel);
  });

  it("returns only a masked status and keeps provider errors and logs free of the key", async () => {
    const error = new Error(syntheticSentinel);
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error);
    const logged: unknown[] = [];
    const status = await createFalClient(
      { apiKey: syntheticSentinel, baseUrl: "https://api.fal.ai", timeoutMs: 10 },
      { fetchImpl, logger: { error: (details, message) => logged.push({ details, message }) } },
    ).checkConnection();

    expect(status.status).toBe("unreachable");
    expect(flatten(status)).not.toContain(syntheticSentinel);
    expect(flatten(logged)).not.toContain(syntheticSentinel);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns a safe not-configured response without exposing any credential", async () => {
    const status = await getFalConnectionStatus({ NODE_ENV: "test" });
    expect(status).toEqual(expect.objectContaining({ configured: false, status: "not_configured" }));
    expect(flatten(status)).not.toContain(syntheticSentinel);
  });

  it("restricts the connection status action to administrators and masks its result", async () => {
    const db = createDatabase(":memory:");
    const safeStatus = {
      configured: true as const,
      status: "reachable" as const,
      message: "FAL configuration is present and the account-safe model check succeeded.",
      checkedAt: "2026-08-27T00:00:00.000Z",
    };
    const appRouter = createAppRouter(db, {
      falAdminEnv: { FAL_ADMIN_USER_IDS: admin.id },
      falStatus: async () => safeStatus,
    });
    const adminCaller = appRouter.createCaller({ db, user: admin });
    const creatorCaller = appRouter.createCaller({ db, user: creator });

    await expect(creatorCaller.auth.fal()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(adminCaller.auth.fal()).resolves.toEqual(safeStatus);
    expect(flatten(await adminCaller.auth.fal())).not.toContain(syntheticSentinel);
  });
});
