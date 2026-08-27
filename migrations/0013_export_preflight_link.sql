ALTER TABLE export_packages ADD COLUMN kdp_preflight_run_id TEXT;
CREATE INDEX IF NOT EXISTS export_packages_kdp_preflight_idx ON export_packages(user_id, kdp_preflight_run_id);
