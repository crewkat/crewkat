CREATE TABLE `document_links` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `document_kind` TEXT NOT NULL,
  `document_id` INTEGER NOT NULL,
  `token_hash` TEXT NOT NULL,
  `token_hint` TEXT NOT NULL,
  `expires_at` INTEGER NOT NULL,
  `revoked_at` INTEGER,
  `view_count` INTEGER NOT NULL DEFAULT 0,
  `first_viewed_at` INTEGER,
  `last_viewed_at` INTEGER,
  `created_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_links_token_hash_unique` ON `document_links` (`token_hash`);
--> statement-breakpoint
CREATE TABLE `document_link_events` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `link_id` INTEGER NOT NULL REFERENCES `document_links`(`id`) ON DELETE CASCADE,
  `event_type` TEXT NOT NULL,
  `user_agent` TEXT NOT NULL DEFAULT '',
  `occurred_at` INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `client_signed_pdf_blob_key` TEXT;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `client_signature_hash` TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `client_signed_user_agent` TEXT NOT NULL DEFAULT '';
