CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
