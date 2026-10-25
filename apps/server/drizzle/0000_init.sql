CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`disabled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_ci_unique` ON `accounts` (lower("username"));--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by_account_id` text,
	FOREIGN KEY (`created_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `profile_libraries` (
	`profile_id` text NOT NULL,
	`library_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `library_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`avatar_color` text NOT NULL,
	`pin_hash` text,
	`max_content_rating` text,
	`library_access` text DEFAULT 'all' NOT NULL,
	`ui_locale` text DEFAULT 'fr' NOT NULL,
	`audio_language` text NOT NULL,
	`subtitle_language` text NOT NULL,
	`subtitle_mode` text DEFAULT 'when_audio_differs' NOT NULL,
	`anime_original_audio` integer DEFAULT false NOT NULL,
	`autoplay_next` integer DEFAULT true NOT NULL,
	`auto_skip_intro` integer DEFAULT false NOT NULL,
	`auto_skip_credits` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profiles_account_id_idx` ON `profiles` (`account_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`device_name` text NOT NULL,
	`user_agent` text NOT NULL,
	`last_profile_id` text,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_account_id_idx` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`origin` text NOT NULL,
	`tmdb_path` text,
	`local_path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`language` text
);
--> statement-breakpoint
CREATE INDEX `images_tmdb_path_idx` ON `images` (`tmdb_path`);--> statement-breakpoint
CREATE TABLE `item_manual_matches` (
	`source_id` text PRIMARY KEY NOT NULL,
	`tmdb_id` integer NOT NULL,
	`kind` text NOT NULL,
	`season_number` integer,
	`episode_number` integer,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_overrides` (
	`item_id` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`item_id`, `field`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_people` (
	`item_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	`character` text,
	`order` integer NOT NULL,
	PRIMARY KEY(`item_id`, `person_id`, `role`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_people_person_id_idx` ON `item_people` (`person_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text,
	`tmdb_id` integer,
	`imdb_id` text,
	`tvdb_id` integer,
	`title` text NOT NULL,
	`original_title` text,
	`sort_title` text NOT NULL,
	`year` integer,
	`overview` text,
	`release_date` text,
	`runtime_minutes` integer,
	`genres` text DEFAULT '[]' NOT NULL,
	`original_language` text,
	`vote_average` real,
	`content_rating` text,
	`series_status` text,
	`season_number` integer,
	`episode_number` integer,
	`air_date` text,
	`episode_count_tmdb` integer,
	`poster_image_id` text,
	`backdrop_image_id` text,
	`logo_image_id` text,
	`still_image_id` text,
	`added_at` text,
	`metadata_refreshed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`poster_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`backdrop_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`logo_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`still_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `items_parent_id_idx` ON `items` (`parent_id`);--> statement-breakpoint
CREATE INDEX `items_kind_sort_title_idx` ON `items` (`kind`,`sort_title`);--> statement-breakpoint
CREATE INDEX `items_kind_added_at_idx` ON `items` (`kind`,`added_at`);--> statement-breakpoint
CREATE INDEX `items_tmdb_id_idx` ON `items` (`kind`,`tmdb_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`tmdb_id` integer NOT NULL,
	`name` text NOT NULL,
	`profile_image_id` text,
	FOREIGN KEY (`profile_image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_tmdb_id_unique` ON `people` (`tmdb_id`);--> statement-breakpoint
CREATE TABLE `libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`hint` text DEFAULT 'auto' NOT NULL,
	`scan_interval_minutes` integer DEFAULT 15 NOT NULL,
	`watch_enabled` integer DEFAULT true NOT NULL,
	`quiet_period_seconds` integer DEFAULT 120 NOT NULL,
	`detect_segments` integer DEFAULT true NOT NULL,
	`pre_extract_subtitles` integer DEFAULT false NOT NULL,
	`trickplay_enabled` integer DEFAULT true NOT NULL,
	`metadata_language` text,
	`rating_country` text DEFAULT 'FR' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`path` text NOT NULL,
	`state` text DEFAULT 'ok' NOT NULL,
	`last_scan_at` text,
	`last_file_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_roots_library_id_idx` ON `library_roots` (`library_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `library_roots_path_unique` ON `library_roots` (`path`);--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`kind` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`stats` text DEFAULT '{}' NOT NULL,
	`error` text,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scan_runs_library_started_idx` ON `scan_runs` (`library_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `source_items` (
	`source_id` text NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`source_id`, `item_id`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_items_item_id_idx` ON `source_items` (`item_id`);--> statement-breakpoint
CREATE TABLE `source_subtitles` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text,
	`stream_index` integer,
	`language` text,
	`forced` integer DEFAULT false NOT NULL,
	`sdh` integer DEFAULT false NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`format` text NOT NULL,
	`title` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_subtitles_source_id_idx` ON `source_subtitles` (`source_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`root_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`extension` text NOT NULL,
	`state` text NOT NULL,
	`pending_reason` text,
	`size_bytes` integer NOT NULL,
	`mtime` real NOT NULL,
	`inode` text,
	`discovered_at` text NOT NULL,
	`pending_since` text,
	`unchanged_since` text,
	`stable_since` text,
	`ready_at` text,
	`missing_since` text,
	`probe` text,
	`signature` text,
	`classification` text DEFAULT 'unknown' NOT NULL,
	`parsed` text DEFAULT '{}' NOT NULL,
	`match_state` text DEFAULT 'unmatched' NOT NULL,
	`review_reason` text,
	`version_label` text,
	`stack_group_id` text,
	`part_index` integer,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_root_path_unique` ON `sources` (`root_id`,`relative_path`);--> statement-breakpoint
CREATE INDEX `sources_library_state_idx` ON `sources` (`library_id`,`state`);--> statement-breakpoint
CREATE INDEX `sources_state_idx` ON `sources` (`state`);--> statement-breakpoint
CREATE INDEX `sources_stack_group_idx` ON `sources` (`stack_group_id`);--> statement-breakpoint
CREATE TABLE `app_versions` (
	`version` text PRIMARY KEY NOT NULL,
	`installed_at` text NOT NULL,
	`state` text NOT NULL,
	`runtime_min` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`dedupe_key` text,
	`priority` integer NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`run_after` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`progress` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `jobs_state_priority_idx` ON `jobs` (`state`,`priority`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_key_idx` ON `jobs` (`dedupe_key`,`state`);--> statement-breakpoint
CREATE INDEX `jobs_finished_at_idx` ON `jobs` (`finished_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`title_key` text NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `notifications_created_at_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `playback_progress` (
	`profile_id` text NOT NULL,
	`item_id` text NOT NULL,
	`position_ms` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`watched` integer DEFAULT false NOT NULL,
	`watched_at` text,
	`play_count` integer DEFAULT 0 NOT NULL,
	`last_played_at` text NOT NULL,
	`hidden_from_continue` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`profile_id`, `item_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playback_progress_profile_last_played_idx` ON `playback_progress` (`profile_id`,`last_played_at`);--> statement-breakpoint
CREATE TABLE `playback_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`session_id` text NOT NULL,
	`source_id` text NOT NULL,
	`item_id` text NOT NULL,
	`mode` text NOT NULL,
	`quality` text,
	`audio_stream` integer,
	`subtitle_stream` integer,
	`burn_in` integer DEFAULT false NOT NULL,
	`audio_delivery` text,
	`started_at` text NOT NULL,
	`last_heartbeat_at` text NOT NULL,
	`position_ms` integer DEFAULT 0 NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playback_sessions_session_id_idx` ON `playback_sessions` (`session_id`);--> statement-breakpoint
CREATE INDEX `playback_sessions_ended_at_idx` ON `playback_sessions` (`ended_at`);--> statement-breakpoint
CREATE TABLE `segment_lookups` (
	`item_id` text NOT NULL,
	`provider` text NOT NULL,
	`checked_at` text NOT NULL,
	`outcome` text NOT NULL,
	PRIMARY KEY(`item_id`, `provider`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`origin` text NOT NULL,
	`confidence` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segments_item_id_idx` ON `segments` (`item_id`,`type`);--> statement-breakpoint
CREATE TABLE `track_preferences` (
	`profile_id` text NOT NULL,
	`item_id` text NOT NULL,
	`audio_language` text,
	`subtitle_language` text,
	`subtitles_enabled` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `item_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`profile_id` text NOT NULL,
	`item_id` text NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `item_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
