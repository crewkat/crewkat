-- 0090: Crewkat Office Wave 1 — production stages, the follow-up
-- queue, recorded job events, and automation recipe switches.
--
-- jobs.production_stage: the Production Board stage. Backfill:
-- jobs already completed land on "complete"; everything else starts
-- on "scheduled" (the board's first column).
ALTER TABLE `jobs` ADD COLUMN `production_stage` text DEFAULT 'scheduled' NOT NULL;
--> statement-breakpoint
UPDATE `jobs` SET `production_stage` = 'complete' WHERE `completed_at` IS NOT NULL;
--> statement-breakpoint
-- follow_ups: the Office follow-up queue (manual + automation items
-- across leads/jobs/clients/invoices). source_key dedupes automation
-- items via the partial unique index below.
CREATE TABLE `follow_ups` (
  `company_id` integer DEFAULT 1 NOT NULL,
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text DEFAULT '' NOT NULL,
  `body` text DEFAULT '' NOT NULL,
  `due_date` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `source` text DEFAULT 'manual' NOT NULL,
  `source_key` text DEFAULT '' NOT NULL,
  `recipe` text DEFAULT '' NOT NULL,
  `assignee_user_id` integer,
  `lead_id` integer REFERENCES `leads`(`id`) ON DELETE CASCADE,
  `job_id` integer REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `client_id` integer REFERENCES `clients`(`id`) ON DELETE CASCADE,
  `invoice_id` integer REFERENCES `invoices`(`id`) ON DELETE CASCADE,
  `created_by_user_id` integer,
  `completed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `follow_ups_company_status_idx` ON `follow_ups` (`company_id`, `status`, `due_date`);
--> statement-breakpoint
CREATE INDEX `follow_ups_job_idx` ON `follow_ups` (`job_id`);
--> statement-breakpoint
CREATE INDEX `follow_ups_lead_idx` ON `follow_ups` (`lead_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `follow_ups_source_key_unique` ON `follow_ups` (`company_id`, `source_key`) WHERE `source_key` <> '';
--> statement-breakpoint
-- job_events: production-stage moves + automation firings for the
-- unified job/client timeline (everything else on the timeline is
-- derived from its own source tables at read time).
CREATE TABLE `job_events` (
  `company_id` integer DEFAULT 1 NOT NULL,
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `kind` text DEFAULT 'stage' NOT NULL,
  `title` text DEFAULT '' NOT NULL,
  `body` text DEFAULT '' NOT NULL,
  `created_by_user_id` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_events_job_idx` ON `job_events` (`job_id`, `created_at`);
--> statement-breakpoint
-- office_automation_settings: one row per company, JSON recipe map.
CREATE TABLE `office_automation_settings` (
  `company_id` integer PRIMARY KEY NOT NULL,
  `recipes_json` text DEFAULT '{}' NOT NULL,
  `updated_at` integer NOT NULL
);
