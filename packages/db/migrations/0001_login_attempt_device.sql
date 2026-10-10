ALTER TABLE `login_attempts` ADD `device_id` text;--> statement-breakpoint
CREATE INDEX `login_attempts_device_idx` ON `login_attempts` (`device_id`,`created_at`);