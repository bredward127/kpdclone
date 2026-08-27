-- User-uploaded visual-reference metadata only; image bytes remain in private application storage.
CREATE TABLE IF NOT EXISTS reference_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  page_plan_id TEXT,
  reference_kind TEXT NOT NULL CHECK (reference_kind IN ('character_sheet', 'sketch_reference', 'moodboard', 'cover_reference')),
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  width_px INTEGER NOT NULL CHECK (width_px > 0),
  height_px INTEGER NOT NULL CHECK (height_px > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  storage_key TEXT NOT NULL UNIQUE,
  content_hash_sha256 TEXT NOT NULL,
  provenance_declaration TEXT NOT NULL CHECK (provenance_declaration IN ('user_owned', 'licensed', 'permission_granted')),
  rights_attestation INTEGER NOT NULL CHECK (rights_attestation IN (0, 1)),
  rights_attested_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted', 'replaced', 'archived')),
  replaced_by_id TEXT,
  replaces_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, page_plan_id) REFERENCES page_plans(user_id, id) ON DELETE SET NULL,
  FOREIGN KEY (replaced_by_id) REFERENCES reference_assets(id) ON DELETE SET NULL,
  FOREIGN KEY (replaces_id) REFERENCES reference_assets(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS reference_assets_project_status_idx ON reference_assets(user_id, project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS reference_assets_hash_idx ON reference_assets(user_id, project_id, content_hash_sha256);
