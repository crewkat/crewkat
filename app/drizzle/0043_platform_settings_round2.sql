-- Platform admin round 2: additional platform settings with safe defaults.
-- INSERT OR IGNORE so re-running never clobbers values Danny already changed.
INSERT OR IGNORE INTO `platform_settings` (`key`, `value`, `updated_at`) VALUES
  ('registration_enabled', '1', (strftime('%s','now') * 1000)),
  ('marketplace_enabled', '1', (strftime('%s','now') * 1000)),
  ('free_listing_limit', '3', (strftime('%s','now') * 1000)),
  ('announcement_banner', '', (strftime('%s','now') * 1000));
