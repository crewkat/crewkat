CREATE TABLE `marketplace_listings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `category` text NOT NULL,
  `price_kind` text DEFAULT 'contact' NOT NULL,
  `price` text DEFAULT '' NOT NULL,
  `original_price` text DEFAULT '' NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `service_area` text NOT NULL,
  `company_name` text NOT NULL,
  `company_phone` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `marketplace_listing_photos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `listing_id` integer NOT NULL,
  `blob_key` text NOT NULL,
  `filename` text NOT NULL,
  `content_type` text NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`listing_id`) REFERENCES `marketplace_listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `marketplace_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `category` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `service_area` text NOT NULL,
  `needed_by` text DEFAULT '' NOT NULL,
  `company_name` text NOT NULL,
  `company_phone` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
