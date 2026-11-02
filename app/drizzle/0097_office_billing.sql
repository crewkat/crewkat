-- 0097: Crewkat Office subscription billing (SimplySub steals Item 5).
-- Company-level Office plan state, driven by the SUBSCRIPTIONS Stripe
-- account webhook (the same account as Crewkat Premium — never the
-- Connect platform account). Columns live on `companies` (the Office
-- subscription is per company, not per user):
--   office_plan_state             — none / founding / active / past_due /
--                                   canceled. "founding" = an active
--                                   subscription on the $39 founding price.
--   office_founding_granted_at    — when the founding rate was granted;
--                                   the founding counter is COUNT(*) of
--                                   companies with this set (cap 100).
--   office_stripe_customer_id     — the company's customer in the
--                                   subscriptions Stripe account.
--   office_stripe_subscription_id — the company's Office subscription.
--   office_current_period_end     — subscription period end (ms epoch).
-- Enforcement is NOT in this migration: OFFICE_BILLING_ENABLED (default
-- OFF) gates it in the action layer, so these columns changing nothing
-- about behavior until Danny flips the flag.
ALTER TABLE `companies` ADD COLUMN `office_plan_state` text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE `companies` ADD COLUMN `office_founding_granted_at` integer;
--> statement-breakpoint
ALTER TABLE `companies` ADD COLUMN `office_stripe_customer_id` text;
--> statement-breakpoint
ALTER TABLE `companies` ADD COLUMN `office_stripe_subscription_id` text;
--> statement-breakpoint
ALTER TABLE `companies` ADD COLUMN `office_current_period_end` integer;
