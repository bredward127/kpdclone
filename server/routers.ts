import { initTRPC, TRPCError } from "@trpc/server";
import crypto from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import { clearSession } from "./auth";
import { createProject, deleteProjectForUser, getProjectForUser, listProjects, updateProjectForUser, upsertUser, type AppDatabase, type UserRecord } from "./db";

export type AppContext = {
  db: AppDatabase;
  user: UserRecord | null;
  res?: Response;
};

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
  }

  upsertUser(ctx.db, ctx.user);
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

const projectIdInput = z.object({ projectId: z.string().min(1) });
const projectInput = z.object({
  name: z.string().trim().min(1).max(120),
  brief: z.string().trim().max(5000).default(""),
});

export function createAppRouter(db: AppDatabase) {
  return router({
    auth: router({
      me: publicProcedure.query(({ ctx }) => ctx.user),
      logout: publicProcedure.mutation(({ ctx }) => {
        if (ctx.res) clearSession(ctx.res);
        return { ok: true };
      }),
    }),
    project: router({
      list: protectedProcedure.query(({ ctx }) => listProjects(db, ctx.user.id)),
      get: protectedProcedure.input(projectIdInput).query(({ ctx, input }) => {
        const project = getProjectForUser(db, ctx.user.id, input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
        }
        return project;
      }),
      create: protectedProcedure.input(projectInput).mutation(({ ctx, input }) => {
        const id = crypto.randomUUID();
        return createProject(db, ctx.user.id, { id, ...input });
      }),
      update: protectedProcedure
        .input(projectIdInput.extend(projectInput.partial().shape))
        .mutation(({ ctx, input }) => {
          const project = updateProjectForUser(db, ctx.user.id, input.projectId, {
            name: input.name,
            brief: input.brief,
          });
          if (!project) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
          }
          return project;
        }),
      remove: protectedProcedure.input(projectIdInput).mutation(({ ctx, input }) => {
        const removed = deleteProjectForUser(db, ctx.user.id, input.projectId);
        if (!removed) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
        }
        return { ok: true };
      }),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
