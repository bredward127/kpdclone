-- 0021 referenced projects(id), a table renamed to book_projects in 0002, so
-- every insert failed with "no such table: main.projects". Databases that
-- already recorded 0021 keep the broken table, and no row ever landed in it,
-- so it is safe to drop and recreate with the composite key the other studio
-- tables use.
DROP TABLE IF EXISTS brief_generations;

CREATE TABLE brief_generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  idea TEXT NOT NULL,
  brief_text TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  visual_style_anchors TEXT NOT NULL DEFAULT '',
  character_bible TEXT NOT NULL DEFAULT '',
  prop_and_setting_bible TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS brief_generations_project_idx ON brief_generations(user_id, project_id, created_at DESC);
