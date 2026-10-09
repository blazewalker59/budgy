CREATE TABLE `income` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`month` text NOT NULL,
	`account` text NOT NULL,
	`description` text NOT NULL,
	`payer` text NOT NULL,
	`source_category` text NOT NULL,
	`amount` integer NOT NULL,
	`import_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `income_month_idx` ON `income` (`month`);