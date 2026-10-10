CREATE TABLE `bank_accounts` (
	`household_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`name` text NOT NULL,
	`institution` text NOT NULL,
	`currency` text NOT NULL,
	`account` text,
	`present` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`household_id`, `connection_id`, `provider_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_accounts_account_unique` ON `bank_accounts` (`household_id`,`account`);--> statement-breakpoint
CREATE TABLE `bank_connections` (
	`household_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`encrypted_access` text NOT NULL,
	`access_hash` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_fetched_at` integer,
	`request_day` text,
	`request_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_connections_access_hash_unique` ON `bank_connections` (`access_hash`);--> statement-breakpoint
CREATE INDEX `bank_connections_household_idx` ON `bank_connections` (`household_id`);--> statement-breakpoint
CREATE TABLE `upload_tokens` (
	`household_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`format` text NOT NULL,
	`member_id` text NOT NULL,
	`member_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_tokens_token_hash_unique` ON `upload_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `upload_tokens_account_idx` ON `upload_tokens` (`household_id`,`account`);