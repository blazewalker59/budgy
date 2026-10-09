ALTER TABLE `imports` ADD `account` text;--> statement-breakpoint
UPDATE `imports` SET `account` = substr(`file_name`, 11) WHERE `file_name` LIKE 'posted to %';
