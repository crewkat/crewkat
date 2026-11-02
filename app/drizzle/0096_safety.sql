-- 0096: Safety — toolbox talks + credential tracking (SimplySub steals
-- Item 3, OFFICE ONLY). The 24-talk library itself is content data
-- (server/src/safety.ts, EN + ES), not rows. This migration adds:
--   safety_sessions          — one row per talk actually run. Library
--                              talks snapshot title + bullets onto the
--                              row; custom talks carry their own title/
--                              body. Presenter signature is a PNG blob
--                              key (punch-signoff convention).
--   safety_session_attendees — the attendance proof checklist.
--   member_credentials       — licenses/cards held by a team MEMBER
--                              (auth_users id): contractor license,
--                              OSHA 10/30, CPR/First Aid, EPA RRP,
--                              driver's license, custom. Distinct from
--                              the legacy `credentials` table (business /
--                              subcontractor paperwork). Optional file /
--                              photo attachment via blob key.
CREATE TABLE `safety_sessions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `job_id` integer REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `session_date` text NOT NULL,
  `talk_slug` text,
  `talk_title` text NOT NULL,
  `talk_points_json` text NOT NULL DEFAULT '[]',
  `custom_body` text NOT NULL DEFAULT '',
  `presenter_user_id` integer,
  `presenter_name` text NOT NULL DEFAULT '',
  `signature_blob_key` text,
  `created_by_user_id` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `safety_sessions_company_idx` ON `safety_sessions` (`company_id`);
--> statement-breakpoint
CREATE INDEX `safety_sessions_job_idx` ON `safety_sessions` (`job_id`);
--> statement-breakpoint
CREATE INDEX `safety_sessions_date_idx` ON `safety_sessions` (`session_date`);
--> statement-breakpoint
CREATE TABLE `safety_session_attendees` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `session_id` integer NOT NULL REFERENCES `safety_sessions`(`id`) ON DELETE CASCADE,
  `user_id` integer,
  `attendee_name` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `safety_session_attendees_session_idx` ON `safety_session_attendees` (`session_id`);
--> statement-breakpoint
CREATE INDEX `safety_session_attendees_user_idx` ON `safety_session_attendees` (`user_id`);
--> statement-breakpoint
CREATE TABLE `member_credentials` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `user_id` integer NOT NULL,
  `member_name` text NOT NULL DEFAULT '',
  `type` text NOT NULL DEFAULT 'custom',
  `custom_label` text NOT NULL DEFAULT '',
  `number` text NOT NULL DEFAULT '',
  `expires_on` text NOT NULL DEFAULT '',
  `attachment_blob_key` text,
  `attachment_filename` text NOT NULL DEFAULT '',
  `attachment_content_type` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `member_credentials_company_idx` ON `member_credentials` (`company_id`);
--> statement-breakpoint
CREATE INDEX `member_credentials_user_idx` ON `member_credentials` (`user_id`);
--> statement-breakpoint
CREATE INDEX `member_credentials_expiry_idx` ON `member_credentials` (`expires_on`);
