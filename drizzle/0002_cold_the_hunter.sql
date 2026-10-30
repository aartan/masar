CREATE TABLE `billing_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customers_user_id_unique` ON `billing_customers` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customers_stripe_customer_id_unique` ON `billing_customers` (`stripe_customer_id`);--> statement-breakpoint
CREATE INDEX `billing_customers_stripe_customer_idx` ON `billing_customers` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `pending_signups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`demo_content` integer DEFAULT false NOT NULL,
	`stripe_customer_id` text,
	`checkout_session_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_signups_email_unique` ON `pending_signups` (`email`);--> statement-breakpoint
CREATE INDEX `pending_signups_stripe_customer_idx` ON `pending_signups` (`stripe_customer_id`);--> statement-breakpoint
CREATE INDEX `pending_signups_status_idx` ON `pending_signups` (`status`);--> statement-breakpoint
CREATE TABLE `stripe_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`stripe_price_id` text,
	`status` text NOT NULL,
	`plan_name` text,
	`currency` text,
	`amount` integer,
	`interval` text,
	`current_period_end` integer,
	`trial_start` integer,
	`trial_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`canceled_at` integer,
	`stripe_created_at` integer,
	`last_synced_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe_subscription_id_unique` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_user_idx` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_customer_idx` ON `subscriptions` (`stripe_customer_id`);