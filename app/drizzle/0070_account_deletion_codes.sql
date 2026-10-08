-- 0070: account deletion confirmation codes (email-based 2-step delete).
CREATE TABLE `account_deletion_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL REFERENCES `auth_users`(`id`),
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
CREATE INDEX `account_deletion_codes_user_idx` ON `account_deletion_codes` (`user_id`);
