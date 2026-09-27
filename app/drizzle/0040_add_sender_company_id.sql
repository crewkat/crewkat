ALTER TABLE `marketplace_messages` ADD `sender_company_id` integer;
--> statement-breakpoint
UPDATE `marketplace_messages` SET `sender_company_id` = `company_id` WHERE `sender` = 'me';
