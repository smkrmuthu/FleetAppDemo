CREATE TABLE `fuel_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`vehicle_id` text NOT NULL,
	`spent_on` text NOT NULL,
	`litres` real NOT NULL,
	`rate_paise` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`details` text,
	`created_by` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fuel_entries_vehicle` ON `fuel_entries` (`org_id`,`vehicle_id`,`spent_on`);