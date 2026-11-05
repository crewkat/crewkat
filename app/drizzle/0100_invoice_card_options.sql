-- 0100: Per-invoice card payment controls (Danny 2026-11-05).
--   card_payments_enabled — the per-invoice Pay Now switch. Default ON:
--     every existing invoice keeps the Pay button it has today.
--   card_fee_enabled      — pass the Stripe card processing fee to the
--     client as part of this invoice's total.
--   card_fee_cents        — the computed fee (integer cents), baked into
--     the invoice `total` by the action layer on every create/update:
--     fee = round((baseCents + 30) / 0.971) - baseCents, where base is
--     the pre-fee total (Stripe card pricing 2.9% + 30c, so a card
--     payment of the full balance nets the pre-fee amount).
ALTER TABLE `invoices` ADD COLUMN `card_payments_enabled` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `card_fee_enabled` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN `card_fee_cents` integer NOT NULL DEFAULT 0;
