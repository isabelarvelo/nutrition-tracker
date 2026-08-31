ALTER TABLE `library_items` ADD `serving_grams` real;--> statement-breakpoint
ALTER TABLE `library_items` ADD `servings_per_cooked_cup` real;--> statement-breakpoint
ALTER TABLE `library_items` ADD `source_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_items` ADD `source_url` text DEFAULT '' NOT NULL;