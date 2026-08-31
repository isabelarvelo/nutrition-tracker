CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`meal_type` text NOT NULL,
	`status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_user_time` ON `events` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`storage_key` text,
	`filename` text,
	`mime_type` text,
	`transcript` text,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_event` ON `evidence` (`event_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`user_id` text PRIMARY KEY NOT NULL,
	`calories` real NOT NULL,
	`protein` real NOT NULL,
	`carbs` real NOT NULL,
	`fat` real NOT NULL,
	`fiber` real NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`alias` text DEFAULT '' NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`calories` real NOT NULL,
	`protein` real NOT NULL,
	`carbs` real NOT NULL,
	`fat` real NOT NULL,
	`fiber` real NOT NULL,
	`iron` real,
	`calcium` real,
	`vitamin_c` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_library_user` ON `library_items` (`user_id`);--> statement-breakpoint
CREATE TABLE `logged_items` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`calories` real NOT NULL,
	`protein` real NOT NULL,
	`carbs` real NOT NULL,
	`fat` real NOT NULL,
	`fiber` real NOT NULL,
	`iron` real,
	`calcium` real,
	`vitamin_c` real,
	`source` text NOT NULL,
	`confidence` real NOT NULL,
	`completeness` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_logged_items_event` ON `logged_items` (`event_id`);