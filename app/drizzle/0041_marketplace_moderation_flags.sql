-- Marketplace content moderation: listing moderation status/columns and user flags.
ALTER TABLE `marketplace_listings` ADD `moderation_status` text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `marketplace_listings` ADD `moderation_reason` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `marketplace_listings` ADD `flag_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `marketplace_flags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `listing_id` integer NOT NULL REFERENCES `marketplace_listings`(`id`) ON DELETE CASCADE,
  `reporter_company_id` integer NOT NULL DEFAULT 1,
  `reporter_user_id` integer NOT NULL,
  `reason` text NOT NULL DEFAULT 'other',
  `details` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'open',
  `created_at` integer NOT NULL
);
