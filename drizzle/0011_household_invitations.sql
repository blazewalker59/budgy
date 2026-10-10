CREATE TABLE `household_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_invites_token_hash_unique` ON `household_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `household_invites_email_idx` ON `household_invites` (`email`);--> statement-breakpoint
CREATE INDEX `household_invites_household_idx` ON `household_invites` (`household_id`);--> statement-breakpoint
DROP INDEX `household_members_member_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `household_members_member_unique` ON `household_members` (`member_id`);