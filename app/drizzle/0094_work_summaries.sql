-- 0094: Work summaries (SimplySub steals Item 1) — a stored, client-ready
-- snapshot of a job's daily logs, notes and photos over a date range,
-- shared through the existing document_links token family
-- (document_kind = 'work_summary', document_id = work_summaries.id).
-- The content snapshot is frozen at creation: later log/photo edits
-- never change what a shared link shows. The snapshot's loads section
-- is written from the start (Item 2 fills its data source in).
CREATE TABLE `work_summaries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `range_start` text NOT NULL,
  `range_end` text NOT NULL,
  `preset` text NOT NULL DEFAULT 'custom',
  `content_json` text NOT NULL DEFAULT '{}',
  `created_by_user_id` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_summaries_job_idx` ON `work_summaries` (`job_id`);
--> statement-breakpoint
CREATE INDEX `work_summaries_company_idx` ON `work_summaries` (`company_id`);
