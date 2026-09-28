-- Chunk D: web push notification subscriptions (VAPID).
CREATE TABLE `push_subscriptions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `endpoint` text NOT NULL UNIQUE,
  `p256dh` text NOT NULL,
  `auth` text NOT NULL,
  `created_at` integer NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);
