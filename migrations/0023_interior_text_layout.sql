-- Text is composited over the finished artwork at export rather than drawn
-- into it, so the typesetting choices need somewhere to live: one row per
-- book holding the defaults, plus per-page overrides keyed by page plan id.
CREATE TABLE IF NOT EXISTS interior_text_layouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  font_id TEXT NOT NULL DEFAULT 'times_roman',
  font_size REAL NOT NULL DEFAULT 18 CHECK (font_size > 0),
  line_height REAL NOT NULL DEFAULT 1.35 CHECK (line_height > 0),
  align TEXT NOT NULL DEFAULT 'center' CHECK (align IN ('left', 'center', 'right')),
  placement TEXT NOT NULL DEFAULT 'below_image' CHECK (placement IN ('below_image', 'above_image', 'overlay_bottom', 'overlay_top')),
  color_hex TEXT NOT NULL DEFAULT '#14202b',
  margin_inches REAL NOT NULL DEFAULT 0.5 CHECK (margin_inches >= 0),
  text_band_inches REAL NOT NULL DEFAULT 1.6 CHECK (text_band_inches > 0),
  show_page_numbers INTEGER NOT NULL DEFAULT 0 CHECK (show_page_numbers IN (0, 1)),
  -- { "<pagePlanId>": { fontId?, fontSize?, align?, placement?, colorHex? } }
  page_overrides_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, project_id),
  FOREIGN KEY (user_id, project_id) REFERENCES book_projects(user_id, id) ON DELETE CASCADE
);
