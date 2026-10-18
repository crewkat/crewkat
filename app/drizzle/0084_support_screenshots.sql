-- 0084: Support report screenshots (Danny 2026-10-18) — users can attach
-- up to 4 screenshots from Settings -> Send a report so the platform team
-- can see the issue. The image bytes live in blob storage under
-- `support-screenshots/<userId>/`; this column stores only the blob keys
-- as a JSON array ('[]' when none).
ALTER TABLE `platform_support_reports` ADD COLUMN `screenshot_keys` text DEFAULT '[]' NOT NULL;
