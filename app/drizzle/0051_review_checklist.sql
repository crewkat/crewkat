-- Phase 1 (competitor quick wins): review-request automation settings +
-- per-user first-run activation checklist state.
CREATE TABLE `onboarding_checklist` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` INTEGER NOT NULL DEFAULT 1,
  `user_id` INTEGER NOT NULL,
  `dismissed_at` INTEGER,
  `completed_at` INTEGER,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_checklist_user_unique` ON `onboarding_checklist` (`user_id`);
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `review_requests_enabled` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `review_request_delay_days` integer NOT NULL DEFAULT 3;
