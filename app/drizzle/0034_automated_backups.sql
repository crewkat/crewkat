CREATE TABLE `backup_runs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `started_at` integer NOT NULL,
  `finished_at` integer,
  `db_bytes` integer,
  `blob_bytes` integer,
  `total_bytes` integer,
  `file_path` text,
  `offsite_sent` integer NOT NULL DEFAULT 0,
  `integrity_ok` integer,
  `error` text,
  `notes` text
);
--> statement-breakpoint
CREATE INDEX `idx_backup_runs_started` ON `backup_runs` (`started_at`);
