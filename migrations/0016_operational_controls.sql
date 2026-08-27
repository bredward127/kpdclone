CREATE TABLE IF NOT EXISTS operational_recovery_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('reconcile_job', 'retry_storage_copy', 'regenerate_export', 'retention_cleanup')),
  target_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'succeeded', 'failed', 'skipped')),
  safe_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operational_recovery_events_created_idx ON operational_recovery_events(created_at DESC);

CREATE TABLE IF NOT EXISTS storage_copy_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  destination_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'retryable', 'abandoned')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS storage_copy_operations_retry_idx ON storage_copy_operations(status, updated_at);
