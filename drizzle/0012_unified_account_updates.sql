CREATE TABLE `account_inputs` (
	`household_id` text NOT NULL,
	`account` text NOT NULL,
	`format` text NOT NULL,
	PRIMARY KEY(`household_id`, `account`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `account_update_locks` (
	`household_id` text NOT NULL,
	`account` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `account`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `account_updates` (
	`household_id` text NOT NULL,
	`id` text NOT NULL,
	`account` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`from_date` text,
	`to_date` text,
	`added` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`linked` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`review` integer DEFAULT 0 NOT NULL,
	`message` text,
	`issues` text DEFAULT '[]' NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`household_id`, `id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_updates_account_idx` ON `account_updates` (`household_id`,`account`,`started_at`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `source_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_source_unique` ON `transactions` (`household_id`,`account`,`source_key`);