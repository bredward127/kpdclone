CREATE TABLE IF NOT EXISTS fal_webhook_events (
  request_id TEXT PRIMARY KEY,
  payload_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS fal_webhook_events_received_idx ON fal_webhook_events(received_at);

CREATE TABLE IF NOT EXISTS security_deletion_audit (
  id TEXT PRIMARY KEY,
  user_hash TEXT NOT NULL,
  project_hash TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  deleted_storage_count INTEGER NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'project_deleted',
  retained_audit_only INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS security_deletion_audit_deleted_idx ON security_deletion_audit(deleted_at);
