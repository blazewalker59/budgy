ALTER TABLE `households` ADD `time_zone` text DEFAULT 'America/New_York' NOT NULL;--> statement-breakpoint
ALTER TABLE `households` ADD `owners` text DEFAULT '["Joint"]' NOT NULL;--> statement-breakpoint
-- The original Household keeps the calendar and the people it already had.
UPDATE `households` SET `time_zone` = 'America/New_York', `owners` = '["Joint","Blaze","Alex"]' WHERE `id` = 'hh_initial';--> statement-breakpoint
-- Household-specific filing that used to live in code, without dropping rules
-- a Member already saved. New Households do not receive these.
UPDATE `settings` SET `value` = json_patch(`value`, '{"hardware":["Lowe''s","Home Depot","Ace Hardware"],"upkeepExclude":"golf","mortgageCategory":"Mortgage and Utilities"}') WHERE `household_id` = 'hh_initial' AND `key` = 'import_rules' AND json_valid(`value`);--> statement-breakpoint
INSERT INTO `settings` (`household_id`, `key`, `value`, `updated_at`)
SELECT 'hh_initial', 'import_rules', '{"stores":[],"upkeep":"","mortgage":"","notSpending":"","hardware":["Lowe''s","Home Depot","Ace Hardware"],"upkeepExclude":"golf","mortgageCategory":"Mortgage and Utilities"}', cast(unixepoch('subsecond') * 1000 as integer)
WHERE NOT EXISTS (
  SELECT 1 FROM `settings` WHERE `household_id` = 'hh_initial' AND `key` = 'import_rules'
);
