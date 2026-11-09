CREATE TABLE `task_images` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`url` text NOT NULL,
	`name` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_images_task_position_idx` ON `task_images` (`task_id`,`position`);--> statement-breakpoint
--
-- Sync triggers for task attachments. Each image is its own sync entity so a
-- conflict or slow upload only affects that attachment. The update trigger
-- keeps only the newest pending snapshot, matching the note/whiteboard
-- triggers. All triggers are gated on sync_state.applying = 0 so remote
-- applies never echo back.
--
CREATE TRIGGER IF NOT EXISTS `sync_task_images_insert` AFTER INSERT ON `task_images`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task_image', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'url', new.`url`, 'name', new.`name`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_task_images_update` AFTER UPDATE ON `task_images`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  DELETE FROM `sync_changes`
  WHERE `entity_type` = 'task_image' AND `entity_id` = new.`id` AND `deleted` = 0;
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task_image', new.`id`, 0, json_object('id', new.`id`, 'task_id', new.`task_id`, 'url', new.`url`, 'name', new.`name`, 'position', new.`position`, 'created_at', new.`created_at`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_task_images_delete` AFTER DELETE ON `task_images`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('task_image', old.`id`, 1, json_object('id', old.`id`, 'task_id', old.`task_id`, 'url', old.`url`, 'name', old.`name`, 'position', old.`position`, 'created_at', old.`created_at`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;