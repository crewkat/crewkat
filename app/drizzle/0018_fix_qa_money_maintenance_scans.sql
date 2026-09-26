ALTER TABLE `jobs` ADD `maintenance_plan_id` integer;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `maintenance_due_date` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_maintenance_cycle_unique` ON `jobs` (`maintenance_plan_id`,`maintenance_due_date`);
--> statement-breakpoint
UPDATE `jobs` SET
  `amount_due` = CASE WHEN trim(replace(replace(replace(`amount_due`, '$', ''), ',', ''), ' ', '')) = '' THEN '' ELSE printf('%.2f', CAST(replace(replace(replace(`amount_due`, '$', ''), ',', ''), ' ', '') AS REAL)) END,
  `deposit_amount` = CASE WHEN trim(replace(replace(replace(`deposit_amount`, '$', ''), ',', ''), ' ', '')) = '' THEN '' ELSE printf('%.2f', CAST(replace(replace(replace(`deposit_amount`, '$', ''), ',', ''), ' ', '') AS REAL)) END;
--> statement-breakpoint
UPDATE `documents` SET `amount` = CASE WHEN trim(replace(replace(replace(`amount`, '$', ''), ',', ''), ' ', '')) = '' THEN '' ELSE printf('%.2f', CAST(replace(replace(replace(`amount`, '$', ''), ',', ''), ' ', '') AS REAL)) END;
--> statement-breakpoint
UPDATE `quotes` SET
  `subtotal` = printf('%.2f', CAST(replace(replace(replace(`subtotal`, '$', ''), ',', ''), ' ', '') AS REAL)),
  `discount_value` = printf('%.2f', CAST(replace(replace(replace(`discount_value`, '$', ''), ',', ''), ' ', '') AS REAL)),
  `tax_value` = printf('%.2f', CAST(replace(replace(replace(`tax_value`, '$', ''), ',', ''), ' ', '') AS REAL)),
  `total` = printf('%.2f', CAST(replace(replace(replace(`total`, '$', ''), ',', ''), ' ', '') AS REAL)),
  `line_items_json` = COALESCE((SELECT json_group_array(json_object('description', json_extract(value, '$.description'), 'amount', CASE WHEN trim(replace(replace(replace(json_extract(value, '$.amount'), '$', ''), ',', ''), ' ', '')) = '' THEN '' ELSE printf('%.2f', CAST(replace(replace(replace(json_extract(value, '$.amount'), '$', ''), ',', ''), ' ', '') AS REAL)) END)) FROM json_each(`quotes`.`line_items_json`)), '[]');
--> statement-breakpoint
UPDATE `invoices` SET
  `subtotal` = printf('%.2f', CAST(replace(replace(replace(`subtotal`, '$', ''), ',', ''), ' ', '') AS REAL)),
  `discount_value` = printf('%.2f', CAST(replace(replace(replace(`discount_value`, '$', ''), ',', ''), ' ', '') AS REAL)),
  `tax_value` = printf('%.2f', CAST(replace(replace(replace(`tax_value`, '$', ''), ',', ''), ' ', '') AS REAL)),
  `total` = printf('%.2f', CAST(replace(replace(replace(`total`, '$', ''), ',', ''), ' ', '') AS REAL)),
  `line_items_json` = COALESCE((SELECT json_group_array(json_object('description', json_extract(value, '$.description'), 'amount', CASE WHEN trim(replace(replace(replace(json_extract(value, '$.amount'), '$', ''), ',', ''), ' ', '')) = '' THEN '' ELSE printf('%.2f', CAST(replace(replace(replace(json_extract(value, '$.amount'), '$', ''), ',', ''), ' ', '') AS REAL)) END)) FROM json_each(`invoices`.`line_items_json`)), '[]');
--> statement-breakpoint
UPDATE `quote_templates` SET `line_items_json` = COALESCE((SELECT json_group_array(json_object('description', json_extract(value, '$.description'), 'amount', CASE WHEN trim(replace(replace(replace(json_extract(value, '$.amount'), '$', ''), ',', ''), ' ', '')) = '' THEN '' ELSE printf('%.2f', CAST(replace(replace(replace(json_extract(value, '$.amount'), '$', ''), ',', ''), ' ', '') AS REAL)) END)) FROM json_each(`quote_templates`.`line_items_json`)), '[]');
--> statement-breakpoint
UPDATE `payments` SET `amount` = printf('%.2f', CAST(replace(replace(replace(`amount`, '$', ''), ',', ''), ' ', '') AS REAL));
--> statement-breakpoint
UPDATE `receipts` SET `amount` = printf('%.2f', CAST(replace(replace(replace(`amount`, '$', ''), ',', ''), ' ', '') AS REAL));
--> statement-breakpoint
UPDATE `business_expenses` SET `amount` = printf('%.2f', CAST(replace(replace(replace(`amount`, '$', ''), ',', ''), ' ', '') AS REAL));
--> statement-breakpoint
UPDATE `price_book_items` SET `unit_price` = printf('%.2f', CAST(replace(replace(replace(`unit_price`, '$', ''), ',', ''), ' ', '') AS REAL));
--> statement-breakpoint
UPDATE `payment_milestones` SET `amount` = printf('%.2f', CAST(replace(replace(replace(`amount`, '$', ''), ',', ''), ' ', '') AS REAL));
--> statement-breakpoint
UPDATE `subcontractors` SET
  `agreed_amount` = printf('%.2f', CAST(replace(replace(replace(`agreed_amount`, '$', ''), ',', ''), ' ', '') AS REAL)),
  `paid_to_date` = printf('%.2f', CAST(replace(replace(replace(`paid_to_date`, '$', ''), ',', ''), ' ', '') AS REAL));
--> statement-breakpoint
DELETE FROM `support_reports` WHERE `subject` = 'QA test' AND `status` = 'resolved';
--> statement-breakpoint
DELETE FROM `quotes` WHERE `id` = 2 AND `client_name` = 'QA Test Client';
--> statement-breakpoint
DELETE FROM `clients` WHERE `name` IN ('QA Test Client', 'QA Client');
--> statement-breakpoint
DELETE FROM `maintenance_plans` WHERE `title` = 'QA Maintenance Plan' AND `client_name` = 'QA Client';
--> statement-breakpoint
DELETE FROM `jobs` WHERE `id` IN (3, 4) AND `client_name` = 'QA Client' AND `job_type` = 'QA Maintenance Plan';
