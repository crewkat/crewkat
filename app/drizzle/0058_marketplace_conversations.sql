-- Marketplace private conversations.
--
-- Previously every message on a listing shared one thread keyed by listing_id,
-- so an owner's reply to inquirer A was visible to inquirer B, and the
-- per-message read_at leaked read state across parties. Conversations are now
-- one row per (listing, inquirer company); messages point at their
-- conversation. Read state is per-participant (inquirer_read_at /
-- owner_read_at on the conversation) and is never exposed to the other party.
CREATE TABLE `marketplace_conversations` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `listing_id` INTEGER NOT NULL,
  `owner_company_id` INTEGER NOT NULL,
  `inquirer_company_id` INTEGER NOT NULL,
  `inquirer_read_at` INTEGER,
  `owner_read_at` INTEGER,
  `last_message_at` INTEGER NOT NULL,
  `created_at` INTEGER NOT NULL,
  FOREIGN KEY (`listing_id`) REFERENCES `marketplace_listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketplace_conversations_listing_inquirer_unique` ON `marketplace_conversations` (`listing_id`, `inquirer_company_id`);
--> statement-breakpoint
CREATE INDEX `marketplace_conversations_listing_idx` ON `marketplace_conversations` (`listing_id`);
--> statement-breakpoint
ALTER TABLE `marketplace_messages` ADD COLUMN `conversation_id` INTEGER REFERENCES `marketplace_conversations`(`id`) ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `marketplace_messages_conversation_idx` ON `marketplace_messages` (`conversation_id`);
--> statement-breakpoint
-- Data migration heuristic:
-- 1. One conversation per (listing_id, sender_company_id) built from the
--    existing inquirer messages (sender = 'other'). The listing's company is
--    the owner side of the conversation.
-- 2. Those inquirer messages are backfilled to their conversation.
-- 3. Owner messages (sender = 'me') attach to the most recently active
--    conversation on the same listing. The old schema cannot attribute an
--    owner reply to a specific inquirer, so recency is the best available
--    signal; owner messages on listings with no inquirer conversation keep
--    conversation_id NULL rather than guessing wrong.
INSERT INTO `marketplace_conversations` (`listing_id`, `owner_company_id`, `inquirer_company_id`, `last_message_at`, `created_at`)
SELECT m.`listing_id`, l.`company_id`, m.`sender_company_id`, MAX(m.`created_at`), MIN(m.`created_at`)
FROM `marketplace_messages` m
JOIN `marketplace_listings` l ON l.`id` = m.`listing_id`
WHERE m.`sender` = 'other' AND m.`sender_company_id` IS NOT NULL
GROUP BY m.`listing_id`, m.`sender_company_id`;
--> statement-breakpoint
UPDATE `marketplace_messages`
SET `conversation_id` = (
  SELECT c.`id` FROM `marketplace_conversations` c
  WHERE c.`listing_id` = `marketplace_messages`.`listing_id`
    AND c.`inquirer_company_id` = `marketplace_messages`.`sender_company_id`
)
WHERE `sender` = 'other' AND `sender_company_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `marketplace_messages`
SET `conversation_id` = (
  SELECT c.`id` FROM `marketplace_conversations` c
  WHERE c.`listing_id` = `marketplace_messages`.`listing_id`
  ORDER BY c.`last_message_at` DESC
  LIMIT 1
)
WHERE `sender` = 'me' AND `conversation_id` IS NULL;
