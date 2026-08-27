-- KDP Kids Book Studio normalized production schema.
-- SQLite CURRENT_TIMESTAMP is UTC; all application timestamps use RFC3339 UTC text.
PRAGMA foreign_keys = ON;

ALTER TABLE projects RENAME TO book_projects;

ALTER TABLE book_projects ADD COLUMN book_type TEXT NOT NULL DEFAULT 'picture_book' CHECK (book_type IN ('picture_book', 'early_reader', 'chapter_book', 'activity_book', 'other'));
ALTER TABLE book_projects ADD COLUMN reading_direction TEXT NOT NULL DEFAULT 'ltr' CHECK (reading_direction IN ('ltr', 'rtl'));
ALTER TABLE book_projects ADD COLUMN trim_width_inches REAL NOT NULL DEFAULT 8.5 CHECK (trim_width_inches > 0);
ALTER TABLE book_projects ADD COLUMN trim_height_inches REAL NOT NULL DEFAULT 8.5 CHECK (trim_height_inches > 0);
ALTER TABLE book_projects ADD COLUMN bleed_preference TEXT NOT NULL DEFAULT 'no_bleed' CHECK (bleed_preference IN ('no_bleed', 'bleed', 'custom'));
ALTER TABLE book_projects ADD COLUMN paper_selection TEXT NOT NULL DEFAULT 'white';
ALTER TABLE book_projects ADD COLUMN ink_selection TEXT NOT NULL DEFAULT 'black_ink';
ALTER TABLE book_projects ADD COLUMN page_count INTEGER NOT NULL DEFAULT 24 CHECK (page_count > 0);
ALTER TABLE book_projects ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE book_projects ADD COLUMN author TEXT NOT NULL DEFAULT '';
ALTER TABLE book_projects ADD COLUMN imprint TEXT NOT NULL DEFAULT '';
ALTER TABLE book_projects ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived'));

-- Normalize timestamps from the original bootstrap schema to RFC3339 UTC text.
UPDATE users SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at) WHERE created_at NOT LIKE '%T%Z';
UPDATE book_projects SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at) WHERE created_at NOT LIKE '%T%Z';
UPDATE book_projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) WHERE updated_at NOT LIKE '%T%Z';

CREATE UNIQUE INDEX IF NOT EXISTS book_projects_user_id_id_uq ON book_projects(user_id, id);
CREATE INDEX IF NOT EXISTS book_projects_user_id_updated_idx ON book_projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS book_briefs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  brief_text TEXT NOT NULL DEFAULT '',
  book_type TEXT NOT NULL DEFAULT 'picture_book',
  audience TEXT NOT NULL DEFAULT '',
  visual_style_anchors TEXT NOT NULL DEFAULT '',
  character_bible TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS book_briefs_project_idx ON book_briefs(user_id, project_id, version DESC);

CREATE TABLE IF NOT EXISTS book_blueprints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  narrative_arc TEXT NOT NULL DEFAULT '',
  pacing_notes TEXT NOT NULL DEFAULT '',
  page_rhythm TEXT NOT NULL DEFAULT '',
  visual_style_anchors TEXT NOT NULL DEFAULT '',
  character_bible TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS book_blueprints_project_idx ON book_blueprints(user_id, project_id, version DESC);

CREATE TABLE IF NOT EXISTS page_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  spread_number INTEGER CHECK (spread_number IS NULL OR spread_number > 0),
  scene_direction TEXT NOT NULL DEFAULT '',
  page_text TEXT NOT NULL DEFAULT '',
  approval_state TEXT NOT NULL DEFAULT 'draft' CHECK (approval_state IN ('draft', 'needs_review', 'approved', 'rejected', 'superseded', 'archived')),
  rejection_reason TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  UNIQUE(user_id, project_id, page_number),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS page_plans_project_idx ON page_plans(user_id, project_id, page_number);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  page_plan_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  prompt TEXT NOT NULL,
  negative_prompt TEXT NOT NULL DEFAULT '',
  seed INTEGER,
  generation_model TEXT NOT NULL,
  generation_endpoint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, page_plan_id) REFERENCES page_plans(user_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS prompt_versions_page_idx ON prompt_versions(user_id, page_plan_id, version DESC);

CREATE TABLE IF NOT EXISTS prompt_reference_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  prompt_version_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  UNIQUE(user_id, prompt_version_id, asset_id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, prompt_version_id) REFERENCES prompt_versions(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, asset_id) REFERENCES generated_assets(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  page_plan_id TEXT,
  prompt_version_id TEXT,
  provider_job_id TEXT,
  generation_model TEXT NOT NULL,
  generation_endpoint TEXT NOT NULL,
  seed INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  error_code TEXT,
  error_message TEXT,
  queued_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, page_plan_id) REFERENCES page_plans(user_id, id) ON DELETE SET NULL,
  FOREIGN KEY (user_id, prompt_version_id) REFERENCES prompt_versions(user_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS generation_jobs_project_status_idx ON generation_jobs(user_id, project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS generated_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  page_plan_id TEXT,
  generation_job_id TEXT,
  prompt_version_id TEXT,
  storage_reference TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width_px INTEGER,
  height_px INTEGER,
  byte_size INTEGER,
  checksum_sha256 TEXT,
  ai_provenance_classification TEXT NOT NULL CHECK (ai_provenance_classification IN ('ai_generated', 'human_created', 'human_edited_ai', 'provider_asset', 'composite', 'unknown')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, page_plan_id) REFERENCES page_plans(user_id, id) ON DELETE SET NULL,
  FOREIGN KEY (user_id, generation_job_id) REFERENCES generation_jobs(user_id, id) ON DELETE SET NULL,
  FOREIGN KEY (user_id, prompt_version_id) REFERENCES prompt_versions(user_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS generated_assets_page_status_idx ON generated_assets(user_id, page_plan_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS asset_variants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  generated_asset_id TEXT NOT NULL,
  variant_kind TEXT NOT NULL CHECK (variant_kind IN ('original', 'thumbnail', 'print', 'web', 'alternate', 'approved')),
  storage_reference TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width_px INTEGER,
  height_px INTEGER,
  byte_size INTEGER,
  checksum_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, generated_asset_id) REFERENCES generated_assets(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS asset_variants_asset_idx ON asset_variants(user_id, generated_asset_id, variant_kind);

CREATE TABLE IF NOT EXISTS project_visual_references (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  reference_role TEXT NOT NULL DEFAULT 'style',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  UNIQUE(user_id, project_id, asset_id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, asset_id) REFERENCES generated_assets(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS page_reference_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  page_plan_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  UNIQUE(user_id, page_plan_id, asset_id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, page_plan_id) REFERENCES page_plans(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, asset_id) REFERENCES generated_assets(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cover_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  imprint TEXT NOT NULL DEFAULT '',
  trim_width_inches REAL NOT NULL CHECK (trim_width_inches > 0),
  trim_height_inches REAL NOT NULL CHECK (trim_height_inches > 0),
  bleed_inches REAL NOT NULL DEFAULT 0.125 CHECK (bleed_inches >= 0),
  spine_width_inches REAL NOT NULL DEFAULT 0 CHECK (spine_width_inches >= 0),
  front_copy TEXT NOT NULL DEFAULT '',
  back_copy TEXT NOT NULL DEFAULT '',
  front_asset_id TEXT,
  back_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, front_asset_id) REFERENCES generated_assets(user_id, id) ON DELETE SET NULL,
  FOREIGN KEY (user_id, back_asset_id) REFERENCES generated_assets(user_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS layout_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  name TEXT NOT NULL,
  template_key TEXT NOT NULL,
  template_schema TEXT NOT NULL DEFAULT '{}',
  trim_width_inches REAL,
  trim_height_inches REAL,
  bleed_inches REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  result_summary TEXT NOT NULL DEFAULT '',
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS export_packages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  validation_run_id TEXT,
  package_kind TEXT NOT NULL DEFAULT 'paperback' CHECK (package_kind IN ('paperback', 'interior', 'cover', 'zip')),
  interior_storage_reference TEXT,
  cover_storage_reference TEXT,
  manifest_storage_reference TEXT,
  zip_storage_reference TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'needs_review', 'approved', 'superseded', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, validation_run_id) REFERENCES validation_runs(user_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS audit_events_project_created_idx ON audit_events(user_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
