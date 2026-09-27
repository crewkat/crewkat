-- Secure persistent login: split the single 30-day bearer token into a 15-minute
-- in-memory session proof plus a rotating HttpOnly refresh-token cookie.
-- Existing rows default to 'legacy' so pre-rollout localStorage sessions keep
-- working (dual-mode transition); new logins issue 'proof' + 'refresh' rows.
ALTER TABLE `auth_sessions` ADD COLUMN `token_type` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD COLUMN `family_id` text;
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD COLUMN `replaced_by` text;
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD COLUMN `absolute_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD COLUMN `user_agent` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD COLUMN `ip_hash` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_family` ON `auth_sessions` (`family_id`);
