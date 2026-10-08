CREATE INDEX `notifications_by_trip` ON `notifications` (`related_trip_id`);--> statement-breakpoint
CREATE INDEX `trip_documents_by_trip` ON `trip_documents` (`trip_id`);--> statement-breakpoint
CREATE INDEX `trip_expenses_by_trip` ON `trip_expenses` (`trip_id`);--> statement-breakpoint
CREATE INDEX `trip_stops_by_trip` ON `trip_stops` (`trip_id`);