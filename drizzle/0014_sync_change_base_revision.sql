--
-- Capture the causal base revision of an outbox snapshot when the local edit
-- is queued. Previously the base was looked up when the batch was pushed, so a
-- pull or ack between the edit and the push could change what the edit claimed
-- to be based on. Persisting it here makes cross-device conflicts honest.
--
ALTER TABLE `sync_changes` ADD `base_revision` integer;--> statement-breakpoint
UPDATE `sync_changes`
SET `base_revision` = (
  SELECT `revision` FROM `sync_entity_revisions`
  WHERE `sync_entity_revisions`.`entity_type` = `sync_changes`.`entity_type`
    AND `sync_entity_revisions`.`entity_id` = `sync_changes`.`entity_id`
)
WHERE `base_revision` IS NULL;--> statement-breakpoint
--
-- A single trigger on the outbox (rather than editing every entity trigger)
-- fills the new column from the revision table. Explicit values, such as the
-- one written by conflict resolution, are preserved.
--
CREATE TRIGGER IF NOT EXISTS `sync_changes_capture_base`
AFTER INSERT ON `sync_changes`
WHEN NEW.`base_revision` IS NULL
BEGIN
  UPDATE `sync_changes`
  SET `base_revision` = (
    SELECT `revision` FROM `sync_entity_revisions`
    WHERE `entity_type` = NEW.`entity_type` AND `entity_id` = NEW.`entity_id`
  )
  WHERE `id` = NEW.`id` AND `base_revision` IS NULL;
END;
