CREATE TABLE `money_in` (
	`household_id` text NOT NULL,
	`id` text NOT NULL,
	`account` text NOT NULL,
	`date` text NOT NULL,
	`month` text NOT NULL,
	`description` text NOT NULL,
	`store` text NOT NULL,
	`amount` integer NOT NULL,
	`use` text NOT NULL,
	`category` text,
	`offset_amount` integer,
	`txn_id` text,
	`note` text,
	`source_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `money_in_month_idx` ON `money_in` (`household_id`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `money_in_source_unique` ON `money_in` (`household_id`,`account`,`source_key`);--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `money_in_since` text;