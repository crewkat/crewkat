CREATE TABLE `financial_document_signatures` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `document_kind` text NOT NULL,
  `document_id` integer NOT NULL,
  `signer_name` text NOT NULL,
  `signature_blob_key` text NOT NULL,
  `signed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `financial_document_signature_unique` ON `financial_document_signatures` (`document_kind`,`document_id`);
