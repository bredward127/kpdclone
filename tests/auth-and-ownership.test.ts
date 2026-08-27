import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { createDatabase } from "../server/db";
import { createAppRouter } from "../server/routers";

function makeCaller(user: { id: string; name: string; email: string | null } | null) {
  const db = createDatabase(":memory:");
  const appRouter = createAppRouter(db);
  return { caller: appRouter.createCaller({ db, user }), db };
}

describe("authentication and project ownership", () => {
  it("rejects project listing when there is no authenticated user", async () => {
    const { caller } = makeCaller(null);
    await expect(caller.project.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("allows a creator to create and read their own project", async () => {
    const user = { id: "user-a", name: "Ava", email: "ava@example.com" };
    const { caller } = makeCaller(user);
    const created = await caller.project.create({ name: "Moon Garden", brief: "A quiet story about nighttime courage." });
    const loaded = await caller.project.get({ projectId: created.id });

    expect(loaded).toMatchObject({ id: created.id, userId: user.id, name: "Moon Garden" });
  });

  it("does not allow another creator to read or delete a project", async () => {
    const owner = { id: "owner", name: "Owner", email: "owner@example.com" };
    const stranger = { id: "stranger", name: "Stranger", email: "stranger@example.com" };
    const db = createDatabase(":memory:");
    const appRouter = createAppRouter(db);
    const ownerCaller = appRouter.createCaller({ db, user: owner });
    const strangerCaller = appRouter.createCaller({ db, user: stranger });
    const created = await ownerCaller.project.create({ name: "Private Draft", brief: "Only the owner can see this." });

    await expect(strangerCaller.project.get({ projectId: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(strangerCaller.project.remove({ projectId: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerCaller.project.get({ projectId: created.id })).resolves.toMatchObject({ userId: owner.id });
  });
});
