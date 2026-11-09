--
-- Remove the legacy board accent colour. The board snapshot triggers reference
-- the column, so they must be dropped before SQLite can remove it, then
-- recreated with payloads that only carry the current board fields.
--
DROP TRIGGER IF EXISTS `sync_boards_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_boards_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_boards_delete`;--> statement-breakpoint
ALTER TABLE `boards` DROP COLUMN `color`;--> statement-breakpoint
UPDATE `sync_changes`
SET `data` = json_remove(`data`, '$.color')
WHERE `entity_type` = 'board' AND `deleted` = 0;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_insert` AFTER INSERT ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'type', new.`type`, 'name', new.`name`, 'description', new.`description`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_update` AFTER UPDATE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'type', new.`type`, 'name', new.`name`, 'description', new.`description`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_delete` AFTER DELETE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', old.`id`, 1, json_object('id', old.`id`, 'owner_id', old.`owner_id`, 'project_id', old.`project_id`, 'type', old.`type`, 'name', old.`name`, 'description', old.`description`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;
