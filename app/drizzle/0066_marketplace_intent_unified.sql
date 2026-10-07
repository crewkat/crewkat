ALTER TABLE `marketplace_listings` ADD `intent` text NOT NULL DEFAULT 'offer';
--> statement-breakpoint
ALTER TABLE `marketplace_listings` ADD `needed_by` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `marketplace_listings` SET `intent` = 'need' WHERE `listing_type` = 'job';
--> statement-breakpoint
INSERT INTO `marketplace_listings`
  (`company_id`, `title`, `category`, `intent`, `description`, `service_area`, `needed_by`,
   `company_name`, `company_phone`, `price_kind`, `moderation_status`, `created_at`, `updated_at`)
SELECT `company_id`, `title`, `category`, 'need', `description`, `service_area`, `needed_by`,
   `company_name`, `company_phone`, 'contact', 'active', `created_at`, `updated_at`
FROM `marketplace_requests`;
--> statement-breakpoint
UPDATE `bid_board_items` SET `request_id` = NULL WHERE `request_id` IS NOT NULL;
--> statement-breakpoint
DROP TABLE `marketplace_requests`;
--> statement-breakpoint
ALTER TABLE `marketplace_listings` DROP COLUMN `listing_type`;
