import Database from "better-sqlite3";
import fs from "node:fs";
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
              created_at AS createdAt, updated_at AS updatedAt
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
                created_at AS createdAt, updated_at AS updatedAt
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
  input: { name?: string; brief?: string },
): ProjectRecord | null {
  const existing = getProjectForUser(db, userId, projectId);
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const brief = input.brief ?? existing.brief;
  db.prepare(
    `UPDATE book_projects
     SET name = @name, title = @name, brief = @brief, updated_at = @updatedAt
     WHERE id = @projectId AND user_id = @userId`,
  ).run({ name, brief, projectId, userId, updatedAt: new Date().toISOString() });

  return getProjectForUser(db, userId, projectId);
}

export function deleteProjectForUser(db: AppDatabase, userId: string, projectId: string): boolean {
  const result = db.prepare(`DELETE FROM book_projects WHERE id = ? AND user_id = ?`).run(projectId, userId);
  return result.changes === 1;
}
