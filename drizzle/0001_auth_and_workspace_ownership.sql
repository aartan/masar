-- Authentication tables (Better Auth) and workspace ownership.
--
-- This migration is intentionally safe to run before the new application code
-- is deployed. `boards.owner_id` is nullable so the currently deployed
-- single-user app can keep inserting boards during the rollout window. Those
-- new rows stay unowned (NULL) and are never exposed to a registered user.
-- Run `npm run db:claim-workspace -- --email <owner> --confirm` after the new
-- code is live to attach all legacy and unowned boards to the intended owner.

CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_unique` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
ALTER TABLE `boards` ADD `owner_id` text REFERENCES users(id) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `boards_owner_position_idx` ON `boards` (`owner_id`,`position`);--> statement-breakpoint
-- Existing data is parked behind a system account that has no password or
-- sign-in method. It is never attached to the first (or any) registrant.
INSERT INTO `users` (`id`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at`)
VALUES ('legacy-workspace', 'Legacy workspace', 'legacy-workspace@masar.invalid', 0, NULL, (unixepoch() * 1000), (unixepoch() * 1000))
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE `boards` SET `owner_id` = 'legacy-workspace' WHERE `owner_id` IS NULL;
