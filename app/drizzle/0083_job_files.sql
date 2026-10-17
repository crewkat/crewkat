-- 0083: Portal shared files (Danny 2026-10-17) — view-only files a
-- contractor uploads to a job (scope sheets, plans, permits, warranty
-- docs) that the client can see in the client portal. Deliberately NOT
-- the documents table: these files are never signed, carry no placement
-- or fill fields, and the shared_with_client flag is the only
-- visibility switch. Hiding or deleting a row never touches the job's
-- contracts or change orders.
CREATE TABLE `job_files` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `title` text NOT NULL DEFAULT '',
  `filename` text NOT NULL DEFAULT '',
  `blob_key` text NOT NULL,
  `content_type` text NOT NULL DEFAULT 'application/pdf',
  `size_bytes` integer NOT NULL DEFAULT 0,
  `shared_with_client` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL
);
