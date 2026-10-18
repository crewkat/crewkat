-- 0085: Contract-opened notification preference (Danny 2026-10-18) — the
-- owner is notified (push + in-app) the first time a client opens a
-- contract / change-order link. Adds the per-company opt-out toggle column
-- beside the existing notify_* view preferences on settings.
ALTER TABLE `settings` ADD COLUMN `notify_contract_viewed` integer DEFAULT 1 NOT NULL;
