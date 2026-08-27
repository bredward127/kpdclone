-- Asynchronous provider lifecycle metadata. Provider URLs remain transient and are never durable asset references.
ALTER TABLE generation_jobs ADD COLUMN fal_request_id TEXT;
ALTER TABLE generation_jobs ADD COLUMN model_inputs_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE generation_jobs ADD COLUMN expected_output_constraints_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE generation_jobs ADD COLUMN local_status TEXT NOT NULL DEFAULT 'draft' CHECK (local_status IN ('draft', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'cancellation_requested'));
ALTER TABLE generation_jobs ADD COLUMN provider_status TEXT;
ALTER TABLE generation_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);
ALTER TABLE generation_jobs ADD COLUMN error_classification TEXT;
ALTER TABLE generation_jobs ADD COLUMN cancellation_requested_at TEXT;
ALTER TABLE generation_jobs ADD COLUMN webhook_processed_at TEXT;
ALTER TABLE generation_jobs ADD COLUMN provider_completed_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_fal_request_idx ON generation_jobs(user_id, fal_request_id) WHERE fal_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS generation_jobs_local_status_idx ON generation_jobs(user_id, project_id, local_status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS generated_assets_job_unique_idx ON generated_assets(user_id, generation_job_id) WHERE generation_job_id IS NOT NULL;
