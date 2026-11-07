CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_owner_position_idx` ON `projects` (`owner_id`,`position`);--> statement-breakpoint
CREATE TABLE `whiteboards` (
	`board_id` text PRIMARY KEY NOT NULL,
	`scene` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `boards` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
ALTER TABLE `boards` ADD `type` text DEFAULT 'kanban' NOT NULL;--> statement-breakpoint
CREATE INDEX `boards_project_position_idx` ON `boards` (`project_id`,`position`);--> statement-breakpoint
--
-- Sync triggers for the new entities and the extended board snapshot. Created
-- BEFORE the data backfill below so the backfill's writes are captured in the
-- outbox on sync mirrors. All triggers are gated on sync_state.applying = 0 so
-- remote applies never echo back; on a pure local workspace there is no
-- sync_state row, coalesce(NULL,0)=0, so the guard passes and rows queue
-- harmlessly (they are never pushed without an account).
--
CREATE TRIGGER IF NOT EXISTS `sync_projects_insert` AFTER INSERT ON `projects`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('project', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'name', new.`name`, 'position', new.`position`, 'archived', new.`archived`, 'archived_at', new.`archived_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_projects_update` AFTER UPDATE ON `projects`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('project', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'name', new.`name`, 'position', new.`position`, 'archived', new.`archived`, 'archived_at', new.`archived_at`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_projects_delete` AFTER DELETE ON `projects`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('project', old.`id`, 1, json_object('id', old.`id`, 'owner_id', old.`owner_id`, 'name', old.`name`, 'position', old.`position`, 'archived', old.`archived`, 'archived_at', old.`archived_at`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_whiteboards_insert` AFTER INSERT ON `whiteboards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('whiteboard', new.`board_id`, 0, json_object('id', new.`board_id`, 'board_id', new.`board_id`, 'scene', new.`scene`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_whiteboards_update` AFTER UPDATE ON `whiteboards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('whiteboard', new.`board_id`, 0, json_object('id', new.`board_id`, 'board_id', new.`board_id`, 'scene', new.`scene`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_whiteboards_delete` AFTER DELETE ON `whiteboards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('whiteboard', old.`board_id`, 1, json_object('id', old.`board_id`, 'board_id', old.`board_id`, 'scene', old.`scene`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;--> statement-breakpoint
--
-- Replace the board triggers so project_id and type are part of the synced
-- snapshot (older clients ignore the extra keys; the server schema passes them
-- through).
--
DROP TRIGGER IF EXISTS `sync_boards_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_boards_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `sync_boards_delete`;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_insert` AFTER INSERT ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'type', new.`type`, 'name', new.`name`, 'description', new.`description`, 'color', new.`color`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_update` AFTER UPDATE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', new.`id`, 0, json_object('id', new.`id`, 'owner_id', new.`owner_id`, 'project_id', new.`project_id`, 'type', new.`type`, 'name', new.`name`, 'description', new.`description`, 'color', new.`color`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_boards_delete` AFTER DELETE ON `boards`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('board', old.`id`, 1, json_object('id', old.`id`, 'owner_id', old.`owner_id`, 'project_id', old.`project_id`, 'type', old.`type`, 'name', old.`name`, 'description', old.`description`, 'color', old.`color`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;--> statement-breakpoint
--
-- Data backfill: create one default "General" project per distinct board owner
-- (deterministic id so re-running is a no-op) and assign that owner's boards to
-- it. Boards with a NULL owner are left unscoped for the legacy claim command,
-- exactly as their owner_id is. Idempotent: INSERT OR IGNORE + the UPDATE only
-- touches boards whose project_id is still NULL.
--
INSERT OR IGNORE INTO `projects` (`id`, `owner_id`, `name`, `position`, `archived`, `created_at`, `updated_at`)
SELECT 'default-project-' || `owner_id`, `owner_id`, 'General', 0, 0, unixepoch() * 1000, unixepoch() * 1000
FROM `boards`
WHERE `owner_id` IS NOT NULL
GROUP BY `owner_id`;--> statement-breakpoint
UPDATE `boards`
SET `project_id` = 'default-project-' || `owner_id`
WHERE `owner_id` IS NOT NULL AND `project_id` IS NULL;