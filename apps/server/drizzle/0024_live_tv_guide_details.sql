CREATE TABLE `tv_guide_channels` (
	`source_id` text NOT NULL,
	`key` text NOT NULL,
	`names` text NOT NULL,
	`search_text` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`source_id`, `key`),
	FOREIGN KEY (`source_id`) REFERENCES `tv_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tv_guide_channels_position_idx` ON `tv_guide_channels` (`source_id`,`position`);--> statement-breakpoint
CREATE TABLE `tv_programme_images` (
	`key` text PRIMARY KEY NOT NULL,
	`path` text,
	`fetched_at` text,
	`failed_at` text
);
--> statement-breakpoint
ALTER TABLE `tv_channels` ADD `guide_channel` text;--> statement-breakpoint
ALTER TABLE `tv_channels` ADD `guide_matched` text;--> statement-breakpoint
ALTER TABLE `tv_programmes` ADD `categories` text;--> statement-breakpoint
ALTER TABLE `tv_programmes` ADD `kind` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `tv_programmes` ADD `episode_season` integer;--> statement-breakpoint
ALTER TABLE `tv_programmes` ADD `episode_number` integer;--> statement-breakpoint
ALTER TABLE `tv_programmes` ADD `episode_label` text;--> statement-breakpoint
ALTER TABLE `tv_programmes` ADD `image_url` text;--> statement-breakpoint
ALTER TABLE `tv_programmes` ADD `image_key` text;--> statement-breakpoint
CREATE INDEX `tv_programmes_image_key_idx` ON `tv_programmes` (`image_key`);