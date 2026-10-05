CREATE TABLE IF NOT EXISTS `rate_limit_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT,
  `scope` text NOT NULL,
  `key` text NOT NULL,
  `occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rate_limit_scope_key` ON `rate_limit_events` (`scope`, `key`, `occurred_at`);