CREATE TABLE `support_reports` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `subject` text NOT NULL,
  `message` text NOT NULL,
  `language` text DEFAULT 'en' NOT NULL,
  `created_at` integer NOT NULL
);
