CREATE TABLE `admin_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`admin_id` text NOT NULL,
	`action` text NOT NULL,
	`persona_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `demo_personas` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `demo_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`admin_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`persona_id`) REFERENCES `demo_personas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `demo_sessions_persona_idx` ON `demo_sessions` (`persona_id`);--> statement-breakpoint
ALTER TABLE `households` ADD `demo` integer DEFAULT false NOT NULL;