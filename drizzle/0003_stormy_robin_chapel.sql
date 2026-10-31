CREATE TABLE `sync_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_changes_entity_idx` ON `sync_changes` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`remote_user_id` text,
	`last_revision` integer DEFAULT 0 NOT NULL,
	`last_synced_at` integer,
	`bootstrapped` integer DEFAULT false NOT NULL,
	`applying` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE `comments` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `labels` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `subtasks` ADD `updated_at` integer;--> statement-breakpoint
UPDATE `comments` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `labels` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
UPDATE `subtasks` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_insert` AFTER INSERT ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'name', new.`name`, 'description', new.`description`, 'color', new.`color`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_update` AFTER UPDATE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'name', new.`name`, 'description', new.`description`, 'color', new.`color`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_delete` AFTER DELETE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', old.`id`, 1, json_object('id', old.`id`, 'owner_id', old.`owner_id`, 'name', old.`name`, 'description', old.`description`, 'color', old.`color`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_columns_insert` AFTER INSERT ON `columns`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('column', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'name', new.`name`, 'position', new.`position`, 'is_done', new.`is_done`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_columns_update` AFTER UPDATE ON `columns`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('column', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'name', new.`name`, 'position', new.`position`, 'is_done', new.`is_done`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_columns_delete` AFTER DELETE ON `columns`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('column', old.`id`, 1, json_object('id', old.`id`, 'board_id', old.`board_id`, 'name', old.`name`, 'position', old.`position`, 'is_done', old.`is_done`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_tasks_insert` AFTER INSERT ON `tasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'column_id', new.`column_id`, 'title', new.`title`, 'description', new.`description`, 'priority', new.`priority`, 'due_date', new.`due_date`, 'assignee', new.`assignee`, 'position', new.`position`, 'completed_at', new.`completed_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_tasks_update` AFTER UPDATE ON `tasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'column_id', new.`column_id`, 'title', new.`title`, 'description', new.`description`, 'priority', new.`priority`, 'due_date', new.`due_date`, 'assignee', new.`assignee`, 'position', new.`position`, 'completed_at', new.`completed_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_tasks_delete` AFTER DELETE ON `tasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task', old.`id`, 1, json_object('id', old.`id`, 'board_id', old.`board_id`, 'column_id', old.`column_id`, 'title', old.`title`, 'description', old.`description`, 'priority', old.`priority`, 'due_date', old.`due_date`, 'assignee', old.`assignee`, 'position', old.`position`, 'completed_at', old.`completed_at`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_labels_insert` AFTER INSERT ON `labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('label', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'name', new.`name`, 'color', new.`color`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_labels_update` AFTER UPDATE ON `labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('label', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'name', new.`name`, 'color', new.`color`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_labels_delete` AFTER DELETE ON `labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('label', old.`id`, 1, json_object('id', old.`id`, 'board_id', old.`board_id`, 'name', old.`name`, 'color', old.`color`, 'created_at', old.`created_at`, 'updated_at', coalesce(old.`updated_at`, old.`created_at`)), unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_task_labels_insert` AFTER INSERT ON `task_labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task_label', new.`task_id` || ':' || new.`label_id`, 0, json_object('task_id', new.`task_id`, 'label_id', new.`label_id`), unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_task_labels_delete` AFTER DELETE ON `task_labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task_label', old.`task_id` || ':' || old.`label_id`, 1, json_object('task_id', old.`task_id`, 'label_id', old.`label_id`), unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_subtasks_insert` AFTER INSERT ON `subtasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('subtask', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'title', new.`title`, 'completed', new.`completed`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_subtasks_update` AFTER UPDATE ON `subtasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('subtask', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'title', new.`title`, 'completed', new.`completed`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_subtasks_delete` AFTER DELETE ON `subtasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('subtask', old.`id`, 1, json_object('id', old.`id`, 'task_id', old.`task_id`, 'title', old.`title`, 'completed', old.`completed`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', coalesce(old.`updated_at`, old.`created_at`)), unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_comments_insert` AFTER INSERT ON `comments`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('comment', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'author', new.`author`, 'body', new.`body`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_comments_update` AFTER UPDATE ON `comments`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('comment', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'author', new.`author`, 'body', new.`body`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_comments_delete` AFTER DELETE ON `comments`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('comment', old.`id`, 1, json_object('id', old.`id`, 'task_id', old.`task_id`, 'author', old.`author`, 'body', old.`body`, 'created_at', old.`created_at`, 'updated_at', coalesce(old.`updated_at`, old.`created_at`)), unixepoch() * 1000);
END;
