-- Phase 3: dispatch calendar + On My Way + selection budgets.
-- Appointments gain dispatch fields (status, crew assignment), an ETA for
-- On My Way, and a shareable token for the public status page.
-- Selections gain estimated/actual cost for budget integration.
ALTER TABLE `appointments` ADD `status` TEXT NOT NULL DEFAULT 'scheduled';
--> statement-breakpoint
ALTER TABLE `appointments` ADD `crew_member` TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `appointments` ADD `eta_minutes` INTEGER;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `share_token_hash` TEXT;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `share_token_hint` TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_share_token_hash_uq` ON `appointments` (`share_token_hash`);
--> statement-breakpoint
ALTER TABLE `selections` ADD `estimated_cost` TEXT NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE `selections` ADD `actual_cost` TEXT NOT NULL DEFAULT '0';
