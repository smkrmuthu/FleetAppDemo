-- Demo data for Demo Logistics — mirrors the mock data the frontend
-- prototype shipped with, now as real rows. Demo sign-in passwords:
--   Manager  A. Balan   mgr@demo.com / mgr123
--   Office   Kavitha R  office@demo.com / office123
--   Driver   Murugan S  driver@demo.com / driver123

INSERT INTO orgs (id, name, currency, fy_start_month) VALUES
  ('org-meridian', 'Demo Logistics', 'INR', 4);

INSERT INTO branches (id, org_id, name) VALUES
  ('branch-chennai', 'org-meridian', 'Chennai HQ'),
  ('branch-cochin', 'org-meridian', 'Cochin'),
  ('branch-hosur', 'org-meridian', 'Hosur');

INSERT INTO vehicles (id, org_id, reg_no, model, fc_date, fc_renewal_due, active) VALUES
  ('TN38 AB 4412', 'org-meridian', 'TN38 AB 4412', 'Tata Signa 4825',     '2025-03-15', '2027-03-14', 1),
  ('TN45 CQ 9087', 'org-meridian', 'TN45 CQ 9087', 'Ashok Leyland 3520',  '2024-09-30', '2026-09-29', 1),
  ('KA01 MD 7731', 'org-meridian', 'KA01 MD 7731', 'BharatBenz 2823',     '2025-01-05', '2027-01-04', 1),
  ('TN52 BK 2290', 'org-meridian', 'TN52 BK 2290', 'Eicher Pro 6028',     '2024-11-05', '2026-11-04', 1);

INSERT INTO drivers (id, org_id, branch_id, full_name, phone, licence_no, licence_expiry, credential, default_vehicle, active) VALUES
  ('Murugan S', 'org-meridian', 'branch-chennai', 'Murugan S', '+91 98431 20114', 'TN38 20110004412', '2028-03-14', 'Yard pass · valid', 'TN38 AB 4412', 1),
  ('Rafiq A',   'org-meridian', 'branch-cochin',  'Rafiq A',   '+91 99401 55380', 'KL07 20140091877', '2026-11-02', 'Yard pass · valid', 'TN45 CQ 9087', 1),
  ('Prakash N', 'org-meridian', 'branch-hosur',   'Prakash N', '+91 94433 71206', 'KA01 20090037741', '2027-06-27', 'Hazmat endorsed',   'KA01 MD 7731', 1),
  ('Ilango R',  'org-meridian', 'branch-chennai', 'Ilango R',  '+91 90805 44117', 'TN52 20160112290', '2026-10-09', 'Yard pass · renew', 'TN52 BK 2290', 1);

INSERT INTO users (id, org_id, branch_id, role, full_name, phone, password_hash, password_salt, driver_id, last_seen_at) VALUES
  ('user-balan',   'org-meridian', 'branch-chennai', 'manager', 'A. Balan',  'mgr@demo.com',    '5902886c11f95192472316c5482b88afecaef9ea82bc9beea6744826825c50fb', '3686be45329fa9a7d42fd41e0d43c794', NULL, '2026-09-14T09:12:00Z'),
  ('user-kavitha', 'org-meridian', 'branch-chennai', 'office',  'Kavitha R', 'office@demo.com', '042bf5071767ff3bae163af25883cac1decde244af49549cc9765661a3cd8f65', '6dd3a086980ec50de96f1dedf3516d45', NULL, '2026-09-14T08:40:00Z'),
  ('user-suresh',  'org-meridian', 'branch-cochin',  'office',  'Suresh V',  '+91 98847 30215', NULL, NULL, NULL, '2026-09-13T18:22:00Z'),
  ('user-murugan', 'org-meridian', 'branch-chennai', 'driver',  'Murugan S', 'driver@demo.com', 'b10121718c4893cca0af63eb8ede93e0550d03e26356f909401e9c7616d27dc8', '24ec67fc6c467f94b1e5497089bb0293', 'Murugan S', '2026-09-14T07:05:00Z'),
  ('user-rafiq',   'org-meridian', 'branch-cochin',  'driver',  'Rafiq A',   '+91 99401 55380', NULL, NULL, 'Rafiq A', '2026-09-14T06:48:00Z'),
  ('user-prakash', 'org-meridian', 'branch-hosur',   'driver',  'Prakash N', '+91 94433 71206', NULL, NULL, 'Prakash N', '2026-09-12T00:00:00Z'),
  ('user-ilango',  'org-meridian', 'branch-chennai', 'driver',  'Ilango R',  '+91 90805 44117', NULL, NULL, 'Ilango R', '2026-09-14T11:30:00Z');

INSERT INTO trips (id, org_id, vehicle_id, driver_id, waybill_no, item_no, load_date, unload_date, from_loc, to_loc, weight_kg, revenue_paise, status, created_by, created_at, updated_at) VALUES
  ('t1', 'org-meridian', 'TN38 AB 4412', 'Murugan S', 'EWB 2710 0345 6789', 'ITM-4471', '2026-09-02', '2026-09-03', 'Chennai Yard', 'Sriperumbudur ICD', 24500, 3450000, 'approved', 'user-kavitha', '2026-09-02T09:00:00Z', '2026-09-02T09:00:00Z'),
  ('t2', 'org-meridian', 'TN45 CQ 9087', 'Rafiq A',   'EWB 3312 8890 0217', 'ITM-5502', '2026-09-03', '2026-09-04', 'Tirupur Factory', 'Cochin Yard', 18000, 3180000, 'approved', 'user-kavitha', '2026-09-03T09:00:00Z', '2026-09-03T09:00:00Z'),
  ('t3', 'org-meridian', 'KA01 MD 7731', 'Prakash N', 'EWB 1145 0032 8871', 'ITM-2290', '2026-09-05', '2026-09-05', 'Ennore Yard', 'Hosur Warehouse', 21200, 1940000, 'approved', 'user-kavitha', '2026-09-05T09:00:00Z', '2026-09-05T09:00:00Z'),
  ('t4', 'org-meridian', 'TN52 BK 2290', 'Ilango R',  'EWB 4420 7765 1190', 'ITM-6610', '2026-09-06', '2026-09-08', 'Hosur Warehouse', 'Cochin Yard', 26000, 6820000, 'approved', 'user-kavitha', '2026-09-06T09:00:00Z', '2026-09-06T09:00:00Z'),
  ('t5', 'org-meridian', 'TN38 AB 4412', 'Murugan S', 'EWB 2299 1173 6602', 'ITM-4488', '2026-09-08', '2026-09-09', 'Chennai Yard', 'Vijayawada Warehouse', 25000, 4190000, 'approved', 'user-kavitha', '2026-09-08T09:00:00Z', '2026-09-08T09:00:00Z'),
  ('t6', 'org-meridian', 'TN45 CQ 9087', 'Rafiq A',   'EWB 3366 0482 1907', 'ITM-5521', '2026-09-09', '2026-09-10', 'Hyderabad Plant', 'Krishnapatnam Yard', 19500, 4760000, 'approved', 'user-kavitha', '2026-09-09T09:00:00Z', '2026-09-09T09:00:00Z'),
  ('t7', 'org-meridian', 'KA01 MD 7731', 'Prakash N', 'EWB 1198 4402 7765', 'ITM-2295', '2026-09-10', '2026-09-10', 'Ennore Yard', 'Erode Warehouse', 22000, 860000, 'pending', 'user-prakash', '2026-09-10T09:00:00Z', '2026-09-10T09:00:00Z'),
  ('t8', 'org-meridian', 'TN52 BK 2290', 'Ilango R',  'EWB 4467 7743 0199', 'ITM-6615', '2026-09-11', '2026-09-12', 'Madurai Factory', 'Tuticorin Yard', 23400, 2480000, 'pending', 'user-ilango', '2026-09-11T09:00:00Z', '2026-09-11T09:00:00Z');

INSERT INTO trip_expenses (id, org_id, trip_id, spent_on, kind, litres, rate_paise, amount_paise, created_by, created_at) VALUES
  ('t1x1', 'org-meridian', 't1', '2026-09-02', 'diesel', 118,   9500, 1121000, 'user-kavitha', '2026-09-02T09:00:00Z'),
  ('t1x2', 'org-meridian', 't1', '2026-09-02', 'toll',   NULL,  NULL,  184000, 'user-kavitha', '2026-09-02T09:00:00Z'),
  ('t1x3', 'org-meridian', 't1', '2026-09-03', 'other',  NULL,  NULL,   90000, 'user-kavitha', '2026-09-03T09:00:00Z'),
  ('t2x1', 'org-meridian', 't2', '2026-09-03', 'diesel', 131,   9400, 1231400, 'user-kavitha', '2026-09-03T09:00:00Z'),
  ('t2x2', 'org-meridian', 't2', '2026-09-03', 'toll',   NULL,  NULL,  210000, 'user-kavitha', '2026-09-03T09:00:00Z'),
  ('t2x3', 'org-meridian', 't2', '2026-09-04', 'other',  NULL,  NULL,  125000, 'user-kavitha', '2026-09-04T09:00:00Z'),
  ('t3x1', 'org-meridian', 't3', '2026-09-05', 'diesel', 74,    9600,  710400, 'user-kavitha', '2026-09-05T09:00:00Z'),
  ('t3x2', 'org-meridian', 't3', '2026-09-05', 'toll',   NULL,  NULL,   98000, 'user-kavitha', '2026-09-05T09:00:00Z'),
  ('t3x3', 'org-meridian', 't3', '2026-09-05', 'other',  NULL,  NULL,   45000, 'user-kavitha', '2026-09-05T09:00:00Z'),
  ('t4x1', 'org-meridian', 't4', '2026-09-06', 'diesel', 130,   9500, 1235000, 'user-kavitha', '2026-09-06T09:00:00Z'),
  ('t4x2', 'org-meridian', 't4', '2026-09-06', 'toll',   NULL,  NULL,  184000, 'user-kavitha', '2026-09-06T09:00:00Z'),
  ('t4x3', 'org-meridian', 't4', '2026-09-07', 'diesel', 116,   9500, 1102000, 'user-kavitha', '2026-09-07T09:00:00Z'),
  ('t4x4', 'org-meridian', 't4', '2026-09-07', 'adblue', 8,     7500,   60000, 'user-kavitha', '2026-09-07T09:00:00Z'),
  ('t4x5', 'org-meridian', 't4', '2026-09-08', 'toll',   NULL,  NULL,  180000, 'user-kavitha', '2026-09-08T09:00:00Z'),
  ('t4x6', 'org-meridian', 't4', '2026-09-08', 'other',  NULL,  NULL,  210000, 'user-kavitha', '2026-09-08T09:00:00Z'),
  ('t5x1', 'org-meridian', 't5', '2026-09-08', 'diesel', 162,   9500, 1539000, 'user-kavitha', '2026-09-08T09:00:00Z'),
  ('t5x2', 'org-meridian', 't5', '2026-09-08', 'toll',   NULL,  NULL,  238000, 'user-kavitha', '2026-09-08T09:00:00Z'),
  ('t5x3', 'org-meridian', 't5', '2026-09-09', 'other',  NULL,  NULL,  115000, 'user-kavitha', '2026-09-09T09:00:00Z'),
  ('t6x1', 'org-meridian', 't6', '2026-09-09', 'diesel', 108,   9600, 1036800, 'user-kavitha', '2026-09-09T09:00:00Z'),
  ('t6x2', 'org-meridian', 't6', '2026-09-09', 'toll',   NULL,  NULL,  160000, 'user-kavitha', '2026-09-09T09:00:00Z'),
  ('t6x3', 'org-meridian', 't6', '2026-09-10', 'diesel', 97,    9600,  931200, 'user-kavitha', '2026-09-10T09:00:00Z'),
  ('t6x4', 'org-meridian', 't6', '2026-09-10', 'adblue', 6,     7500,   45000, 'user-kavitha', '2026-09-10T09:00:00Z'),
  ('t6x5', 'org-meridian', 't6', '2026-09-10', 'toll',   NULL,  NULL,  136000, 'user-kavitha', '2026-09-10T09:00:00Z'),
  ('t6x6', 'org-meridian', 't6', '2026-09-10', 'other',  NULL,  NULL,  140000, 'user-kavitha', '2026-09-10T09:00:00Z'),
  ('t7x1', 'org-meridian', 't7', '2026-09-10', 'diesel', 36,    9500,  342000, 'user-prakash', '2026-09-10T09:00:00Z'),
  ('t7x2', 'org-meridian', 't7', '2026-09-10', 'toll',   NULL,  NULL,   42000, 'user-prakash', '2026-09-10T09:00:00Z'),
  ('t7x3', 'org-meridian', 't7', '2026-09-10', 'other',  NULL,  NULL,   26000, 'user-prakash', '2026-09-10T09:00:00Z'),
  ('t8x1', 'org-meridian', 't8', '2026-09-11', 'diesel', 97,    9500,  921500, 'user-ilango', '2026-09-11T09:00:00Z'),
  ('t8x2', 'org-meridian', 't8', '2026-09-11', 'toll',   NULL,  NULL,  118000, 'user-ilango', '2026-09-11T09:00:00Z'),
  ('t8x3', 'org-meridian', 't8', '2026-09-12', 'other',  NULL,  NULL,   64000, 'user-ilango', '2026-09-12T09:00:00Z');

-- odo_start/odo_end are separate from expense litres and aren't in the
-- original mock data's per-trip km, so backfill km via odo columns
-- consistent with the km already implied by the prototype.
UPDATE trips SET odo_start = 0, odo_end = 342 WHERE id = 't1';
UPDATE trips SET odo_start = 0, odo_end = 372 WHERE id = 't2';
UPDATE trips SET odo_start = 0, odo_end = 208 WHERE id = 't3';
UPDATE trips SET odo_start = 0, odo_end = 692 WHERE id = 't4';
UPDATE trips SET odo_start = 0, odo_end = 456 WHERE id = 't5';
UPDATE trips SET odo_start = 0, odo_end = 574 WHERE id = 't6';
UPDATE trips SET odo_start = 0, odo_end = 98  WHERE id = 't7';
UPDATE trips SET odo_start = 0, odo_end = 268 WHERE id = 't8';

INSERT INTO monthly_expenses (id, org_id, vehicle_id, driver_id, spent_on, category, amount_paise, remarks, created_by, created_at) VALUES
  ('e1', 'org-meridian', 'TN38 AB 4412', 'Murugan S', '2026-09-01', 'Detention / halting charges', 2860000, 'EWB 2710 0345 6789 · yard halt', 'user-kavitha', '2026-09-01T09:00:00Z'),
  ('e2', 'org-meridian', 'TN45 CQ 9087', 'Rafiq A',   '2026-09-02', 'Permit / tax', 1240000, 'Sept transit permit', 'user-kavitha', '2026-09-02T09:00:00Z'),
  ('e3', 'org-meridian', 'KA01 MD 7731', 'Prakash N', '2026-09-04', 'Detention / halting charges', 1980000, '2 days, EWB 1145 0032 8871', 'user-kavitha', '2026-09-04T09:00:00Z'),
  ('e4', 'org-meridian', 'TN52 BK 2290', 'Ilango R',  '2026-09-06', 'Loan / lease', 5620000, 'EMI', 'user-kavitha', '2026-09-06T09:00:00Z'),
  ('e5', 'org-meridian', 'TN38 AB 4412', 'Murugan S', '2026-09-07', 'Insurance', 1840000, 'Goods-in-transit insurance, Q3', 'user-kavitha', '2026-09-07T09:00:00Z'),
  ('e6', 'org-meridian', 'TN45 CQ 9087', 'Rafiq A',   '2026-09-09', 'Maintenance', 520000, 'Oil change', 'user-kavitha', '2026-09-09T09:00:00Z');

INSERT INTO notifications (id, org_id, kind, message, tab, related_trip_id, read, created_at) VALUES
  ('n1', 'org-meridian', 'approval', 'Ilango R logged TN52 BK 2290 — pending approval', 'triplog', 't8', 0, '2026-09-11T12:40:00Z'),
  ('n2', 'org-meridian', 'approval', 'Prakash N logged KA01 MD 7731 — pending approval', 'triplog', 't7', 0, '2026-09-10T10:15:00Z'),
  ('n3', 'org-meridian', 'alert', 'Ilango R''s licence expires 09 Oct 2026', 'people', NULL, 0, '2026-09-10T06:00:00Z'),
  ('n4', 'org-meridian', 'alert', 'Rafiq A''s licence expires 02 Nov 2026', 'people', NULL, 0, '2026-09-10T06:00:00Z'),
  ('n5', 'org-meridian', 'alert', 'TN52 BK 2290 fitness certificate renewal due 04 Nov 2026', 'people', NULL, 0, '2026-09-10T06:00:00Z'),
  ('n6', 'org-meridian', 'alert', 'TN45 CQ 9087 fitness certificate renewal due 29 Sep 2026', 'people', NULL, 0, '2026-09-10T06:00:00Z');
