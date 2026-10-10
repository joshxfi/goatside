CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`last4` text,
	`credit_limit` integer,
	`opening` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_name_idx` ON `accounts` (lower("name"));--> statement-breakpoint
ALTER TABLE `settings` ADD `default_account_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `account_id` text REFERENCES accounts(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `transactions` ADD `to_account_id` text REFERENCES accounts(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `transactions_account_idx` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `transactions_to_account_idx` ON `transactions` (`to_account_id`);