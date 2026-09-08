-- A saved AI generation kept the prose bibles but not the named character list
-- it produced, so recalling a generation restored the fields and left the
-- character checklist empty -- the author lost the very list they were told to
-- attach reference art to.
ALTER TABLE brief_generations ADD COLUMN characters_json TEXT NOT NULL DEFAULT '[]';
