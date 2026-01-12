CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text DEFAULT 'sage' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `boards_position_idx` ON `boards` (`position`);--> statement-breakpoint
CREATE TABLE `columns` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_done` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `columns_board_idx` ON `columns` (`board_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `columns_board_name_unique` ON `columns` (`board_id`,`name`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author` text DEFAULT 'You' NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_task_idx` ON `comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `labels_board_idx` ON `labels` (`board_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `labels_board_name_unique` ON `labels` (`board_id`,`name`);--> statement-breakpoint
CREATE TABLE `subtasks` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtasks_task_idx` ON `subtasks` (`task_id`,`position`);--> statement-breakpoint
CREATE TABLE `task_labels` (
	`task_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `label_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_labels_label_idx` ON `task_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`column_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`priority` text DEFAULT 'none' NOT NULL,
	`due_date` text,
	`assignee` text,
	`position` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`column_id`) REFERENCES `columns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_board_idx` ON `tasks` (`board_id`);--> statement-breakpoint
CREATE INDEX `tasks_column_position_idx` ON `tasks` (`column_id`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_due_date_idx` ON `tasks` (`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_priority_idx` ON `tasks` (`priority`);