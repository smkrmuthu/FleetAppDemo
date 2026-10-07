-- DEMO DATABASE ONLY (fleet-ledger-demo-db). Never run this against the SMT database.
--
-- Adds a current-week set of sample movements so the demo dashboard opens on a
-- busy month instead of "No movements in this period": five approved trips, two
-- awaiting approval, one truck on the road (a started movement), a trip with
-- costs but no revenue, and a few compliance dates falling due.
--
-- Safe to run again: it first removes the rows it added earlier (ids starting
-- with "ot", "oe" and the notifications n7/n8) and rebuilds them. It copies the
-- September sample trips t1..t8, so run it after the base seed, and edit the
-- dates below when you want to roll the sample data forward to another month.
--
--   cd worker && npx wrangler d1 execute fleet-ledger-demo-db --remote -c wrangler.toml --file=scripts/demo-sample-october.sql

DELETE FROM notifications WHERE id IN ('n7','n8');
DELETE FROM trip_expenses WHERE trip_id LIKE 'ot%';
DELETE FROM monthly_expenses WHERE id LIKE 'oe%' OR id IN ('oe1','oe2','oe3','oe4','oe5','oe6');
DELETE FROM trips WHERE id LIKE 'ot%';

INSERT INTO trips (id, org_id, vehicle_id, driver_id, waybill_no, item_no, load_date, unload_date, from_loc, to_loc, weight_kg, odo_start, odo_end, revenue_paise, status, created_by, created_at, updated_at)
SELECT 'o'||id, org_id, vehicle_id, driver_id,
       'EWB '||(CAST(substr(waybill_no,5,1) AS INTEGER)+4)||substr(waybill_no,6),
       item_no, load_date, unload_date, from_loc, to_loc, weight_kg, odo_start, odo_end, revenue_paise, status, created_by, created_at, updated_at
FROM trips WHERE id IN ('t1','t2','t3','t4','t5','t6','t7','t8');

UPDATE trips SET load_date='2026-10-01', unload_date='2026-10-02', status='approved' WHERE id='ot1';
UPDATE trips SET load_date='2026-10-01', unload_date='2026-10-02', status='approved' WHERE id='ot2';
UPDATE trips SET load_date='2026-10-02', unload_date='2026-10-02', status='approved' WHERE id='ot3';
UPDATE trips SET load_date='2026-10-02', unload_date='2026-10-04', status='approved' WHERE id='ot4';
UPDATE trips SET load_date='2026-10-03', unload_date='2026-10-04', status='pending'  WHERE id='ot5';
UPDATE trips SET load_date='2026-10-04', unload_date='2026-10-05', status='approved' WHERE id='ot6';
UPDATE trips SET load_date='2026-10-05', unload_date='2026-10-05', status='pending'  WHERE id='ot7';
UPDATE trips SET load_date='2026-10-06', unload_date=NULL,         status='draft'    WHERE id='ot8';
-- one movement with costs but no revenue yet, so "Needs attention" has something real to say
UPDATE trips SET revenue_paise = 0 WHERE id='ot3';
UPDATE trips SET odo_start = 150000 + CAST(substr(id,3) AS INTEGER)*1000, odo_end = 150000 + CAST(substr(id,3) AS INTEGER)*1000 + odo_end WHERE id LIKE 'ot%';

INSERT INTO trip_expenses (id, org_id, trip_id, spent_on, kind, litres, rate_paise, amount_paise, created_by, created_at)
SELECT 'o'||id, org_id, 'o'||trip_id, '2026-10-01', kind, litres, rate_paise, amount_paise, created_by, created_at FROM trip_expenses WHERE trip_id IN ('t1','t2','t3','t4','t5','t6','t7','t8');
UPDATE trip_expenses SET spent_on = (SELECT load_date FROM trips WHERE trips.id = trip_expenses.trip_id) WHERE trip_id LIKE 'ot%';

INSERT INTO monthly_expenses (id, org_id, vehicle_id, driver_id, spent_on, category, amount_paise, remarks, created_by, created_at)
SELECT 'o'||id, org_id, vehicle_id, driver_id, replace(spent_on,'2026-09','2026-10'), category, amount_paise, remarks, created_by, created_at FROM monthly_expenses WHERE id IN ('e1','e2','e3','e4','e5','e6');
UPDATE monthly_expenses SET spent_on = '2026-10-0' || CAST((CAST(substr(spent_on,9,2) AS INTEGER) % 6) + 1 AS TEXT) WHERE id LIKE 'oe%';

-- compliance dates that are believable: mostly healthy, a few falling due soon
UPDATE vehicles SET fc_date='2027-03-14', fc_renewal_due='2027-03-14', pollution_date='2026-10-24' WHERE id='TN38 AB 4412';
UPDATE vehicles SET fc_date='2026-10-29', fc_renewal_due='2026-10-29' WHERE id='TN45 CQ 9087';
UPDATE vehicles SET fc_date='2027-01-04', fc_renewal_due='2027-01-04', tax_date='2026-11-18' WHERE id='KA01 MD 7731';
UPDATE vehicles SET fc_date='2026-12-20', fc_renewal_due='2026-12-20' WHERE id='TN52 BK 2290';

-- tidy the September leftovers so the open-movement list tells a current story
UPDATE trips SET status = 'approved' WHERE id IN ('t7','t8');
UPDATE notifications SET read = 1 WHERE id IN ('n1','n2');
INSERT INTO notifications (id, org_id, kind, message, tab, related_trip_id, read, created_at) VALUES
  ('n7', 'org-meridian', 'approval', 'Murugan S logged TN38 AB 4412 — pending approval', 'triplog', 'ot5', 0, '2026-10-04T16:20:00Z'),
  ('n8', 'org-meridian', 'approval', 'Prakash N logged KA01 MD 7731 — pending approval', 'triplog', 'ot7', 0, '2026-10-05T18:05:00Z');
