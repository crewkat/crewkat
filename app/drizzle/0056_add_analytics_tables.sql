-- Mission Control analytics: subscription lifecycle events + cancellation
-- exit-survey feedback. Powers the platform admin analytics dashboard
-- (signups, subscriptions, churn, why-customers-leave breakdown).
CREATE TABLE `subscription_events` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` INTEGER NOT NULL,
  `event_type` TEXT NOT NULL,
  `plan` TEXT NOT NULL,
  `created_at` INTEGER NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscription_events_user_idx` ON `subscription_events` (`user_id`);
--> statement-breakpoint
CREATE INDEX `subscription_events_created_idx` ON `subscription_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX `subscription_events_type_idx` ON `subscription_events` (`event_type`);
--> statement-breakpoint
CREATE TABLE `cancellation_feedback` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` INTEGER NOT NULL,
  `reason` TEXT NOT NULL,
  `details` TEXT NOT NULL DEFAULT '',
  `plan` TEXT NOT NULL DEFAULT 'monthly',
  `created_at` INTEGER NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cancellation_feedback_user_idx` ON `cancellation_feedback` (`user_id`);
--> statement-breakpoint
CREATE INDEX `cancellation_feedback_created_idx` ON `cancellation_feedback` (`created_at`);
