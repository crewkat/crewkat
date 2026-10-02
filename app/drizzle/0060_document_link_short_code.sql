-- Build 0.5 (items 2+3): short public codes for client document links.
--
-- The 64-char token stays the bearer secret stored as a hash; short_code is a
-- short alias (e.g. /d/a3f9k2x8q1) that redirects to the full #doc= link so
-- shared URLs are short and professional. Existing rows get backfilled codes.
ALTER TABLE `document_links` ADD `short_code` text;
--> statement-breakpoint
UPDATE `document_links` SET `short_code` = lower(substr(hex(randomblob(8)), 1, 10)) WHERE `short_code` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `document_links_short_code_unique` ON `document_links` (`short_code`);
