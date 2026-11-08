CREATE TABLE `image_cache` (
	`board_id` text NOT NULL,
	`file_id` text NOT NULL,
	`remote_image_id` text,
	`content_type` text DEFAULT 'image/png' NOT NULL,
	`byte_size` integer DEFAULT 0 NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`board_id`, `file_id`),
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `image_cache_board_idx` ON `image_cache` (`board_id`);