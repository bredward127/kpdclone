-- Bulk generation used to be a loop of submits from the browser, which hit the
-- per-minute submit limiter partway through (12 of 33) and abandoned the rest,
-- leaving the author to notice and retry by hand. Work is enqueued here instead
-- and drained by a server-side worker at a pace the provider and the limiter
-- both tolerate, so a whole book can be requested once and left alone.
CREATE TABLE IF NOT EXISTS generation_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  page_plan_id TEXT NOT NULL,
  prompt_version_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitting', 'submitted', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  generation_job_id TEXT,
  -- Priced at enqueue time so a batch's spend can be reported and capped.
  estimated_cost_usd REAL NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  batch_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- One live queue entry per page: re-enqueueing a page already waiting must
  -- not double-spend. Settled rows are cleared before a page is queued again.
  UNIQUE(user_id, page_plan_id, status),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS generation_queue_pending_idx ON generation_queue(status, created_at);
CREATE INDEX IF NOT EXISTS generation_queue_project_idx ON generation_queue(user_id, project_id, status);
