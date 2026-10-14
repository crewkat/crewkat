-- 0075: per-estimate materials buy list. One JSON array on the quote:
-- [{ "name": string, "qty": string, "unit": string, "checked": boolean }].
-- Replaces the Build 4 checklist that mirrored line items verbatim (and so
-- showed whole scope paragraphs and prices as "materials").
ALTER TABLE `quotes` ADD `materials_json` text NOT NULL DEFAULT '[]';
