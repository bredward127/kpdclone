-- Image quality tier, sent to the provider with every generation request.
--
-- The app never sent a quality field, so gpt-image-1.5 applied its own default,
-- which is the most expensive tier: about $0.133 per 1024x1024 image against
-- $0.009 at low. Line art carries no gradients or lighting, so low is the right
-- default for this product and the same drawing costs a fifteenth as much.
ALTER TABLE book_projects ADD COLUMN image_quality TEXT NOT NULL DEFAULT 'low'
  CHECK (image_quality IN ('low', 'medium', 'high'));
