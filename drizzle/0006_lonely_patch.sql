CREATE TABLE `sync_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`local_data` text DEFAULT '{}' NOT NULL,
	`local_deleted` integer DEFAULT false NOT NULL,
	`local_updated_at` integer NOT NULL,
	`cloud_data` text DEFAULT '{}' NOT NULL,
	`cloud_deleted` integer DEFAULT false NOT NULL,
	`cloud_updated_at` integer NOT NULL,
	`winning_revision` integer NOT NULL,
	`project_id` text,
	`project_name` text,
	`board_id` text,
	`board_name` text,
	`entity_label` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_conflicts_entity_idx` ON `sync_conflicts` (`entity_type`,`entity_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`project_id` text,
	`type` text DEFAULT 'kanban' NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text DEFAULT 'sage' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_boards`("id", "owner_id", "project_id", "type", "name", "description", "color", "position", "created_at", "updated_at") SELECT "id", "owner_id", "project_id", "type", "name", "description", "color", "position", "created_at", "updated_at" FROM `boards`;--> statement-breakpoint
DROP TABLE `boards`;--> statement-breakpoint
ALTER TABLE `__new_boards` RENAME TO `boards`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `boards_position_idx` ON `boards` (`position`);--> statement-breakpoint
CREATE INDEX `boards_owner_position_idx` ON `boards` (`owner_id`,`position`);--> statement-breakpoint
CREATE INDEX `boards_project_position_idx` ON `boards` (`project_id`,`position`);--> statement-breakpoint
ALTER TABLE `projects` ADD `description` text;
--> statement-breakpoint
--
-- The boards table was rebuilt to change the project FK action. SQLite drops
-- table triggers during a table rebuild, so recreate the board snapshot
-- triggers here.
--
CREATE TRIGGER IF NOT EXISTS `sync_boards_insert` AFTER INSERT ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'type', new.`type`, 'name', new.`name`, 'description', new.`description`, 'color', new.`color`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_update` AFTER UPDATE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'type', new.`type`, 'name', new.`name`, 'description', new.`description`, 'color', new.`color`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_delete` AFTER DELETE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', old.`id`, 1, json_object('id', old.`id`, 'owner_id', old.`owner_id`, 'project_id', old.`project_id`, 'type', old.`type`, 'name', old.`name`, 'description', old.`description`, 'color', old.`color`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;
--> statement-breakpoint
--
-- Keep only the newest pending whiteboard snapshot. Saving a large scene on
-- every debounce should never grow sync_changes without bound.
--
DROP TRIGGER IF EXISTS `sync_whiteboards_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_whiteboards_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_whiteboards_delete`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_whiteboards_insert` AFTER INSERT ON `whiteboards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('whiteboard', new.`board_id`, 0, json_object('id', new.`board_id`, 'board_id', new.`board_id`, 'scene', new.`scene`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_whiteboards_update` AFTER UPDATE ON `whiteboards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  DELETE FROM `sync_changes`
  WHERE `entity_type` = 'whiteboard' AND `entity_id` = new.`board_id` AND `deleted` = 0;
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('whiteboard', new.`board_id`, 0, json_object('id', new.`board_id`, 'board_id', new.`board_id`, 'scene', new.`scene`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_whiteboards_delete` AFTER DELETE ON `whiteboards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('whiteboard', old.`board_id`, 1, json_object('id', old.`board_id`, 'board_id', old.`board_id`, 'scene', old.`scene`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;

--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_projects_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_projects_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_projects_delete`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_projects_insert` AFTER INSERT ON `projects`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('project', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'name', new.`name`, 'description', new.`description`, 'position', new.`position`, 'archived', new.`archived`, 'archived_at', new.`archived_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_projects_update` AFTER UPDATE ON `projects`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('project', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'name', new.`name`, 'description', new.`description`, 'position', new.`position`, 'archived', new.`archived`, 'archived_at', new.`archived_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_projects_delete` AFTER DELETE ON `projects`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('project', old.`id`, 1, json_object('id', old.`id`, 'owner_id', old.`owner_id`, 'name', old.`name`, 'description', old.`description`, 'position', old.`position`, 'archived', old.`archived`, 'archived_at', old.`archived_at`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;
