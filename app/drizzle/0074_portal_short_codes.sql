-- 0074: Client Portal v2 — short public codes for portal links
-- (e.g. crewkat.com/p/a3f9k2x8q1). Follows the 0060 document-link pattern:
-- add the column, backfill existing rows, then enforce uniqueness.
-- (SQLite has no ADD COLUMN IF NOT EXISTS / ADD COLUMN .. UNIQUE.)
ALTER TABLE `portal_tokens` ADD `short_code` text;
--> statement-breakpoint
UPDATE `portal_tokens` SET `short_code` = lower(substr(hex(randomblob(8)), 1, 10)) WHERE `short_code` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_tokens_short_code_unique` ON `portal_tokens` (`short_code`);
