PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS kdp_rulesets (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  effective_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'in_review', 'active', 'superseded', 'archived')),
  config_json TEXT NOT NULL,
  source_urls_json TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  review_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS kdp_rulesets_status_date_idx ON kdp_rulesets(status, effective_date DESC);

CREATE TABLE IF NOT EXISTS kdp_preflight_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  ruleset_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('blocked', 'ready_for_manual_review')),
  report_json_storage_reference TEXT NOT NULL,
  report_html_storage_reference TEXT NOT NULL,
  report_pdf_storage_reference TEXT NOT NULL,
  blocking_issue_count INTEGER NOT NULL,
  warning_count INTEGER NOT NULL,
  informational_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (ruleset_id) REFERENCES kdp_rulesets(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS kdp_preflight_project_idx ON kdp_preflight_runs(user_id, project_id, created_at DESC);
