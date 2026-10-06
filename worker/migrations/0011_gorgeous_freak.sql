ALTER TABLE `users` ADD `user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_org_user_id` ON `users` (`org_id`,`user_id`);