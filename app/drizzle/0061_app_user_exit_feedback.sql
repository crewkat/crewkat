CREATE TABLE `app_user_exit_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer DEFAULT 1 NOT NULL,
	`user_name` text NOT NULL,
	`role` text DEFAULT 'crew' NOT NULL,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `app_user_exit_feedback_company_idx` ON `app_user_exit_feedback` (`company_id`);--> statement-breakpoint
CREATE INDEX `app_user_exit_feedback_created_idx` ON `app_user_exit_feedback` (`created_at`);
