CREATE TABLE `auth_users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `password_iterations` integer NOT NULL DEFAULT 210000,
  `email_verified_at` integer,
  `company_id` integer NOT NULL DEFAULT 1,
  `role` text NOT NULL DEFAULT 'owner',
  `data_claimed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_email_unique` ON `auth_users` (`email`);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `token_hash` text NOT NULL,
  `expires_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `revoked_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_hash_unique` ON `auth_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `purpose` text NOT NULL,
  `token_hash` text NOT NULL,
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_token_hash_unique` ON `auth_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `auth_tokens_user_purpose_idx` ON `auth_tokens` (`user_id`, `purpose`);
--> statement-breakpoint
CREATE TABLE `auth_login_attempts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `email` text NOT NULL,
  `attempted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_login_attempts_email_time_idx` ON `auth_login_attempts` (`email`, `attempted_at`);