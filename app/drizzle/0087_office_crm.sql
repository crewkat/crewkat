-- 0087: Crewkat Office CRM (Phase 1) — the desktop office pipeline needs
-- a dollar value on each lead and a per-lead activity timeline. Leads gain
-- `estimated_value` (money-as-text, "0" = not yet estimated, matching the
-- codebase convention); `lead_activities` records notes / calls / emails /
-- texts logged by the office plus stage moves and system events written by
-- the lead actions. Deleting a lead cascades its timeline away.
ALTER TABLE `leads` ADD COLUMN `estimated_value` text DEFAULT '0' NOT NULL;
--> statement-breakpoint
CREATE TABLE `lead_activities` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `lead_id` integer NOT NULL REFERENCES `leads`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL DEFAULT 'note',
  `body` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lead_activities_lead_idx` ON `lead_activities` (`lead_id`);
