CREATE TABLE `sync_entity_revisions` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_id`)
);
