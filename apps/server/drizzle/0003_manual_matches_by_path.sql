CREATE TABLE `manual_matches` (
	`library_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`signature` text,
	`source_id` text,
	`tmdb_id` integer NOT NULL,
	`kind` text NOT NULL,
	`season_number` integer,
	`episode_number` integer,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`library_id`, `relative_path`),
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `manual_matches_signature_idx` ON `manual_matches` (`signature`);--> statement-breakpoint
CREATE INDEX `manual_matches_source_id_idx` ON `manual_matches` (`source_id`);--> statement-breakpoint
ALTER TABLE `items` ADD `last_air_date` text;