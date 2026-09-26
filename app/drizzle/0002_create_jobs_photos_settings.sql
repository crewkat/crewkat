CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  job_address TEXT NOT NULL,
  job_type TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  job_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('before', 'during', 'after')),
  caption TEXT NOT NULL DEFAULT '',
  blob_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX photos_job_id_idx ON photos(job_id);
--> statement-breakpoint
CREATE TABLE settings (
  id INTEGER PRIMARY KEY,
  company_name TEXT NOT NULL,
  license_number TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en', 'es')),
  updated_at INTEGER NOT NULL
);
