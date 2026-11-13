--
-- Optional recursive folders inside projects. Spaces keep their existing
-- project/position columns and gain a nullable folder_id; a NULL folder means
-- the space lives directly in the project root. Existing boards are untouched
-- and remain root-level spaces.
--
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`project_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `folders_project_parent_position_idx` ON `folders` (`project_id`,`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `folders_owner_parent_position_idx` ON `folders` (`owner_id`,`parent_id`,`position`);--> statement-breakpoint
ALTER TABLE `boards` ADD `folder_id` text REFERENCES folders(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `boards_folder_position_idx` ON `boards` (`folder_id`,`position`);--> statement-breakpoint
--
-- Folder changes need their own outbox rows so folder structure and names
-- synchronise like every other entity. parent_id is part of the snapshot so a
-- folder can be re-parented without rewriting its descendants.
--
CREATE TRIGGER IF NOT EXISTS `sync_folders_insert` AFTER INSERT ON `folders`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('folder', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'parent_id', new.`parent_id`, 'name', new.`name`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_folders_update` AFTER UPDATE ON `folders`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('folder', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'parent_id', new.`parent_id`, 'name', new.`name`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_folders_delete` AFTER DELETE ON `folders`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('folder', old.`id`, 1, json_object('id', old.`id`, 'owner_id', old.`owner_id`, 'project_id', old.`project_id`, 'parent_id', old.`parent_id`, 'name', old.`name`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;--> statement-breakpoint
--
-- Recreate the board snapshot triggers so folder assignments synchronise.
--
DROP TRIGGER IF EXISTS `sync_boards_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_boards_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_boards_delete`;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_insert` AFTER INSERT ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'folder_id', new.`folder_id`, 'type', new.`type`, 'name', new.`name`, 'description', new.`description`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_update` AFTER UPDATE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'folder_id', new.`folder_id`, 'type', new.`type`, 'name', new.`name`, 'description', new.`description`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_delete` AFTER DELETE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', old.`id`, 1, json_object('id', old.`id`, 'owner_id', old.`owner_id`, 'project_id', old.`project_id`, 'folder_id', old.`folder_id`, 'type', old.`type`, 'name', old.`name`, 'description', old.`description`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;
