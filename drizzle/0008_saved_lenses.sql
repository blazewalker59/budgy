CREATE TABLE `saved_lenses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lens` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
