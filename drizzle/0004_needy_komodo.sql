CREATE TABLE `provider_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_provider_cache_expires` ON `provider_cache` (`expires_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`storage_key` text,
	`filename` text,
	`mime_type` text,
	`transcript` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_evidence`("id", "event_id", "type", "storage_key", "filename", "mime_type", "transcript", "sort_order", "created_at") SELECT "id", "event_id", "type", "storage_key", "filename", "mime_type", "transcript", "sort_order", "created_at" FROM `evidence`;--> statement-breakpoint
DROP TABLE `evidence`;--> statement-breakpoint
ALTER TABLE `__new_evidence` RENAME TO `evidence`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_evidence_event` ON `evidence` (`event_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `local_date` text DEFAULT '1970-01-01' NOT NULL;--> statement-breakpoint
-- One-time backfill using America/Chicago's current daylight offset. New writes
-- use the IANA timezone and therefore follow daylight-saving transitions.
UPDATE `events` SET `local_date` = date(`occurred_at`, '-5 hours') WHERE `local_date` = '1970-01-01';--> statement-breakpoint
ALTER TABLE `events` ADD `idempotency_key` text;--> statement-breakpoint
CREATE INDEX `idx_events_user_local_date` ON `events` (`user_id`,`local_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_user_idempotency` ON `events` (`user_id`,`idempotency_key`);--> statement-breakpoint
ALTER TABLE `goals` ADD `timezone` text DEFAULT 'America/Chicago' NOT NULL;--> statement-breakpoint
ALTER TABLE `logged_items` ADD `candidates` text;--> statement-breakpoint
ALTER TABLE `logged_items` ADD `resolution_tier` text;--> statement-breakpoint
ALTER TABLE `logged_items` ADD `unresolved_reason` text;--> statement-breakpoint
ALTER TABLE `logged_items` ADD `clarification_question` text;--> statement-breakpoint
ALTER TABLE `logged_items` ADD `quoted_source_text` text;
