INSERT INTO `quote_templates` (`name`, `line_items_json`, `is_starter`, `created_at`, `updated_at`)
SELECT 'Kitchen remodel', '[{"description":"Demolition and site protection","amount":""},{"description":"Cabinet installation","amount":""},{"description":"Countertop installation","amount":""},{"description":"Plumbing and electrical finish","amount":""},{"description":"Final cleanup","amount":""}]', 1, unixepoch('now') * 1000, unixepoch('now') * 1000
WHERE NOT EXISTS (SELECT 1 FROM `quote_templates` WHERE `name` = 'Kitchen remodel');
--> statement-breakpoint
INSERT INTO `quote_templates` (`name`, `line_items_json`, `is_starter`, `created_at`, `updated_at`)
SELECT 'Bathroom remodel', '[{"description":"Demolition and waterproofing","amount":""},{"description":"Tile installation","amount":""},{"description":"Vanity and fixture installation","amount":""},{"description":"Plumbing and electrical finish","amount":""},{"description":"Final cleanup","amount":""}]', 1, unixepoch('now') * 1000, unixepoch('now') * 1000
WHERE NOT EXISTS (SELECT 1 FROM `quote_templates` WHERE `name` = 'Bathroom remodel');
--> statement-breakpoint
INSERT INTO `quote_templates` (`name`, `line_items_json`, `is_starter`, `created_at`, `updated_at`)
SELECT 'Painting', '[{"description":"Surface preparation and protection","amount":""},{"description":"Primer where required","amount":""},{"description":"Two finish coats","amount":""},{"description":"Touch-ups and cleanup","amount":""}]', 1, unixepoch('now') * 1000, unixepoch('now') * 1000
WHERE NOT EXISTS (SELECT 1 FROM `quote_templates` WHERE `name` = 'Painting');