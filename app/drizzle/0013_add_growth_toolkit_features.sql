ALTER TABLE `appointments` ADD `exterior_work` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `price_book_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `unit_price` text DEFAULT '0' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quote_templates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `line_items_json` text NOT NULL,
  `is_starter` integer DEFAULT false NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mileage_trips` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `trip_date` text NOT NULL,
  `from_location` text DEFAULT '' NOT NULL,
  `to_location` text DEFAULT '' NOT NULL,
  `miles` text DEFAULT '0' NOT NULL,
  `job_id` integer,
  `purpose` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `business_expenses` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `expense_date` text NOT NULL,
  `vendor` text DEFAULT '' NOT NULL,
  `amount` text DEFAULT '0' NOT NULL,
  `category` text DEFAULT 'other' NOT NULL,
  `job_id` integer,
  `note` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `subcontractors` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL,
  `name` text NOT NULL,
  `trade` text DEFAULT '' NOT NULL,
  `phone` text DEFAULT '' NOT NULL,
  `agreed_amount` text DEFAULT '0' NOT NULL,
  `paid_to_date` text DEFAULT '0' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `share_images` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL,
  `before_photo_id` integer NOT NULL,
  `after_photo_id` integer NOT NULL,
  `branded` integer DEFAULT true NOT NULL,
  `blob_key` text NOT NULL,
  `filename` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);