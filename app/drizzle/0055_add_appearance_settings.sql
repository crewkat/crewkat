-- Appearance follows the account, not the device: theme mode + UI accent live on
-- the company settings row so the installed app, the web app, and any other
-- device always match. Existing rows backfill to the product defaults
-- (system theme, orange accent) via the column defaults.
ALTER TABLE `settings` ADD `theme_mode` TEXT NOT NULL DEFAULT 'system';
--> statement-breakpoint
ALTER TABLE `settings` ADD `ui_accent` TEXT NOT NULL DEFAULT 'orange';
