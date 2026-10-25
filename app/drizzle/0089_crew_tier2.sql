-- 0089: Tier 2 (Office subscription capabilities) — crew logins,
-- per-member access overrides, and the company tier flag.
--
-- auth_users gains:
-- - credential_type: "email" (every existing row) vs "crew_pin" (a crew
--   login created by the company admin: no email, no password — the
--   member signs in with the company crew code + a personal PIN).
-- - pin_hash / pin_salt: the PIN credential, PBKDF2-hashed exactly like
--   passwords. Plaintext PINs are never stored; they are returned once,
--   at creation / reset, to the admin who hands them to the member.
-- - access_overrides: JSON object with a subset of the five access
--   switches (seeMoney, seeClientContact, sendDocuments, seeAllJobs,
--   recordPayments). NULL = inherit the role preset.
ALTER TABLE `auth_users` ADD COLUMN `credential_type` text DEFAULT 'email' NOT NULL;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD COLUMN `pin_hash` text;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD COLUMN `pin_salt` text;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD COLUMN `access_overrides` text;
--> statement-breakpoint
-- companies: one row per company (id = company_id). Carries the shared
-- crew sign-in code and the tier flag ("app" = Tier 1 single-user,
-- "office" = Tier 2). Every existing company backfills to "office" so
-- no current account loses team features; crew_code is generated
-- lazily by the action layer (random codes can't be minted in SQL).
CREATE TABLE `companies` (
  `id` integer PRIMARY KEY NOT NULL,
  `crew_code` text,
  `tier` text DEFAULT 'office' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_crew_code_unique` ON `companies` (`crew_code`);
--> statement-breakpoint
INSERT OR IGNORE INTO `companies` (`id`, `tier`, `created_at`, `updated_at`)
  SELECT DISTINCT `company_id`, 'office', 0, 0 FROM `auth_users`;
