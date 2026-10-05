CREATE TABLE `marketplace_unlocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer DEFAULT 1 NOT NULL,
	`unlocked_by_user_id` integer NOT NULL,
	`listing_id` integer NOT NULL REFERENCES `marketplace_listings`(`id`) ON DELETE CASCADE,
	`unlocked_at` integer NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `marketplace_unlocks_company_idx` ON `marketplace_unlocks` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `marketplace_unlocks_company_listing_unique` ON `marketplace_unlocks` (`company_id`,`listing_id`);--> statement-breakpoint
CREATE TABLE `marketplace_credits` (
	`company_id` integer PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `marketplace_credit_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer DEFAULT 1 NOT NULL,
	`stripe_session_id` text DEFAULT '' NOT NULL,
	`pack_size` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketplace_credit_purchases_session_unique` ON `marketplace_credit_purchases` (`stripe_session_id`);--> statement-breakpoint
CREATE TABLE `marketplace_pro_quota` (
	`company_id` integer PRIMARY KEY NOT NULL,
	`used_this_cycle` integer DEFAULT 0 NOT NULL,
	`cycle_start` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `marketplace_phone_verified` integer DEFAULT 0 NOT NULL;