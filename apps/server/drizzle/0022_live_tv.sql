CREATE TABLE `tv_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`search_name` text NOT NULL,
	`number` integer,
	`group_id` text NOT NULL,
	`position` integer NOT NULL,
	`upstream` text NOT NULL,
	`guide_key` text,
	`logo_url` text,
	`logo_path` text,
	`logo_fetched_url` text,
	`logo_fetched_at` text,
	`logo_failed_at` text,
	`enabled` integer DEFAULT false NOT NULL,
	`missing_since` text,
	`probe` text,
	`probed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `tv_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `tv_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tv_channels_source_key_idx` ON `tv_channels` (`source_id`,`key`);--> statement-breakpoint
CREATE INDEX `tv_channels_source_position_idx` ON `tv_channels` (`source_id`,`position`);--> statement-breakpoint
CREATE INDEX `tv_channels_group_idx` ON `tv_channels` (`group_id`);--> statement-breakpoint
CREATE INDEX `tv_channels_enabled_idx` ON `tv_channels` (`enabled`,`missing_since`);--> statement-breakpoint
CREATE TABLE `tv_favorites` (
	`profile_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `channel_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `tv_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tv_favorites_channel_idx` ON `tv_favorites` (`channel_id`);--> statement-breakpoint
CREATE TABLE `tv_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `tv_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tv_groups_source_name_idx` ON `tv_groups` (`source_id`,`name`);--> statement-breakpoint
CREATE TABLE `tv_programmes` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`description` text,
	`category` text,
	FOREIGN KEY (`channel_id`) REFERENCES `tv_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tv_programmes_channel_end_idx` ON `tv_programmes` (`channel_id`,`end_at`);--> statement-breakpoint
CREATE TABLE `tv_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`settings` text NOT NULL,
	`max_connections` integer,
	`discovered_guide_url` text,
	`created_at` text NOT NULL,
	`last_attempt_at` text,
	`last_refresh_at` text,
	`last_error` text,
	`failure_count` integer DEFAULT 0 NOT NULL
);
