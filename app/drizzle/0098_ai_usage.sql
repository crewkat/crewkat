-- 0098: AI features (first AI hookup, Danny 2026-11-01) — per-company
-- monthly AI generation usage. One row per (company_id, month): month
-- is a "YYYY-MM" UTC key and count increments ONLY on a successful AI
-- generation (the Promotions AI writer and the work-summary polish
-- share this one counter). The cap itself is env (AI_MONTHLY_CAP,
-- default 200) enforced in the action layer — this table only counts,
-- so adding it changes no behavior on its own.
CREATE TABLE `ai_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL DEFAULT 1,
	`month` text NOT NULL,
	`count` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_company_month_idx` ON `ai_usage` (`company_id`, `month`);
