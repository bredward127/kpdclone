PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cover_export_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  cover_plan_version_id TEXT NOT NULL,
  template_import_id TEXT NOT NULL,
  final_pdf_storage_reference TEXT,
  preview_pdf_storage_reference TEXT NOT NULL,
  manifest_storage_reference TEXT NOT NULL,
  preflight_storage_reference TEXT NOT NULL,
  blocking_issue_count INTEGER NOT NULL DEFAULT 0 CHECK (blocking_issue_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('blocked', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, cover_plan_version_id) REFERENCES cover_plan_versions(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, template_import_id) REFERENCES cover_template_imports(user_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS cover_export_project_idx ON cover_export_runs(user_id, project_id, created_at DESC);
