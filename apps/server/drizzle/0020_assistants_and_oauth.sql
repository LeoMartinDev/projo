CREATE TABLE `assistant_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`kind` text DEFAULT 'token' NOT NULL,
	`client_id` text,
	`name` text NOT NULL,
	`token_hash` text,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_tokens_token_hash_unique` ON `assistant_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `assistant_tokens_account_id_idx` ON `assistant_tokens` (`account_id`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` text NOT NULL,
	`fetched_at` text,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_clients_client_id_unique` ON `oauth_clients` (`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`account_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_codes_expires_at_idx` ON `oauth_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`assistant_id` text NOT NULL,
	`kind` text NOT NULL,
	`expires_at` text NOT NULL,
	`rotated_at` text,
	FOREIGN KEY (`assistant_id`) REFERENCES `assistant_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_tokens_assistant_id_idx` ON `oauth_tokens` (`assistant_id`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_expires_at_idx` ON `oauth_tokens` (`expires_at`);