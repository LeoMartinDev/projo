CREATE TABLE `update_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`from_version` text NOT NULL,
	`to_version` text NOT NULL,
	`requested_at` text NOT NULL,
	`finished_at` text,
	`outcome` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `update_runs_requested_at_idx` ON `update_runs` (`requested_at`);--> statement-breakpoint
CREATE INDEX `notifications_unread_idx` ON `notifications` (`read_at`,`resolved_at`);