CREATE TABLE `pay_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`cadence` text NOT NULL,
	`anchor` text NOT NULL,
	`second_day` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
