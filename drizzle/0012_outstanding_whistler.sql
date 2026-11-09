--
-- Add optional T-shirt-size complexity estimates to tasks. The sync triggers
-- are recreated with the new field so local task changes queue the estimate
-- alongside the rest of the task payload.
--
ALTER TABLE `tasks` ADD `complexity` text;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_tasks_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_tasks_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_tasks_delete`;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_tasks_insert` AFTER INSERT ON `tasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'column_id', new.`column_id`, 'title', new.`title`, 'description', new.`description`, 'priority', new.`priority`, 'complexity', new.`complexity`, 'due_date', new.`due_date`, 'assignee', new.`assignee`, 'position', new.`position`, 'completed_at', new.`completed_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_tasks_update` AFTER UPDATE ON `tasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task', new.`id`, 0, json_object('id', new.`id`, 'board_id', new.`board_id`, 'column_id', new.`column_id`, 'title', new.`title`, 'description', new.`description`, 'priority', new.`priority`, 'complexity', new.`complexity`, 'due_date', new.`due_date`, 'assignee', new.`assignee`, 'position', new.`position`, 'completed_at', new.`completed_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_tasks_delete` AFTER DELETE ON `tasks`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task', old.`id`, 1, json_object('id', old.`id`, 'board_id', old.`board_id`, 'column_id', old.`column_id`, 'title', old.`title`, 'description', old.`description`, 'priority', old.`priority`, 'complexity', old.`complexity`, 'due_date', old.`due_date`, 'assignee', old.`assignee`, 'position', old.`position`, 'completed_at', old.`completed_at`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;
