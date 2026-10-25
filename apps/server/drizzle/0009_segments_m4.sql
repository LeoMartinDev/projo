CREATE TABLE `segment_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`outcome` text NOT NULL,
	`error` text,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segment_submissions_item_idx` ON `segment_submissions` (`item_id`,`type`,`provider`);--> statement-breakpoint
DROP INDEX `segments_item_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `segments_item_type_idx` ON `segments` (`item_id`,`type`);