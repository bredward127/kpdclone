PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS publishing_metadata_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'final', 'superseded', 'archived')),
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  series_name TEXT NOT NULL DEFAULT '',
  series_number TEXT NOT NULL DEFAULT '',
  edition TEXT NOT NULL DEFAULT '',
  contributors_json TEXT NOT NULL DEFAULT '[]',
  language TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  keyword_phrases_json TEXT NOT NULL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  audience_json TEXT NOT NULL DEFAULT '{}',
  reading_direction TEXT NOT NULL CHECK (reading_direction IN ('ltr', 'rtl')),
  print_settings_json TEXT NOT NULL DEFAULT '{}',
  rights_owner TEXT NOT NULL,
  imprint TEXT NOT NULL DEFAULT '',
  isbn13 TEXT,
  isbn10 TEXT,
  isbn_source TEXT CHECK (isbn_source IS NULL OR isbn_source IN ('kdp_free', 'owned')),
  ai_disclosure_required INTEGER NOT NULL DEFAULT 0 CHECK (ai_disclosure_required IN (0, 1)),
  ai_disclosure_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (ai_disclosure_confirmed IN (0, 1)),
  rights_attestation_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (rights_attestation_confirmed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, id),
  UNIQUE(user_id, project_id, version),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS publishing_metadata_project_idx ON publishing_metadata_versions(user_id, project_id, version DESC);

CREATE TABLE IF NOT EXISTS provenance_ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  metadata_version_id TEXT,
  element_type TEXT NOT NULL CHECK (element_type IN ('text', 'image', 'translation', 'layout')),
  element_key TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('ai_generated', 'ai_assisted', 'user_authored', 'licensed_upload')),
  source_asset_id TEXT,
  model_endpoint TEXT,
  prompt_version_id TEXT,
  output_timestamp TEXT,
  owner_approval INTEGER NOT NULL DEFAULT 0 CHECK (owner_approval IN (0, 1)),
  rights_attestation INTEGER NOT NULL DEFAULT 0 CHECK (rights_attestation IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, metadata_version_id) REFERENCES publishing_metadata_versions(user_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS provenance_project_idx ON provenance_ledger_entries(user_id, project_id, element_type);

CREATE TABLE IF NOT EXISTS content_policy_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('prompt', 'metadata', 'export')),
  subject_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('needs_human_review', 'cleared', 'blocked')),
  reviewer_note TEXT NOT NULL DEFAULT '',
  rights_attestation INTEGER NOT NULL DEFAULT 0 CHECK (rights_attestation IN (0, 1)),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, subject_type, subject_id, content_hash),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS content_policy_subject_idx ON content_policy_reviews(user_id, subject_type, subject_id, updated_at DESC);
