CREATE TABLE `balances` (
	`account` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`account`, `date`)
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `kind` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `institution` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `closed` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `accounts` SET `kind` = 'credit' WHERE `kind` = 'other' AND (lower(`name`) LIKE '%card%' OR lower(`name`) LIKE '%visa%' OR lower(`name`) LIKE '%mastercard%' OR lower(`name`) LIKE '%amex%');--> statement-breakpoint
UPDATE `accounts` SET `kind` = 'checking' WHERE `kind` = 'other' AND lower(`name`) LIKE '%checking%';--> statement-breakpoint
UPDATE `accounts` SET `kind` = 'savings' WHERE `kind` = 'other' AND lower(`name`) LIKE '%savings%';--> statement-breakpoint
UPDATE `accounts` SET `kind` = 'loan' WHERE `kind` = 'other' AND (lower(`name`) LIKE '%mortgage%' OR lower(`name`) LIKE '%loan%');
