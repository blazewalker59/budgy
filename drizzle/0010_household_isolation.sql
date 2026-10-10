CREATE TABLE `household_members` (
	`household_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `member_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `household_members_member_idx` ON `household_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
-- Preserve the existing Ledger. No runtime default routes new rows here.
INSERT INTO `households` (`id`, `name`) VALUES ('hh_initial', 'Our household');--> statement-breakpoint
-- Only existing sign-ins are migrated; adding an allowlisted email does not
-- grant access to this Household. Owner selection is an explicit rollout step.
INSERT INTO `household_members` (`household_id`, `member_id`, `role`)
SELECT 'hh_initial', `id`, 'member' FROM `user`;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`household_id` text NOT NULL,
	`id` text NOT NULL,
	`date` text NOT NULL,
	`month` text NOT NULL,
	`account` text NOT NULL,
	`description` text NOT NULL,
	`store` text NOT NULL,
	`source_category` text NOT NULL,
	`amount` integer NOT NULL,
	`category` text,
	`note` text,
	`import_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("household_id", "id", "date", "month", "account", "description", "store", "source_category", "amount", "category", "note", "import_id", "created_at") SELECT 'hh_initial', "id", "date", "month", "account", "description", "store", "source_category", "amount", "category", "note", "import_id", "created_at" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
CREATE INDEX `transactions_month_idx` ON `transactions` (`household_id`,`month`);--> statement-breakpoint
CREATE TABLE `__new_balances` (
	`household_id` text NOT NULL,
	`account` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `account`, `date`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_balances`("household_id", "account", "date", "amount", "recorded_by", "created_at") SELECT 'hh_initial', "account", "date", "amount", "recorded_by", "created_at" FROM `balances`;--> statement-breakpoint
DROP TABLE `balances`;--> statement-breakpoint
ALTER TABLE `__new_balances` RENAME TO `balances`;--> statement-breakpoint
CREATE TABLE `__new_budget_targets` (
	`household_id` text NOT NULL,
	`category` text NOT NULL,
	`starts_month` text NOT NULL,
	`amount` integer NOT NULL,
	PRIMARY KEY(`household_id`, `category`, `starts_month`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_budget_targets`("household_id", "category", "starts_month", "amount") SELECT 'hh_initial', "category", "starts_month", "amount" FROM `budget_targets`;--> statement-breakpoint
DROP TABLE `budget_targets`;--> statement-breakpoint
ALTER TABLE `__new_budget_targets` RENAME TO `budget_targets`;--> statement-breakpoint
CREATE TABLE `__new_store_rules` (
	`household_id` text NOT NULL,
	`source_category` text NOT NULL,
	`store` text NOT NULL,
	`category` text,
	`tag` text,
	PRIMARY KEY(`household_id`, `source_category`, `store`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_store_rules`("household_id", "source_category", "store", "category", "tag") SELECT 'hh_initial', "source_category", "store", "category", "tag" FROM `store_rules`;--> statement-breakpoint
DROP TABLE `store_rules`;--> statement-breakpoint
ALTER TABLE `__new_store_rules` RENAME TO `store_rules`;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`source_name` text NOT NULL,
	`owner` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`institution` text,
	`closed` integer DEFAULT false NOT NULL,
	`secured_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `name`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("household_id", "name", "source_name", "owner", "kind", "institution", "closed", "secured_by", "created_at") SELECT 'hh_initial', "name", "source_name", "owner", "kind", "institution", "closed", "secured_by", "created_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`tag` text NOT NULL,
	`group` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `name`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_categories`("household_id", "name", "tag", "group", "created_at") SELECT 'hh_initial', "name", "tag", "group", "created_at" FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
CREATE TABLE `__new_imports` (
	`household_id` text NOT NULL,
	`id` text NOT NULL,
	`file_name` text NOT NULL,
	`account` text,
	`imported_by` text NOT NULL,
	`added` integer NOT NULL,
	`skipped` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_imports`("household_id", "id", "file_name", "account", "imported_by", "added", "skipped", "created_at") SELECT 'hh_initial', "id", "file_name", "account", "imported_by", "added", "skipped", "created_at" FROM `imports`;--> statement-breakpoint
DROP TABLE `imports`;--> statement-breakpoint
ALTER TABLE `__new_imports` RENAME TO `imports`;--> statement-breakpoint
CREATE TABLE `__new_pay_schedules` (
	`household_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`cadence` text NOT NULL,
	`anchor` text NOT NULL,
	`second_day` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pay_schedules`("household_id", "id", "name", "amount", "cadence", "anchor", "second_day", "created_at") SELECT 'hh_initial', "id", "name", "amount", "cadence", "anchor", "second_day", "created_at" FROM `pay_schedules`;--> statement-breakpoint
DROP TABLE `pay_schedules`;--> statement-breakpoint
ALTER TABLE `__new_pay_schedules` RENAME TO `pay_schedules`;--> statement-breakpoint
CREATE TABLE `__new_planned_expenses` (
	`household_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`store` text,
	`amount` integer NOT NULL,
	`cadence` text NOT NULL,
	`anchor` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_planned_expenses`("household_id", "id", "name", "category", "store", "amount", "cadence", "anchor", "active", "created_at") SELECT 'hh_initial', "id", "name", "category", "store", "amount", "cadence", "anchor", "active", "created_at" FROM `planned_expenses`;--> statement-breakpoint
DROP TABLE `planned_expenses`;--> statement-breakpoint
ALTER TABLE `__new_planned_expenses` RENAME TO `planned_expenses`;--> statement-breakpoint
CREATE TABLE `__new_saved_lenses` (
	`household_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`lens` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_saved_lenses`("household_id", "id", "name", "lens", "created_by", "created_at") SELECT 'hh_initial', "id", "name", "lens", "created_by", "created_at" FROM `saved_lenses`;--> statement-breakpoint
DROP TABLE `saved_lenses`;--> statement-breakpoint
ALTER TABLE `__new_saved_lenses` RENAME TO `saved_lenses`;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`household_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`household_id`, `key`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_settings`("household_id", "key", "value", "updated_at") SELECT 'hh_initial', "key", "value", "updated_at" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
CREATE TABLE `__new_api_tokens` (
  `household_id` text NOT NULL REFERENCES `households` (`id`),
  `id` text PRIMARY KEY NOT NULL,
  `member_id` text NOT NULL,
  `member_email` text NOT NULL,
  `name` text NOT NULL,
  `token_hash` text NOT NULL,
  `prefix` text NOT NULL,
  `scopes` text NOT NULL,
  `created_at` text NOT NULL,
  `last_used_at` text,
  `revoked_at` text
);--> statement-breakpoint
INSERT INTO `__new_api_tokens` SELECT 'hh_initial', `id`, `member_id`, `member_email`, `name`, `token_hash`, `prefix`, `scopes`, `created_at`, `last_used_at`, `revoked_at` FROM `api_tokens`;--> statement-breakpoint
DROP TABLE `api_tokens`;--> statement-breakpoint
ALTER TABLE `__new_api_tokens` RENAME TO `api_tokens`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_member_idx` ON `api_tokens` (`member_id`);--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
