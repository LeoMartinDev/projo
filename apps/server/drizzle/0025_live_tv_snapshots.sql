ALTER TABLE `tv_channels` ADD `snapshot_at` text;--> statement-breakpoint
ALTER TABLE `tv_channels` ADD `snapshot_attempt_at` text;--> statement-breakpoint
ALTER TABLE `tv_channels` ADD `snapshot_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tv_channels` ADD `watched_at` text;--> statement-breakpoint
ALTER TABLE `tv_sources` ADD `snapshots` integer;--> statement-breakpoint
ALTER TABLE `tv_sources` ADD `snapshot_grabs_per_hour` integer;