-- 0077: Crane Run weekly leaderboard + champion spotlight (Danny
-- 2026-10-14) — the daily board becomes a calendar-week board
-- (Mon 00:00–Sun 23:59 America/New_York; score rows are keyed by ET
-- date from this migration on). When a week finishes, its #1 opted-in
-- player is snapshotted here once; that champion gets the following
-- week as a free "Featured Pro" brand spotlight (Crane Run screen +
-- Marketplace card). business_name is the resolved name at snapshot
-- time (company name when the account has one, else the user's name).
CREATE TABLE `weekly_game_champions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `week_start` text NOT NULL,
  `user_id` integer REFERENCES `auth_users`(`id`) ON DELETE SET NULL,
  `business_name` text NOT NULL DEFAULT '',
  `score` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_game_champions_week_unique` ON `weekly_game_champions` (`week_start`);
