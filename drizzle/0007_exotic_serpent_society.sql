CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`kind` text DEFAULT 'general' NOT NULL,
	`content_type` text DEFAULT 'image/webp' NOT NULL,
	`byte_size` integer DEFAULT 0 NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`thumb_byte_size` integer DEFAULT 0 NOT NULL,
	`thumb_width` integer DEFAULT 0 NOT NULL,
	`thumb_height` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `images_board_idx` ON `images` (`board_id`);