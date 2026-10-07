ALTER TABLE `auth_users` ADD `google_sub` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_google_sub_unique` ON `auth_users` (`google_sub`);
