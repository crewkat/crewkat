-- Phase 1 client list: tags for sorting/filtering clients.
-- Stored as a JSON array of tag strings (e.g. '["VIP","repeat"]');
-- defaults to an empty array for existing rows.
ALTER TABLE `clients` ADD COLUMN `tags` text NOT NULL DEFAULT '[]';
