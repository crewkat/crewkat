-- Sample jobs must not count toward the free tier's 3-active-job ceiling.
--
-- The "[SAMPLE]" name prefix was only a display marker; the authoritative flag
-- is now is_sample. Existing databases get it backfilled from the marker.
-- (A user typing "[SAMPLE]" into a job title would only ever make that job
-- *not* count toward their limit — a benign direction.)
ALTER TABLE `jobs` ADD `is_sample` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `jobs` SET `is_sample` = 1 WHERE `job_type` LIKE '[SAMPLE]%';
