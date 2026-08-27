-- Immutable prompt snapshots and relational links to uploaded visual references.
ALTER TABLE prompt_versions ADD COLUMN source_field_snapshot TEXT NOT NULL DEFAULT '{}';
ALTER TABLE prompt_versions ADD COLUMN user_edits TEXT NOT NULL DEFAULT '{}';
ALTER TABLE prompt_versions ADD COLUMN aspect_ratio TEXT NOT NULL DEFAULT '1:1';
ALTER TABLE prompt_versions ADD COLUMN content_hash_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE prompt_versions ADD COLUMN lint_warnings_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE prompt_versions ADD COLUMN restored_from_prompt_version_id TEXT;

ALTER TABLE prompt_reference_assets RENAME TO prompt_generated_asset_links;
CREATE INDEX IF NOT EXISTS prompt_generated_asset_links_prompt_idx ON prompt_generated_asset_links(user_id, prompt_version_id);

CREATE TABLE IF NOT EXISTS prompt_reference_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  prompt_version_id TEXT NOT NULL,
  reference_asset_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  UNIQUE(user_id, prompt_version_id, reference_asset_id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, prompt_version_id) REFERENCES prompt_versions(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, reference_asset_id) REFERENCES reference_assets(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS prompt_reference_assets_prompt_idx ON prompt_reference_assets(user_id, prompt_version_id);
