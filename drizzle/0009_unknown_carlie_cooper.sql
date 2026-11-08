CREATE TABLE `notes` (
	`board_id` text PRIMARY KEY NOT NULL,
	`document` text DEFAULT '[]' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
--
-- Sync triggers for the note document. The update trigger keeps only the
-- newest pending snapshot: autosaving a note on every debounce should never
-- grow sync_changes without bound (the same guard the whiteboard triggers
-- use). All triggers are gated on sync_state.applying = 0 so remote applies
-- never echo back.
--
CREATE TRIGGER IF NOT EXISTS `sync_notes_insert` AFTER INSERT ON `notes`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('note', new.`board_id`, 0, json_object('id', new.`board_id`, 'board_id', new.`board_id`, 'document', new.`document`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_notes_update` AFTER UPDATE ON `notes`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  DELETE FROM `sync_changes`
  WHERE `entity_type` = 'note' AND `entity_id` = new.`board_id` AND `deleted` = 0;
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('note', new.`board_id`, 0, json_object('id', new.`board_id`, 'board_id', new.`board_id`, 'document', new.`document`, 'updated_at', new.`updated_at`), coalesce(new.`updated_at`, unixepoch() * 1000));
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_notes_delete` AFTER DELETE ON `notes`
WHEN (SELECT coalesce(`applying`, 0) FROM `sync_state` WHERE `id` = 1) = 0
BEGIN
  INSERT INTO `sync_changes` (`entity_type`, `entity_id`, `deleted`, `data`, `updated_at`)
  VALUES ('note', old.`board_id`, 1, json_object('id', old.`board_id`, 'board_id', old.`board_id`, 'document', old.`document`, 'updated_at', old.`updated_at`), unixepoch() * 1000);
END;
