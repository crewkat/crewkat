-- Client-portal share-link hardening: expiry, access logging, rate limiting.
-- Existing non-revoked links are grandfathered with a 180-day expiry from
-- creation so nothing breaks on deploy; revoked rows are left untouched.
ALTER TABLE `portal_tokens` ADD COLUMN `expires_at` integer;
--> statement-breakpoint
ALTER TABLE `portal_tokens` ADD COLUMN `view_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `portal_tokens` ADD COLUMN `first_viewed_at` integer;
--> statement-breakpoint
ALTER TABLE `portal_tokens` ADD COLUMN `last_viewed_at` integer;
--> statement-breakpoint
UPDATE `portal_tokens` SET `expires_at` = `created_at` + 180 * 86400000 WHERE `revoked_at` IS NULL AND `expires_at` IS NULL;
--> statement-breakpoint
CREATE TABLE `portal_link_events` (
  `company_id` integer NOT NULL DEFAULT 1,
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `link_id` integer NOT NULL REFERENCES `portal_tokens`(`id`) ON DELETE CASCADE,
  `event_type` text NOT NULL,
  `user_agent` text NOT NULL DEFAULT '',
  `occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_portal_link_events_link` ON `portal_link_events` (`link_id`, `occurred_at` DESC);
--> statement-breakpoint
CREATE TABLE `rate_limit_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `scope` text NOT NULL,
  `key` text NOT NULL,
  `occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limit_scope_key` ON `rate_limit_events` (`scope`, `key`, `occurred_at`);
