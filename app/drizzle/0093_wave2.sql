-- 0093: Wave 2 — Pay Now (Stripe Connect), QuickBooks sync, reputation
-- inbox, lead capture form.
--
-- settings: the company's Stripe Connect account + cached status, and
-- the public lead-capture form code.
ALTER TABLE `settings` ADD COLUMN `stripe_connect_account_id` text;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `stripe_connect_status` text NOT NULL DEFAULT 'not_connected';
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `stripe_charges_enabled` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `stripe_payouts_enabled` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `lead_form_code` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_lead_form_code_idx` ON `settings` (`lead_form_code`);
--> statement-breakpoint
-- payments: the Stripe PaymentIntent behind an online payment, so a
-- webhook can never record the same money twice.
ALTER TABLE `payments` ADD COLUMN `stripe_payment_intent_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_stripe_pi_idx` ON `payments` (`stripe_payment_intent_id`);
--> statement-breakpoint
-- One row per portal/app "Pay now" checkout attempt against an invoice.
-- pending -> paid (webhook recorded the payment) / failed / expired.
CREATE TABLE `invoice_payment_attempts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `invoice_id` integer NOT NULL REFERENCES `invoices`(`id`) ON DELETE CASCADE,
  `stripe_session_id` text NOT NULL,
  `stripe_payment_intent_id` text,
  `amount` text NOT NULL,
  `method` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'pending',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_payment_attempts_session_idx` ON `invoice_payment_attempts` (`stripe_session_id`);
--> statement-breakpoint
CREATE INDEX `invoice_payment_attempts_invoice_idx` ON `invoice_payment_attempts` (`invoice_id`);
--> statement-breakpoint
-- QuickBooks Online: one connection per company. Tokens live server-side
-- only and never leave through an action payload.
CREATE TABLE `quickbooks_connections` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL,
  `realm_id` text NOT NULL DEFAULT '',
  `access_token` text NOT NULL DEFAULT '',
  `refresh_token` text NOT NULL DEFAULT '',
  `access_token_expires_at` integer,
  `status` text NOT NULL DEFAULT 'not_connected',
  `company_name` text NOT NULL DEFAULT '',
  `default_item_id` text NOT NULL DEFAULT '',
  `state_token` text NOT NULL DEFAULT '',
  `last_sync_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quickbooks_connections_company_idx` ON `quickbooks_connections` (`company_id`);
--> statement-breakpoint
-- Per-record QuickBooks sync state — the Sync Status centre reads this.
CREATE TABLE `qb_sync_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `entity_type` text NOT NULL,
  `entity_id` integer NOT NULL,
  `qb_id` text,
  `status` text NOT NULL DEFAULT 'pending',
  `error` text NOT NULL DEFAULT '',
  `last_synced_at` integer,
  `crewkat_updated_at` integer NOT NULL,
  `qb_updated_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qb_sync_records_entity_idx` ON `qb_sync_records` (`company_id`, `entity_type`, `entity_id`);
--> statement-breakpoint
-- Reputation inbox: posted reviews captured against a job/client. The
-- review REQUEST side stays in automation_logs (shared with Feature 1);
-- a request shows "posted" when a review here matches its job.
CREATE TABLE `client_reviews` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `job_id` integer REFERENCES `jobs`(`id`) ON DELETE SET NULL,
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE SET NULL,
  `client_name` text NOT NULL DEFAULT '',
  `rating` integer NOT NULL,
  `text` text NOT NULL DEFAULT '',
  `review_date` text NOT NULL DEFAULT '',
  `source` text NOT NULL DEFAULT 'manual',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_reviews_job_idx` ON `client_reviews` (`job_id`);
