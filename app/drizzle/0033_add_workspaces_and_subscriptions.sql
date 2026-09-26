ALTER TABLE `clients` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `jobs` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `photos` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `quotes` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `financial_document_signatures` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `punch_items` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `punch_signoffs` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `progress_updates` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `time_entries` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `receipts` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `crew_tasks` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `voice_notes` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `completion_certificates` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `appointments` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `selections` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `daily_logs` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `internal_notes` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `payment_milestones` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `automation_logs` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `support_reports` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `price_book_items` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `quote_templates` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `mileage_trips` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `business_expenses` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `subcontractors` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `share_images` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `warranties` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `slideshow_videos` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `scanned_documents` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `suppliers` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `maintenance_plans` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `app_users` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `admin_parameters` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `portal_tokens` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `document_links` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `document_link_events` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `material_cost_items` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `supplier_quotes` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `equipment` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `safety_talks` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `incidents` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `credentials` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `crew_pay_rates` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `completion_overrides` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `marketplace_listings` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `marketplace_listing_photos` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `marketplace_messages` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `marketplace_booking_requests` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `marketplace_requests` ADD COLUMN `company_id` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD COLUMN `tier` text NOT NULL DEFAULT 'free';
--> statement-breakpoint
ALTER TABLE `auth_users` ADD COLUMN `stripe_customer_id` text;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD COLUMN `stripe_subscription_id` text;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD COLUMN `subscription_status` text NOT NULL DEFAULT 'inactive';
--> statement-breakpoint
ALTER TABLE `auth_users` ADD COLUMN `subscription_current_period_end` integer;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD COLUMN `cancel_at_period_end` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `auth_users` SET `tier` = 'premium', `subscription_status` = 'founder' WHERE `id` = (SELECT MIN(`id`) FROM `auth_users`);
--> statement-breakpoint
CREATE INDEX `clients_company_idx` ON `clients` (`company_id`);
--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company_id`);
--> statement-breakpoint
CREATE INDEX `quotes_company_idx` ON `quotes` (`company_id`);
--> statement-breakpoint
CREATE INDEX `invoices_company_idx` ON `invoices` (`company_id`);
--> statement-breakpoint
CREATE INDEX `marketplace_listings_company_idx` ON `marketplace_listings` (`company_id`);
--> statement-breakpoint
CREATE INDEX `auth_users_company_idx` ON `auth_users` (`company_id`);
--> statement-breakpoint
CREATE TABLE `stripe_webhook_events` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `processed_at` integer NOT NULL
);
