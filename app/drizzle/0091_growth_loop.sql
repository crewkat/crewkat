-- 0091: Growth loop — client-link attribution. Records which client-link
-- surface (estimate / invoice / contract / changeorder / portal /
-- receipt / photo) brought a new signup, and counts landing clicks
-- from those links.
--
-- auth_users.signup_source: nullable, no default — the loop surface
-- captured at signup (signUp / googleSignIn signupSource arg); NULL
-- for organic / pre-0091 accounts.
ALTER TABLE `auth_users` ADD COLUMN `signup_source` text;
--> statement-breakpoint
-- growth_loop_events: one row per landing click recorded by the
-- public recordLoopLanding action.
CREATE TABLE `growth_loop_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `surface` text NOT NULL,
  `occurred_at` integer NOT NULL
);
