CREATE TABLE `sync_entity_state` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`base_revision` integer DEFAULT -1 NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_id`)
);
--> statement-breakpoint
ALTER TABLE `sync_changes` ADD `base_revision` integer;--> statement-breakpoint
-- Existing entities predate causality tracking. Mark them with the legacy
-- base (-1) so the first edits after this upgrade are resolved by arrival
-- order instead of being rejected as concurrent edits with an unknown base.
INSERT INTO `sync_entity_state` (`entity_type`, `entity_id`, `base_revision`)
  SELECT 'board', `id`, -1 FROM `boards`;
--> statement-breakpoint
INSERT INTO `sync_entity_state` (`entity_type`, `entity_id`, `base_revision`)
  SELECT 'column', `id`, -1 FROM `columns`;
--> statement-breakpoint
INSERT INTO `sync_entity_state` (`entity_type`, `entity_id`, `base_revision`)
  SELECT 'label', `id`, -1 FROM `labels`;
--> statement-breakpoint
INSERT INTO `sync_entity_state` (`entity_type`, `entity_id`, `base_revision`)
  SELECT 'task', `id`, -1 FROM `tasks`;
--> statement-breakpoint
INSERT INTO `sync_entity_state` (`entity_type`, `entity_id`, `base_revision`)
  SELECT 'task_label', `task_id` || ':' || `label_id`, -1 FROM `task_labels`;
--> statement-breakpoint
INSERT INTO `sync_entity_state` (`entity_type`, `entity_id`, `base_revision`)
  SELECT 'subtask', `id`, -1 FROM `subtasks`;
--> statement-breakpoint
INSERT INTO `sync_entity_state` (`entity_type`, `entity_id`, `base_revision`)
  SELECT 'comment', `id`, -1 FROM `comments`;
--> statement-breakpoint
-- Recreate the outbox triggers so every queued change records the base
-- revision the edit was made on top of (NULL for brand-new local entities).
DROP TRIGGER IF EXISTS `sync_boards_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_boards_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_boards_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_columns_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_columns_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_columns_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_tasks_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_tasks_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_tasks_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_labels_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_labels_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_labels_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_task_labels_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_task_labels_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_subtasks_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_subtasks_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_subtasks_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_comments_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_comments_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_comments_delete`;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_insert` AFTER INSERT ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'name', new.`name`, 'description', new.`description`, 'color', new.`color`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'board' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_update` AFTER UPDATE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'name', new.`name`, 'description', new.`description`, 'color', new.`color`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'board' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_delete` AFTER DELETE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('board', old.`id`, 1, json_object('id', old.`id`, 'owner_id', old.`owner_id`, 'name', old.`name`, 'description', old.`description`, 'color', old.`color`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000, (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'board' AND `entity_id` = old.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_columns_insert` AFTER INSERT ON `columns`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('column', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'name', new.`name`, 'position', new.`position`, 'is_done', new.`is_done`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'column' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_columns_update` AFTER UPDATE ON `columns`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('column', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'name', new.`name`, 'position', new.`position`, 'is_done', new.`is_done`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'column' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_columns_delete` AFTER DELETE ON `columns`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('column', old.`id`, 1, json_object('id', old.`id`, 'board_id', old.`board_id`, 'name', old.`name`, 'position', old.`position`, 'is_done', old.`is_done`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000, (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'column' AND `entity_id` = old.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_tasks_insert` AFTER INSERT ON `tasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('task', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'column_id', new.`column_id`, 'title', new.`title`, 'description', new.`description`, 'priority', new.`priority`, 'due_date', new.`due_date`, 'assignee', new.`assignee`, 'position', new.`position`, 'completed_at', new.`completed_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'task' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_tasks_update` AFTER UPDATE ON `tasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('task', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'column_id', new.`column_id`, 'title', new.`title`, 'description', new.`description`, 'priority', new.`priority`, 'due_date', new.`due_date`, 'assignee', new.`assignee`, 'position', new.`position`, 'completed_at', new.`completed_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'task' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_tasks_delete` AFTER DELETE ON `tasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('task', old.`id`, 1, json_object('id', old.`id`, 'board_id', old.`board_id`, 'column_id', old.`column_id`, 'title', old.`title`, 'description', old.`description`, 'priority', old.`priority`, 'due_date', old.`due_date`, 'assignee', old.`assignee`, 'position', old.`position`, 'completed_at', old.`completed_at`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000, (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'task' AND `entity_id` = old.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_labels_insert` AFTER INSERT ON `labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('label', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'name', new.`name`, 'color', new.`color`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'label' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_labels_update` AFTER UPDATE ON `labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('label', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'name', new.`name`, 'color', new.`color`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'label' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_labels_delete` AFTER DELETE ON `labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('label', old.`id`, 1, json_object('id', old.`id`, 'board_id', old.`board_id`, 'name', old.`name`, 'color', old.`color`, 'created_at', old.`created_at`, 'updated_at', coalesce(old.`updated_at`, old.`created_at`)), unixepoch() * 1000, (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'label' AND `entity_id` = old.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_task_labels_insert` AFTER INSERT ON `task_labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('task_label', new.`task_id` || ':' || new.`label_id`, 0, json_object('task_id', new.`task_id`, 'label_id', new.`label_id`), unixepoch() * 1000, (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'task_label' AND `entity_id` = new.`task_id` || ':' || new.`label_id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_task_labels_delete` AFTER DELETE ON `task_labels`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('task_label', old.`task_id` || ':' || old.`label_id`, 1, json_object('task_id', old.`task_id`, 'label_id', old.`label_id`), unixepoch() * 1000, (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'task_label' AND `entity_id` = old.`task_id` || ':' || old.`label_id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_subtasks_insert` AFTER INSERT ON `subtasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('subtask', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'title', new.`title`, 'completed', new.`completed`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'subtask' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_subtasks_update` AFTER UPDATE ON `subtasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('subtask', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'title', new.`title`, 'completed', new.`completed`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'subtask' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_subtasks_delete` AFTER DELETE ON `subtasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('subtask', old.`id`, 1, json_object('id', old.`id`, 'task_id', old.`task_id`, 'title', old.`title`, 'completed', old.`completed`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', coalesce(old.`updated_at`, old.`created_at`)), unixepoch() * 1000, (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'subtask' AND `entity_id` = old.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_comments_insert` AFTER INSERT ON `comments`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('comment', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'author', new.`author`, 'body', new.`body`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'comment' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_comments_update` AFTER UPDATE ON `comments`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('comment', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'author', new.`author`, 'body', new.`body`, 'created_at', new.`created_at`, 'updated_at', coalesce(new.`updated_at`, new.`created_at`)), coalesce(new.`updated_at`, new.`created_at`, unixepoch() * 1000), (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'comment' AND `entity_id` = new.`id`));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_comments_delete` AFTER DELETE ON `comments`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`, `base_revision`)
  VALUES ('comment', old.`id`, 1, json_object('id', old.`id`, 'task_id', old.`task_id`, 'author', old.`author`, 'body', old.`body`, 'created_at', old.`created_at`, 'updated_at', coalesce(old.`updated_at`, old.`created_at`)), unixepoch() * 1000, (SELECT `base_revision` FROM `sync_entity_state` WHERE `entity_type` = 'comment' AND `entity_id` = old.`id`));
END;