-- Phase 4: Google Play Billing for Crewkat Premium (TWA, package com.crewkat.app).
-- Links a Play-billing purchase to the Crewkat account that bought it and keeps
-- an auditable, idempotent record of every verified Play purchase.
ALTER TABLE `auth_users` ADD `play_purchase_token` text;
--> statement-breakpoint
ALTER TABLE `auth_users` ADD `play_order_id` text;
--> statement-breakpoint
CREATE TABLE `play_billing_purchases` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` INTEGER NOT NULL REFERENCES `auth_users`(`id`) ON DELETE CASCADE,
  `purchase_token` TEXT NOT NULL,
  `order_id` TEXT,
  `sku` TEXT NOT NULL,
  `verified_at` INTEGER NOT NULL,
  `created_at` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `play_billing_purchases_token_unique` ON `play_billing_purchases` (`purchase_token`);
