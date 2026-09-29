-- Marketplace paid bump: featured placement with expiry.
ALTER TABLE `marketplace_listings` ADD COLUMN `featured_until` integer;
--> statement-breakpoint
CREATE TABLE `listing_bump_purchases` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` INTEGER NOT NULL DEFAULT 1,
  `listing_id` INTEGER NOT NULL REFERENCES `marketplace_listings`(`id`) ON DELETE CASCADE,
  `stripe_session_id` TEXT NOT NULL DEFAULT '',
  `purchased_at` INTEGER NOT NULL,
  `expires_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bump_purchases_listing` ON `listing_bump_purchases` (`listing_id`, `expires_at` DESC);
--> statement-breakpoint
-- Estimate nudge: timestamp of the last automated follow-up reminder per quote.
ALTER TABLE `quotes` ADD COLUMN `estimate_nudge_sent_at` integer;
