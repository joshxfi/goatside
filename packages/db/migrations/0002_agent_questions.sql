CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`kind` text NOT NULL,
	`guess` text NOT NULL,
	`options` text NOT NULL,
	`context` text,
	`answer` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `questions_open_idx` ON `questions` (`resolved_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `questions_transaction_idx` ON `questions` (`transaction_id`);