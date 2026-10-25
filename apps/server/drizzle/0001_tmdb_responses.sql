CREATE TABLE `tmdb_responses` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tmdb_responses_fetched_at_idx` ON `tmdb_responses` (`fetched_at`);