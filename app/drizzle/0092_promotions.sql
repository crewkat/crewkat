-- 0092: Promotions (Office email campaigns) — campaigns, per-recipient
-- send records with per-recipient unsubscribe tokens, and the company
-- email suppression list. One unsubscribe click adds the address here;
-- every promotional send (all segment modes) excludes suppressed
-- addresses. Review-request email is NOT marketing and never consults
-- this list.
CREATE TABLE `campaigns` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `name` text NOT NULL,
  `type` text NOT NULL DEFAULT 'promotion',
  `status` text NOT NULL DEFAULT 'draft',
  `subject` text NOT NULL DEFAULT '',
  `prompt` text NOT NULL DEFAULT '',
  `headline` text NOT NULL DEFAULT '',
  `body_text` text NOT NULL DEFAULT '',
  `cta_label` text NOT NULL DEFAULT '',
  `cta_url` text NOT NULL DEFAULT '',
  `image_blob_key` text,
  `custom_html` text NOT NULL DEFAULT '',
  `recipient_mode` text NOT NULL DEFAULT 'all',
  `recipient_client_ids_json` text NOT NULL DEFAULT '[]',
  `recipient_count` integer NOT NULL DEFAULT 0,
  `sent_count` integer NOT NULL DEFAULT 0,
  `failed_count` integer NOT NULL DEFAULT 0,
  `sent_at` integer,
  `created_by_user_id` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `campaign_recipients` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `campaign_id` integer NOT NULL REFERENCES `campaigns`(`id`) ON DELETE CASCADE,
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE SET NULL,
  `client_name` text NOT NULL DEFAULT '',
  `email` text NOT NULL,
  `status` text NOT NULL DEFAULT 'sent',
  `error` text NOT NULL DEFAULT '',
  `unsubscribe_token` text NOT NULL,
  `sent_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_recipients_token_idx` ON `campaign_recipients` (`unsubscribe_token`);
--> statement-breakpoint
CREATE INDEX `campaign_recipients_campaign_idx` ON `campaign_recipients` (`campaign_id`);
--> statement-breakpoint
CREATE TABLE `email_suppressions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `email` text NOT NULL,
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE SET NULL,
  `source` text NOT NULL DEFAULT 'unsubscribe',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_suppressions_company_email_idx` ON `email_suppressions` (`company_id`, `email`);
