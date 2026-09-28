-- Pinnable tools on the Home screen: one row per user per tool, position order.
CREATE TABLE `user_home_pins` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `tool_id` text NOT NULL,
  `position` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_home_pins_user_tool_unique` ON `user_home_pins` (`user_id`, `tool_id`);
--> statement-breakpoint
CREATE INDEX `user_home_pins_user_idx` ON `user_home_pins` (`user_id`, `position`);
