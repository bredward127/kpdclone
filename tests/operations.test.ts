import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase, upsertUser, createProject } from "../server/db";
import { createLocalPrivateStorage } from "../server/storage";
import { cleanupExpiredObjects, getOperationsDashboard } from "../server/operations";

describe("operational controls", () => {
  it("returns aggregate telemetry without creative fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kdp-ops-"));
    const db = createDatabase(path.join(dir, "test.db"));
    upsertUser(db, { id: "ops-user", email: "ops@example.com", name: "Ops" });
    createProject(db, "ops-user", { id: "project-1", name: "Private Book", brief: "do not expose" });
    const result = getOperationsDashboard(db);
    expect(JSON.stringify(result)).not.toContain("Private Book");
    expect(JSON.stringify(result)).not.toContain("do not expose");
    expect(result.generationJobsByStatus).toEqual([]);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("cleans expired package objects and cancelled draft objects deterministically", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kdp-clean-"));
    const storageDir = path.join(dir, "storage");
    process.env.PRIVATE_STORAGE_DIR = storageDir;
    const db = createDatabase(path.join(dir, "test.db"));
    const storage = createLocalPrivateStorage();
    const result = await cleanupExpiredObjects(db, storage, new Date("2030-01-01T00:00:00.000Z"));
    expect(result.expiredExports).toBe(0);
    expect(result.abandonedJobs).toBe(0);
    db.close();
    delete process.env.PRIVATE_STORAGE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
