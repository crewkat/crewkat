ALTER TABLE `marketplace_listings` ADD `bookable` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `marketplace_listings` ADD `daily_rate` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `marketplace_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `listing_id` integer NOT NULL,
  `body` text DEFAULT '' NOT NULL,
  `image_blob_key` text,
  `image_filename` text DEFAULT '' NOT NULL,
  `image_content_type` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`listing_id`) REFERENCES `marketplace_listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `marketplace_booking_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `listing_id` integer NOT NULL,
  `start_date` text NOT NULL,
  `end_date` text NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'requested' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`listing_id`) REFERENCES `marketplace_listings`(`id`) ON UPDATE no action ON DELETE cascade
);