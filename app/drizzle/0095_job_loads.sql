-- 0095: Job loads / dump-run log (SimplySub steals Item 2) — one row per
-- hauling / dump run logged against a job (debris haul, concrete, dirt,
-- material delivery, other). A load with a cost posts that cost into the
-- job's EXISTING expense data: `expense_id` points at the
-- business_expenses row created in lockstep with the load (category
-- "hauling", job_id = the load's job), so job costing, getJobOperations
-- and budget-vs-actual include loads with no extra plumbing. A load
-- with cost NULL is proof-only and has no expense row. The optional
-- photo is a blob (photo_blob_key), following the photos/selections
-- attachment pattern — no parallel file system. Attestation is the
-- lightweight "logged by" form: logged_by_user_id + logged_by_name +
-- attested flag + attested_at timestamp (the punch-signoff drawn
-- signature flow is a job-completion ceremony, not a per-load one).
CREATE TABLE `job_loads` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `expense_id` integer REFERENCES `business_expenses`(`id`) ON DELETE SET NULL,
  `load_date` text NOT NULL,
  `kind` text NOT NULL DEFAULT 'debris_haul',
  `quantity` text NOT NULL DEFAULT '1',
  `unit` text NOT NULL DEFAULT 'loads',
  `cost` text,
  `vendor` text NOT NULL DEFAULT '',
  `notes` text NOT NULL DEFAULT '',
  `photo_blob_key` text,
  `photo_filename` text NOT NULL DEFAULT '',
  `photo_content_type` text NOT NULL DEFAULT '',
  `logged_by_user_id` integer,
  `logged_by_name` text NOT NULL DEFAULT '',
  `attested` integer NOT NULL DEFAULT 0,
  `attested_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_loads_job_idx` ON `job_loads` (`job_id`);
--> statement-breakpoint
CREATE INDEX `job_loads_company_idx` ON `job_loads` (`company_id`);
--> statement-breakpoint
CREATE INDEX `job_loads_date_idx` ON `job_loads` (`load_date`);
