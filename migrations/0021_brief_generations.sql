CREATE TABLE IF NOT EXISTS brief_generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idea TEXT NOT NULL,
  brief_text TEXT NOT NULL,
  audience TEXT NOT NULL,
  visual_style_anchors TEXT NOT NULL,
  character_bible TEXT NOT NULL,
  prop_and_setting_bible TEXT NOT NULL,
  negative_prompt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS brief_generations_project ON brief_generations(user_id, project_id, created_at DESC);
