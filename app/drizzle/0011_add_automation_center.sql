ALTER TABLE `quotes` ADD `automation_status` text DEFAULT 'awaiting' NOT NULL;
--> statement-breakpoint
ALTER TABLE `selections` ADD `lead_time_days` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `automation_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `entity_id` integer NOT NULL,
  `stage` text DEFAULT '' NOT NULL,
  `channel` text DEFAULT 'sms' NOT NULL,
  `sent_at` integer NOT NULL
);
