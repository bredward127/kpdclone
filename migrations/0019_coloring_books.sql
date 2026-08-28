-- Coloring-book interiors and cross-page prop continuity.
--
-- interior_art_style is added as a column rather than a new book_type value:
-- book_projects.book_type carries a CHECK constraint, and widening it in SQLite
-- requires rebuilding the table. Twenty-eight tables reference book_projects
-- with ON DELETE CASCADE, so a rebuild would delete every dependent row. The
-- style is also genuinely orthogonal to book type -- an activity book or a
-- picture book can both have coloring-page interiors.
ALTER TABLE book_projects ADD COLUMN interior_art_style TEXT NOT NULL DEFAULT 'full_color'
  CHECK (interior_art_style IN ('full_color', 'coloring_line_art'));

-- Recurring objects and locations, repeated verbatim into every page prompt.
-- Without it each page re-invented props the story treats as fixed: a nightstand
-- and the clock on it changed shape and colour from one page to the next.
ALTER TABLE book_briefs ADD COLUMN prop_and_setting_bible TEXT NOT NULL DEFAULT '';
