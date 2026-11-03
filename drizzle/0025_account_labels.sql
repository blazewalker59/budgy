CREATE TABLE `account_labels` (
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `name`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_labels_name_unique` ON `account_labels` (`household_id`,lower("name"));--> statement-breakpoint
ALTER TABLE `accounts` ADD `label` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `display_name` text;