-- Removes everything scripts/large-fleet.mjs added (and nothing else).
DELETE FROM notifications WHERE id LIKE 'lf-n-%';
DELETE FROM trip_expenses WHERE trip_id LIKE 'lf-%';
DELETE FROM trip_stops WHERE trip_id LIKE 'lf-%';
DELETE FROM trips WHERE id LIKE 'lf-%';
DELETE FROM monthly_expenses WHERE id LIKE 'lf-fx%';
DELETE FROM vehicle_unavailability WHERE id LIKE 'lf-un%';
DELETE FROM drivers WHERE custom_fields = '{"sample":"large-fleet"}';
DELETE FROM vehicles WHERE custom_fields = '{"sample":"large-fleet"}';
