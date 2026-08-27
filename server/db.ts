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

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id);
`;

export function createDatabase(filename = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "kdp.db")): AppDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  return db;
}

export function upsertUser(db: AppDatabase, user: UserRecord): UserRecord {
  db.prepare(
    `INSERT INTO users (id, email, name) VALUES (@id, @email, @name)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
  ).run(user);
  return user;
}

export function listProjects(db: AppDatabase, userId: string): ProjectRecord[] {
  return db
    .prepare(
      `SELECT id, user_id AS userId, name, brief,
              created_at AS createdAt, updated_at AS updatedAt
       FROM projects
       WHERE user_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .all(userId) as ProjectRecord[];
}

export function createProject(db: AppDatabase, userId: string, input: { id: string; name: string; brief: string }): ProjectRecord {
  db.prepare(
    `INSERT INTO projects (id, user_id, name, brief)
     VALUES (@id, @userId, @name, @brief)`,
  ).run({ ...input, userId });

  return getProjectForUser(db, userId, input.id)!;
}

export function getProjectForUser(db: AppDatabase, userId: string, projectId: string): ProjectRecord | null {
  return (
    db
      .prepare(
        `SELECT id, user_id AS userId, name, brief,
                created_at AS createdAt, updated_at AS updatedAt
         FROM projects
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
    `UPDATE projects
     SET name = @name, brief = @brief, updated_at = CURRENT_TIMESTAMP
     WHERE id = @projectId AND user_id = @userId`,
  ).run({ name, brief, projectId, userId });

  return getProjectForUser(db, userId, projectId);
}

export function deleteProjectForUser(db: AppDatabase, userId: string, projectId: string): boolean {
  const result = db.prepare(`DELETE FROM projects WHERE id = ? AND user_id = ?`).run(projectId, userId);
  return result.changes === 1;
}
