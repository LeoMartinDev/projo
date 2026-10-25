PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by_account_id` text,
	FOREIGN KEY (`created_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_invitations`("id", "token_hash", "created_by", "expires_at", "used_at", "used_by_account_id") SELECT "id", "token_hash", "created_by", "expires_at", "used_at", "used_by_account_id" FROM `invitations`;--> statement-breakpoint
DROP TABLE `invitations`;--> statement-breakpoint
ALTER TABLE `__new_invitations` RENAME TO `invitations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);