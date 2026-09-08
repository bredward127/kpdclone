-- Cover art had no way to exist: the cover step's art selectors only offered
-- uploaded reference files, and "Generate whole book" only ever touched
-- interior pages, so a book could never have generated cover artwork.
--
-- A cover surface is given a page_plans row of its own, so the whole working
-- pipeline -- compose, freeze, queue, generate, ingest, display -- applies to
-- it unchanged. The role keeps it out of the interior: every existing reader
-- of page_plans asks for 'interior' only, so page counts, the interior PDF,
-- the preview and preflight are unaffected.
ALTER TABLE page_plans ADD COLUMN page_role TEXT NOT NULL DEFAULT 'interior'
  CHECK (page_role IN ('interior', 'front_cover', 'back_cover'));

CREATE INDEX IF NOT EXISTS page_plans_role_idx ON page_plans(user_id, project_id, page_role, page_number);
