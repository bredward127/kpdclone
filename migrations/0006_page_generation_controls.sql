-- Bounded page-generation controls and non-destructive asset lineage.
ALTER TABLE generation_jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE generation_jobs ADD COLUMN request_kind TEXT NOT NULL DEFAULT 'initial' CHECK (request_kind IN ('initial', 'variation', 'prompt_edit'));
ALTER TABLE generation_jobs ADD COLUMN source_asset_id TEXT;
ALTER TABLE generation_jobs ADD COLUMN user_cancelled_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_idempotency_idx ON generation_jobs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS generation_jobs_source_asset_idx ON generation_jobs(user_id, source_asset_id);
ALTER TABLE asset_variants ADD COLUMN source_asset_id TEXT;
CREATE INDEX IF NOT EXISTS asset_variants_source_asset_idx ON asset_variants(user_id, source_asset_id);
