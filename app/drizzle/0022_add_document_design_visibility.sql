ALTER TABLE quotes ADD COLUMN show_tax_line integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE quotes ADD COLUMN show_discount_line integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE quotes ADD COLUMN show_paid_line integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE quotes ADD COLUMN show_payment_terms integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE quotes ADD COLUMN show_footer_notes integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE quotes ADD COLUMN show_logo integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE quotes ADD COLUMN show_company_info integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN show_tax_line integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN show_discount_line integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN show_paid_line integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN show_payment_terms integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN show_footer_notes integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN show_logo integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE invoices ADD COLUMN show_company_info integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN default_show_tax_line integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN default_show_discount_line integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN default_show_paid_line integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN default_show_payment_terms integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN default_show_footer_notes integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN default_show_logo integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN default_show_company_info integer NOT NULL DEFAULT 1;