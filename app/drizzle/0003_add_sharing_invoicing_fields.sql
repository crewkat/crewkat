ALTER TABLE `jobs` ADD `amount_due` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `jobs` ADD `payment_notes` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `settings` ADD `phone` text NOT NULL DEFAULT '(813) 516-5720';
--> statement-breakpoint
ALTER TABLE `settings` ADD `website` text NOT NULL DEFAULT 'stallionsconstruction.com';
--> statement-breakpoint
ALTER TABLE `settings` ADD `review_url` text NOT NULL DEFAULT 'https://g.page/r/CViYeoxjsd0PEBE/review';
--> statement-breakpoint
ALTER TABLE `settings` ADD `social_watermark` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `photos` ADD `captured_at` integer;
