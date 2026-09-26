ALTER TABLE `settings` ADD `profile_description` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD `service_area` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD `facebook_url` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD `instagram_url` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD `youtube_url` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD `cover_blob_key` text;
--> statement-breakpoint
ALTER TABLE `marketplace_listings` ADD `listing_type` text NOT NULL DEFAULT 'project';
--> statement-breakpoint
ALTER TABLE `marketplace_listings` ADD `employment_type` text NOT NULL DEFAULT 'full_time';
--> statement-breakpoint
ALTER TABLE `marketplace_listings` ADD `pay_unit` text NOT NULL DEFAULT 'hourly';
--> statement-breakpoint
ALTER TABLE `marketplace_requests` ADD `listing_type` text NOT NULL DEFAULT 'project';
