import Database from "better-sqlite3";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

export type AppDatabase = Database.Database;

export type UserRecord = {
  id: string;
  email: string | null;
  name: string;
};

export type ProjectRecord = {
  id: string;
  userId: string;
  name: string;
  brief: string;
  bookType: "picture_book" | "early_reader" | "chapter_book" | "activity_book" | "other";
  /** Coloring-page interiors are line art, not de-coloured illustration. */
  interiorArtStyle: "full_color" | "coloring_line_art";
  /** Provider quality tier. Line art does not need the expensive tiers. */
  imageQuality: "low" | "medium" | "high";
  readingDirection: "ltr" | "rtl";
  trimWidthInches: number;
  trimHeightInches: number;
  bleedPreference: "no_bleed" | "bleed" | "custom";
  paperSelection: string;
  inkSelection: string;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
};

const migrationTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`;

export function createDatabase(filename = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "kdp.db")): AppDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

export function applyMigrations(db: AppDatabase, migrationsDir = path.join(process.cwd(), "migrations")): void {
  db.exec(migrationTableSql);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: string }>).map((row) => row.version),
  );

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migration directory is missing: ${migrationsDir}`);
  }

  const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (const file of migrationFiles) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const runMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
    });
    runMigration();
  }
}

export function upsertUser(db: AppDatabase, user: UserRecord): UserRecord {
  db.prepare(
    `INSERT INTO users (id, email, name, created_at) VALUES (@id, @email, @name, @createdAt)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
  ).run({ ...user, createdAt: new Date().toISOString() });
  return user;
}

export function listProjects(db: AppDatabase, userId: string): ProjectRecord[] {
  return db
    .prepare(
      `SELECT id, user_id AS userId, name, brief,
              book_type AS bookType, interior_art_style AS interiorArtStyle, image_quality AS imageQuality, reading_direction AS readingDirection, trim_width_inches AS trimWidthInches, trim_height_inches AS trimHeightInches,
              bleed_preference AS bleedPreference, paper_selection AS paperSelection, ink_selection AS inkSelection,
              page_count AS pageCount, created_at AS createdAt, updated_at AS updatedAt
       FROM book_projects
       WHERE user_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(userId) as ProjectRecord[];
}

export function createProject(db: AppDatabase, userId: string, input: { id: string; name: string; brief: string }): ProjectRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO book_projects (id, user_id, name, brief, title, created_at, updated_at)
     VALUES (@id, @userId, @name, @brief, @name, @now, @now)`,
  ).run({ ...input, userId, now });

  return getProjectForUser(db, userId, input.id)!;
}

export function getProjectForUser(db: AppDatabase, userId: string, projectId: string): ProjectRecord | null {
  return (
    db
      .prepare(
        `SELECT id, user_id AS userId, name, brief,
                book_type AS bookType, interior_art_style AS interiorArtStyle, image_quality AS imageQuality, reading_direction AS readingDirection, trim_width_inches AS trimWidthInches, trim_height_inches AS trimHeightInches,
                bleed_preference AS bleedPreference, paper_selection AS paperSelection, ink_selection AS inkSelection,
                page_count AS pageCount, created_at AS createdAt, updated_at AS updatedAt
         FROM book_projects
         WHERE id = ? AND user_id = ?`,
      )
      .get(projectId, userId) as ProjectRecord | undefined
  ) ?? null;
}

export function updateProjectForUser(
  db: AppDatabase,
  userId: string,
  projectId: string,
  input: { name?: string; brief?: string; interiorArtStyle?: ProjectRecord["interiorArtStyle"]; imageQuality?: ProjectRecord["imageQuality"] },
): ProjectRecord | null {
  const existing = getProjectForUser(db, userId, projectId);
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const brief = input.brief ?? existing.brief;
  const interiorArtStyle = input.interiorArtStyle ?? existing.interiorArtStyle;
  const imageQuality = input.imageQuality ?? existing.imageQuality;
  db.prepare(
    `UPDATE book_projects
     SET name = @name, title = @name, brief = @brief, interior_art_style = @interiorArtStyle, image_quality = @imageQuality, updated_at = @updatedAt
     WHERE id = @projectId AND user_id = @userId`,
  ).run({ name, brief, interiorArtStyle, imageQuality, projectId, userId, updatedAt: new Date().toISOString() });

  return getProjectForUser(db, userId, projectId);
}

export function deleteProjectForUser(db: AppDatabase, userId: string, projectId: string): boolean {
  const result = db.prepare(`DELETE FROM book_projects WHERE id = ? AND user_id = ?`).run(projectId, userId);
  return result.changes === 1;
}

export function deleteProjectDataForUser(db: AppDatabase, userId: string, projectId: string): { removed: boolean; storageKeys: string[] } {
  const storageKeys = new Set<string>();
  const references: Array<[string, string]> = [
    ["reference_assets", "storage_key"], ["generated_assets", "storage_reference"], ["cover_template_imports", "guide_storage_reference"],
    ["interior_export_runs", "interior_pdf_storage_reference"], ["interior_export_runs", "preview_pdf_storage_reference"], ["interior_export_runs", "layout_manifest_storage_reference"], ["interior_export_runs", "preflight_report_storage_reference"],
    ["cover_export_runs", "cover_storage_reference"], ["cover_export_runs", "preview_storage_reference"], ["kdp_preflight_runs", "report_json_storage_reference"], ["kdp_preflight_runs", "report_html_storage_reference"], ["kdp_preflight_runs", "report_pdf_storage_reference"],
    ["export_packages", "zip_storage_reference"], ["export_packages", "listing_metadata_storage_reference"], ["export_packages", "readme_storage_reference"], ["export_packages", "cover_preview_storage_reference"], ["export_packages", "manifest_storage_reference"], ["export_packages", "preflight_storage_reference"],
  ];
  for (const [table, column] of references) {
    try { for (const row of db.prepare(`SELECT ${column} AS value FROM ${table} WHERE user_id = ? AND project_id = ? AND ${column} IS NOT NULL`).all(userId, projectId) as Array<{ value: unknown }>) if (typeof row.value === "string" && row.value) storageKeys.add(row.value); } catch { /* table/column may not exist in older deployments */ }
  }
  const deletedAt = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const userHash = crypto.createHash("sha256").update(userId).digest("hex");
  const projectHash = crypto.createHash("sha256").update(projectId).digest("hex");
  const transaction = db.transaction(() => {
    const result = db.prepare(`DELETE FROM book_projects WHERE id = ? AND user_id = ?`).run(projectId, userId);
    if (result.changes !== 1) return false;
    db.prepare(`INSERT INTO security_deletion_audit (id, user_hash, project_hash, deleted_at, deleted_storage_count) VALUES (?, ?, ?, ?, ?)`).run(auditId, userHash, projectHash, deletedAt, storageKeys.size);
    return true;
  });
  return { removed: Boolean(transaction()), storageKeys: [...storageKeys] };
}
