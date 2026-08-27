CREATE TABLE IF NOT EXISTS fal_webhook_conflicts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('replay', 'payload_conflict')),
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fal_webhook_conflicts_received_idx ON fal_webhook_conflicts(received_at);
