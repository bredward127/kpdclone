-- Recurring characters were only ever prose inside character_bible, with no
-- way to enumerate them separately from the text. An author who wanted to
-- know "how many characters does this story have, and which ones still need
-- reference art" had no way to ask that question -- they had to read the
-- whole paragraph and mentally parse it themselves.
ALTER TABLE book_briefs ADD COLUMN characters_json TEXT NOT NULL DEFAULT '[]';
