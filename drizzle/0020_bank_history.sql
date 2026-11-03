ALTER TABLE `bank_accounts` ADD `history_from` text;--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `history_complete` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_connections` ADD `sync_queued_until` integer;
--> statement-breakpoint
-- Accounts already syncing keep the history they have (docs/adr/0014).
UPDATE `bank_accounts` SET `history_from` = coalesce(`money_in_since`, `synced_through`), `history_complete` = 1 WHERE `synced_through` IS NOT NULL;
