ALTER TABLE `invoices` ADD `customize_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `quotes` ADD `customize_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `settings` ADD `default_customize_json` text NOT NULL DEFAULT '{}';
