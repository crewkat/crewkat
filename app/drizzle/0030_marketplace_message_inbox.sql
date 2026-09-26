ALTER TABLE marketplace_messages ADD COLUMN sender TEXT NOT NULL DEFAULT 'me';
--> statement-breakpoint
ALTER TABLE marketplace_messages ADD COLUMN read_at INTEGER;
