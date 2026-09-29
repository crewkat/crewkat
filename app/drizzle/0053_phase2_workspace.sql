-- Phase 2 (competitor core differentiators): per-job client messaging thread,
-- Marketplace Bid Board pipeline, and daily-log client sharing columns.
CREATE TABLE `job_messages` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` INTEGER NOT NULL DEFAULT 1,
  `job_id` INTEGER NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `sender` TEXT NOT NULL DEFAULT 'contractor',
  `body` TEXT NOT NULL DEFAULT '',
  `image_blob_key` TEXT,
  `image_filename` TEXT NOT NULL DEFAULT '',
  `image_content_type` TEXT NOT NULL DEFAULT '',
  `voice_blob_key` TEXT,
  `voice_filename` TEXT NOT NULL DEFAULT '',
  `voice_content_type` TEXT NOT NULL DEFAULT '',
  `voice_duration_seconds` INTEGER NOT NULL DEFAULT 0,
  `read_at` INTEGER,
  `created_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_messages_job_idx` ON `job_messages` (`job_id`);
--> statement-breakpoint
CREATE TABLE `bid_board_items` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` INTEGER NOT NULL DEFAULT 1,
  `user_id` INTEGER NOT NULL,
  `listing_id` INTEGER REFERENCES `marketplace_listings`(`id`) ON DELETE SET NULL,
  `request_id` INTEGER REFERENCES `marketplace_requests`(`id`) ON DELETE SET NULL,
  `title` TEXT NOT NULL,
  `stage` TEXT NOT NULL DEFAULT 'interested',
  `due_date` TEXT NOT NULL DEFAULT '',
  `remind_at` INTEGER,
  `notes` TEXT NOT NULL DEFAULT '',
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bid_board_items_user_idx` ON `bid_board_items` (`user_id`);
--> statement-breakpoint
ALTER TABLE `daily_logs` ADD COLUMN `blockers` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `daily_logs` ADD COLUMN `client_summary` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `daily_logs` ADD COLUMN `shared_with_client` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `weekly_progress_enabled` integer NOT NULL DEFAULT 1;
