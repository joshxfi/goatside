CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`entry_id` text,
	`file_hash` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`opening` integer,
	`closing` integer,
	`row_count` integer NOT NULL,
	`added_count` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `imports_account_idx` ON `imports` (`account_id`,`file_hash`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `import_ref` text;--> statement-breakpoint
CREATE INDEX `transactions_import_idx` ON `transactions` (`account_id`,`import_ref`);