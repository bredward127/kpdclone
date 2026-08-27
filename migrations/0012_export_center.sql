PRAGMA foreign_keys = ON;

ALTER TABLE export_packages ADD COLUMN frozen_project_version TEXT;
ALTER TABLE export_packages ADD COLUMN artifact_hashes_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE export_packages ADD COLUMN listing_metadata_storage_reference TEXT;
ALTER TABLE export_packages ADD COLUMN readme_storage_reference TEXT;
ALTER TABLE export_packages ADD COLUMN cover_preview_storage_reference TEXT;
ALTER TABLE export_packages ADD COLUMN final_confirmation_at TEXT;
ALTER TABLE export_packages ADD COLUMN expires_at TEXT;
ALTER TABLE export_packages ADD COLUMN retention_status TEXT NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active', 'expired', 'retained', 'deleted'));
CREATE INDEX IF NOT EXISTS export_packages_owner_retention_idx ON export_packages(user_id, project_id, retention_status, created_at DESC);
