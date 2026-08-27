import { describe, expect, it } from "vitest";
import { createDatabase, createProject, upsertUser } from "../server/db";
import { createPagePlan, getGenerationJobForUser, getPagePlanForUser, insertGenerationJob, transitionGenerationJob, updatePageApproval } from "../server/db-studio";

const owner = { id: "schema-owner", name: "Schema Owner", email: "owner@example.com" };
const stranger = { id: "schema-stranger", name: "Schema Stranger", email: "stranger@example.com" };

function makeSchema() {
  const db = createDatabase(":memory:");
  upsertUser(db, owner);
  upsertUser(db, stranger);
  const project = createProject(db, owner.id, { id: "project-schema", name: "Schema Book", brief: "A durable draft." });
  return { db, project };
}

describe("normalized studio schema", () => {
  it("creates every required entity table with UTC timestamp columns", () => {
    const { db } = makeSchema();
    const requiredTables = [
      "book_projects",
      "book_briefs",
      "book_blueprints",
      "page_plans",
      "prompt_versions",
      "generation_jobs",
      "generated_assets",
      "asset_variants",
      "cover_plans",
      "layout_templates",
      "export_packages",
      "validation_runs",
      "audit_events",
    ];
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(requiredTables));

    const project = db.prepare("SELECT created_at AS createdAt, updated_at AS updatedAt FROM book_projects LIMIT 1").get() as { createdAt: string; updatedAt: string };
    expect(project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(project.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("enforces owner-scoped reads and explicit generation lifecycle transitions", () => {
    const { db, project } = makeSchema();
    const page = createPagePlan(db, owner.id, { id: "page-schema", projectId: project.id, pageNumber: 1, sceneDirection: "A moonlit garden", pageText: "Goodnight." });
    const job = insertGenerationJob(db, owner.id, {
      id: "job-schema",
      projectId: project.id,
      pagePlanId: page.id,
      generationModel: "reviewed-model",
      generationEndpoint: "reviewed/endpoint",
    });

    expect(getGenerationJobForUser(db, stranger.id, job.id)).toBeNull();
    expect(getPagePlanForUser(db, stranger.id, page.id)).toBeNull();

    expect(transitionGenerationJob(db, owner.id, job.id, "queued")?.status).toBe("queued");
    expect(transitionGenerationJob(db, owner.id, job.id, "in_progress")?.status).toBe("in_progress");
    expect(transitionGenerationJob(db, owner.id, job.id, "completed")?.status).toBe("completed");
    expect(transitionGenerationJob(db, owner.id, job.id, "needs_review")?.status).toBe("needs_review");
    expect(transitionGenerationJob(db, owner.id, job.id, "approved")?.status).toBe("approved");
    expect(() => transitionGenerationJob(db, owner.id, job.id, "queued")).toThrow("Invalid generation job transition");

    const auditCount = db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE user_id = ? AND entity_id = ?").get(owner.id, job.id) as { count: number };
    expect(auditCount.count).toBe(5);
  });

  it("requires a rejection reason and maps approved page state to approved lifecycle status", () => {
    const { db, project } = makeSchema();
    const page = createPagePlan(db, owner.id, { id: "page-approval", projectId: project.id, pageNumber: 2, sceneDirection: "A warm window", pageText: "The end." });

    expect(() => updatePageApproval(db, owner.id, page.id, { approvalState: "rejected" })).toThrow("rejection reason is required");
    expect(updatePageApproval(db, owner.id, page.id, { approvalState: "rejected", rejectionReason: "Character silhouette needs revision." })).toBe(true);
    expect(getPagePlanForUser(db, owner.id, page.id)).toMatchObject({ approvalState: "rejected", status: "needs_review", rejectionReason: "Character silhouette needs revision." });
    expect(updatePageApproval(db, owner.id, page.id, { approvalState: "approved" })).toBe(true);
    expect(getPagePlanForUser(db, owner.id, page.id)).toMatchObject({ approvalState: "approved", status: "approved", rejectionReason: null });
  });
});
