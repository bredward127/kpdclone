PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS interior_export_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  export_package_id TEXT,
  ruleset_version TEXT NOT NULL,
  ordered_page_list_json TEXT NOT NULL,
  layout_manifest_storage_reference TEXT NOT NULL,
  preflight_report_storage_reference TEXT NOT NULL,
  interior_pdf_storage_reference TEXT,
  preview_pdf_storage_reference TEXT,
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  blocking_issue_count INTEGER NOT NULL DEFAULT 0 CHECK (blocking_issue_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  layout_manifest_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('blocked', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, export_package_id) REFERENCES export_packages(user_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS interior_export_project_idx ON interior_export_runs(user_id, project_id, created_at DESC);
