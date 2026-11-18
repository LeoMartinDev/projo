ALTER TABLE `profiles` ADD `live_tv` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tv_sources` ADD `guide_attempt_at` text;