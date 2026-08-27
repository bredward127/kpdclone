PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS asset_quality_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  generated_asset_id TEXT,
  reference_asset_id TEXT,
  source_checksum_sha256 TEXT NOT NULL,
  analysis_version TEXT NOT NULL,
  placed_width_inches REAL NOT NULL CHECK (placed_width_inches > 0),
  placed_height_inches REAL NOT NULL CHECK (placed_height_inches > 0),
  bleed_inches REAL NOT NULL DEFAULT 0 CHECK (bleed_inches >= 0),
  safe_area_inset_inches REAL NOT NULL DEFAULT 0 CHECK (safe_area_inset_inches >= 0),
  required_width_px INTEGER NOT NULL CHECK (required_width_px > 0),
  required_height_px INTEGER NOT NULL CHECK (required_height_px > 0),
  effective_dpi REAL NOT NULL CHECK (effective_dpi >= 0),
  blocking_issue_count INTEGER NOT NULL DEFAULT 0 CHECK (blocking_issue_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  overall_status TEXT NOT NULL CHECK (overall_status IN ('blocked', 'warnings', 'pass', 'needs_human_review')),
  metrics_json TEXT NOT NULL DEFAULT '{}',
  issues_json TEXT NOT NULL DEFAULT '[]',
  human_approval_required INTEGER NOT NULL DEFAULT 1 CHECK (human_approval_required = 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, generated_asset_id) REFERENCES generated_assets(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, reference_asset_id) REFERENCES reference_assets(user_id, id) ON DELETE CASCADE,
  CHECK ((generated_asset_id IS NOT NULL AND reference_asset_id IS NULL) OR (generated_asset_id IS NULL AND reference_asset_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_quality_generated_uq ON asset_quality_results(user_id, generated_asset_id) WHERE generated_asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS asset_quality_reference_uq ON asset_quality_results(user_id, reference_asset_id) WHERE reference_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS asset_quality_project_idx ON asset_quality_results(user_id, project_id, created_at DESC);
