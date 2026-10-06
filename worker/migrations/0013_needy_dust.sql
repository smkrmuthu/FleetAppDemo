CREATE TABLE `transporters` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `trips` ADD `transporter` text;