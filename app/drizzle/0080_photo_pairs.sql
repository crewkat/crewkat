-- 0080: Photo Proof Pack (Danny 2026-10-14, phase 2 of the 2→3→1
-- program) — a persistent Before/After pairing of two photos of the
-- same job, rendered as a swipe-slider in the job's photos and in the
-- client portal. The pair owns no blob: it points at two photo rows.
-- Unpairing deletes only this row; deleting a photo removes its pairs
-- (handled in deletePhoto; a pair whose photo is gone is also skipped
-- at read time).
CREATE TABLE `photo_pairs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `company_id` integer NOT NULL DEFAULT 1,
  `job_id` integer NOT NULL REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  `before_photo_id` integer NOT NULL,
  `after_photo_id` integer NOT NULL,
  `label` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL
);
