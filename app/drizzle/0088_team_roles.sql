-- 0088: Track 1c — company team roles & staff accounts. Until now every
-- login was the company's sole owner (auth_users.role = 'owner'). Staff
-- accounts are additional auth_users rows on the SAME company_id with
-- role 'admin' | 'office' | 'field' (the role column is plain text, so
-- the new values need no DDL — the widened enum lives in schema.ts).
-- `deactivated_at` is the company-admin off switch for a staff login:
-- when set, requireSession rejects the user and their sessions are
-- revoked. Distinct from suspended_at, which is a PLATFORM-level
-- suspension set by Danny's team, not by the company.
ALTER TABLE `auth_users` ADD COLUMN `deactivated_at` integer;
