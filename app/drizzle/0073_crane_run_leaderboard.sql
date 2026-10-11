-- 0073: Crane Run daily leaderboard (Danny 2026-10-11) — global top-5 per
-- UTC day. One row per user per day, keeping their best score. Opt-in is
-- per-user on auth_users (default private).
ALTER TABLE `auth_users` ADD COLUMN `leaderboard_opt_in` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `daily_game_scores` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `display_name` text NOT NULL DEFAULT '',
  `score` integer NOT NULL DEFAULT 0,
  `score_date` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_game_scores_user_date_unique` ON `daily_game_scores` (`user_id`, `score_date`);
--> statement-breakpoint
CREATE INDEX `daily_game_scores_date_score_idx` ON `daily_game_scores` (`score_date`, `score`);
