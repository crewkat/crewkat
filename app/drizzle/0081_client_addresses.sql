-- 0081: Multiple saved addresses per client (Danny 2026-10-15) — Danny
-- does repeat work for the same clients at DIFFERENT addresses, so a
-- client profile holds a LIST of saved addresses (label + address, one
-- marked primary). Stored as a JSON array on the client row
-- (clients.addresses_json), in the same style as clients.tags. The
-- legacy single `address` column stays and always mirrors the primary
-- entry, so every existing reader (lists, shapes, pickers) is untouched.
-- Backfill: each client's current address becomes their first saved
-- entry, flagged primary. Profiles accumulate more entries only through
-- explicit user action (Clients screen, or the document sheet's opt-in
-- append) — document saves stay doc-only and never write this list.
ALTER TABLE `clients` ADD COLUMN `addresses_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
UPDATE `clients` SET `addresses_json` = json_array(json_object('label', '', 'address', `address`, 'primary', json('true'))) WHERE trim(`address`) <> '';
