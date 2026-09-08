-- A reference asset previously carried only a category (character sheet,
-- sketch, moodboard, cover reference) and its original filename -- nothing
-- said what the picture actually depicted or how it should be used. The
-- composed prompt could show the model an image, but had no text to say "this
-- is the red 1967 Mustang; use it whenever the car appears," so a specific
-- recurring prop or character could not be identified or targeted.
ALTER TABLE reference_assets ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE reference_assets ADD COLUMN usage_notes TEXT NOT NULL DEFAULT '';
