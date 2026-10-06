import { useEffect, useState } from 'react';
import type { AppNotification, DriverLeave, DriverMaster, FuelEntry, MasterSettings, MonthlyExpense, Role, TabId, Trip, TripDocument, TripExpenseLine, UserAccount, Vehicle, VehicleUnavailability } from './types';
import { ROLE_TABS } from './data/mockData';
import { rupees, toIsoDate } from './utils/calc';
import { exportBackup } from './lib/reports';
import * as api from './lib/api';
import { SignIn } from './components/SignIn';
import { AppShell } from './components/AppShell';
import { PwaInstall } from './components/PwaInstall';
import { Dashboard } from './components/Dashboard';
import { MovementSummary } from './components/MovementSummary';
import { AddMovement } from './components/AddMovement';
import { TripLog } from './components/TripLog';
import { FuelExpenses } from './components/FuelExpenses';
import { MonthlyExpenses } from './components/MonthlyExpenses';
import { MonthlyReport } from './components/MonthlyReport';
import { People } from './components/People';
import { Master } from './components/Master';
import { DataModel } from './components/DataModel';
import { Movements } from './components/Movements';
import { SettingsPage } from './components/SettingsPage';
import { HelpPage } from './components/HelpPage';

type PersonUser = UserAccount & { id: string };

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return { from, to };
}

export function App() {
  const [authed, setAuthed] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [role, setRole] = useState<Role>('Manager');
  const [currentUserName, setCurrentUserName] = useState('');
  const [tab, setTab] = useState<TabId>(ROLE_TABS['Manager'][0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [trips, setTrips] = useState<Trip[]>([]);
  const [expenses, setExpenses] = useState<MonthlyExpense[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<DriverMaster[]>([]);
  const [users, setUsers] = useState<PersonUser[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [master, setMaster] = useState<MasterSettings>({ dieselRate: null, adblueRate: null, loadingPoint: null });
  const [driverLeaves, setDriverLeaves] = useState<DriverLeave[]>([]);
  const [vehicleUnavailability, setVehicleUnavailability] = useState<VehicleUnavailability[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
  const [transporters, setTransporters] = useState<string[]>([]);
  const [fuelEntries, setFuelEntries] = useState<FuelEntry[]>([]);
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [driverFilter, setDriverFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(() => currentMonthRange().from);
  const [dateTo, setDateTo] = useState(() => currentMonthRange().to);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);

  async function loadAll(currentRole: Role) {
    setLoading(true);
    setError('');
    try {
      // Leaves are fetched for every role, not just Office/Manager — a driver
      // login can enter movements for other drivers too, and needs the same
      // on-leave warning in Add Movement.
      // Transporters are fetched for every role too — Add Movement's dropdown
      // is available to drivers.
      const [v, d, t, e, r, l, u2, tr] = await Promise.all([
        api.fetchVehicles(), api.fetchDrivers(), api.fetchTrips(),
        // Fixed costs are not for drivers (the server refuses them anyway).
        currentRole === 'Driver' ? Promise.resolve([] as MonthlyExpense[]) : api.fetchMonthlyExpenses(),
        api.fetchMasterSettings(), api.fetchDriverLeaves(), api.fetchVehicleUnavailability(), api.fetchTransporters()
      ]);
      setTransporters(tr);
      setVehicles(v);
      setDrivers(d);
      setTrips(t);
      setExpenses(e);
      setMaster(r);
      setDriverLeaves(l);
      setVehicleUnavailability(u2);
      if (currentRole === 'Viewer') {
        // Read-only: no user list or notification feed (the server refuses both).
        setUsers([]);
        setNotifications([]);
        setFuelEntries([]);
        setExpenseCategories(await api.fetchExpenseCategories());
      } else if (currentRole !== 'Driver') {
        const [u, n, ec, fe] = await Promise.all([api.fetchUsers(), api.fetchNotifications(), api.fetchExpenseCategories(), api.fetchFuelEntries()]);
        setUsers(u);
        setNotifications(n);
        setExpenseCategories(ec);
        setFuelEntries(fe);
      } else {
        setFuelEntries([]);
        setUsers([]);
        setNotifications([]);
        setExpenseCategories([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  // The server rejected the sign-in (expired, or the account was switched off).
  useEffect(() => {
    api.setSessionEndedHandler(() => {
      setAuthed(false);
      setError('');
    });
    return () => api.setSessionEndedHandler(null);
  }, []);

  useEffect(() => {
    api.restoreSession().then((session) => {
      if (session) {
        setRole(session.role);
        setCurrentUserName(session.name);
        setTab(ROLE_TABS[session.role][0]);
        setAuthed(true);
        loadAll(session.role);
      }
      setCheckingSession(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(identifier: string, password: string) {
    const { role: r, name } = await api.login(identifier, password);
    setRole(r);
    setCurrentUserName(name);
    setTab(ROLE_TABS[r][0]);
    setAuthed(true);
    await loadAll(r);
  }

  function signOut() {
    api.clearToken();
    setAuthed(false);
  }

  function resetFilters() {
    setVehicleFilter('all');
    setDriverFilter('');
    const { from, to } = currentMonthRange();
    setDateFrom(from);
    setDateTo(to);
  }

  async function submitTrip(action: 'create' | 'start' | 'save' | 'complete', trip: Trip) {
    try {
      if (action === 'create' || action === 'start') {
        await api.createTrip({
          id: trip.id, vehicle: trip.vehicle, driver: trip.driver, waybillNo: trip.waybillNo, itemNo: trip.itemNo,
          loadDate: trip.loadDate, unloadDate: trip.unloadDate, from: trip.from, fromNote: trip.fromNote, to: trip.to, toNote: trip.toNote, tons: trip.tons,
          odoStart: trip.odoStart ?? 0, odoEnd: trip.odoEnd ?? 0, revenue: trip.revenue, remarks: trip.remarks, transporter: trip.transporter,
          expenses: trip.expenses, stops: trip.stops, documents: trip.documents, draft: action === 'start'
        });
      } else {
        const originalIds = new Set((editingTrip?.expenses ?? []).map((e) => e.id));
        const newLines = trip.expenses.filter((e) => !originalIds.has(e.id));
        const removedLines = (editingTrip?.expenses ?? []).filter((e) => !trip.expenses.some((l) => l.id === e.id));
        const originalDocIds = new Set((editingTrip?.documents ?? []).map((d) => d.id));
        const newDocs = trip.documents.filter((d) => !originalDocIds.has(d.id));
        const removedDocs = (editingTrip?.documents ?? []).filter((d) => !trip.documents.some((td) => td.id === d.id));
        const stopSig = (list: { location: string; odo?: number; note?: string }[]) => JSON.stringify(list.map((st) => [st.location, st.odo ?? null, st.note ?? '']));
        const stopsChanged = stopSig(trip.stops) !== stopSig(editingTrip?.stops ?? []);
        await api.updateTrip(trip.id, {
          vehicle: trip.vehicle, driver: trip.driver, waybillNo: trip.waybillNo, itemNo: trip.itemNo, loadDate: trip.loadDate,
          unloadDate: trip.unloadDate, from: trip.from, fromNote: trip.fromNote, to: trip.to, toNote: trip.toNote, tons: trip.tons, odoStart: trip.odoStart,
          odoEnd: trip.odoEnd, revenue: trip.revenue, remarks: trip.remarks, transporter: trip.transporter ?? '',
          stops: stopsChanged ? trip.stops : undefined
        });
        for (const line of removedLines) {
          await api.deleteTripExpense(trip.id, line.id);
        }
        for (const line of newLines) {
          await api.addTripExpense(trip.id, line);
        }
        for (const doc of newDocs) {
          await api.uploadTripDocument(trip.id, doc);
        }
        for (const doc of removedDocs) {
          await api.deleteTripDocument(trip.id, doc.id);
        }
        if (action === 'complete') {
          await api.completeTrip(trip.id, trip.odoEnd ?? 0, trip.unloadDate, trip.remarks);
        }
      }
      setEditingTrip(null);
      setTab('triplog');
      const tasks = [api.fetchTrips().then(setTrips)];
      if (role !== 'Driver') tasks.push(api.fetchNotifications().then(setNotifications));
      await Promise.all(tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save movement');
    }
  }

  function startEditingTrip(trip: Trip) {
    setEditingTrip(trip);
    setTab('addtrip');
  }

  function cancelEditingTrip() {
    setEditingTrip(null);
    setTab('triplog');
  }

  // Everything, straight from the server (not the screens' filtered lists).
  async function backupEverything() {
    const [allTrips, v, d, e, m, u] = await Promise.all([
      api.fetchAllTrips(), api.fetchVehicles(), api.fetchDrivers(), api.fetchMonthlyExpenses(), api.fetchMasterSettings(), api.fetchUsers()
    ]);
    await exportBackup({ trips: allTrips, vehicles: v, drivers: d, expenses: e, master: m, users: u });
  }

  async function approveTrip(tripId: string) {
    try {
      await api.approveTrip(tripId);
      await Promise.all([api.fetchTrips().then(setTrips), api.fetchNotifications().then(setNotifications)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve movement');
    }
  }

  async function deleteTrip(trip: Trip) {
    if (!window.confirm(`Delete the movement for ${trip.vehicle} (trip ${trip.waybillNo})? This cannot be undone.`)) return;
    try {
      await api.deleteTrip(trip.id);
      if (editingTrip?.id === trip.id) setEditingTrip(null);
      const tasks = [api.fetchTrips().then(setTrips)];
      if (role !== 'Driver') tasks.push(api.fetchNotifications().then(setNotifications));
      await Promise.all(tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete movement');
    }
  }

  async function openNotification(n: AppNotification) {
    try {
      await api.markNotificationRead(n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    } catch {
      // non-critical — still navigate even if marking read failed
    }
    setTab(n.tab);
  }

  async function markAllNotificationsRead() {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update notifications');
    }
  }

  async function deleteMonthlyExpense(expense: MonthlyExpense) {
    if (!window.confirm(`Delete this expense — ${expense.category} for ${expense.vehicle}, ${rupees(expense.amount)}? This cannot be undone.`)) return;
    try {
      await api.deleteMonthlyExpense(expense.id);
      setExpenses(await api.fetchMonthlyExpenses());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete expense');
    }
  }

  // `newDocs` are bills picked while editing; `removedDocIds` are existing
  // bills the user took off. Returns an error message for the form, or null.
  async function updateExpense(expense: MonthlyExpense, newDocs: TripDocument[], removedDocIds: string[]): Promise<string | null> {
    try {
      await api.updateMonthlyExpense(expense.id, expense);
      for (const d of removedDocIds) await api.deleteMonthlyExpenseDocument(expense.id, d);
      for (const d of newDocs) if (d.base64) await api.uploadMonthlyExpenseDocument(expense.id, d);
      setExpenses(await api.fetchMonthlyExpenses());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save expense';
    }
  }

  // Fuel posted from the Fuel Expenses tab becomes a diesel line on the chosen
  // trip (and the scanned bill, if any, one of that trip's documents).
  async function postFuel(trip: Trip, line: TripExpenseLine, bill: TripDocument | null): Promise<{ ok: boolean; message: string | null }> {
    try {
      await api.addTripExpense(trip.id, line);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Could not post the fuel entry' };
    }
    let warning: string | null = null;
    if (bill) {
      try { await api.uploadTripDocument(trip.id, bill); } catch { warning = 'The bill photo could not be attached — add it on the trip.'; }
    }
    try { setTrips(await api.fetchTrips()); } catch { /* the entry is saved; the list refreshes on next load */ }
    return { ok: true, message: warning };
  }

  // Fuel saved without a trip (Office assigns the trip later with Edit).
  async function postFuelEntry(vehicle: string, line: TripExpenseLine): Promise<string | null> {
    try {
      await api.createFuelEntry(vehicle, line);
      setFuelEntries(await api.fetchFuelEntries());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save the fuel entry';
    }
  }

  async function updateFuelEntry(id: string, line: TripExpenseLine, tripId?: string): Promise<string | null> {
    try {
      await api.updateFuelEntry(id, line, tripId);
      // Assigning moves it onto the trip, so both lists change.
      await Promise.all([api.fetchFuelEntries().then(setFuelEntries), tripId ? api.fetchTrips().then(setTrips) : Promise.resolve()]);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save the fuel entry';
    }
  }

  async function deleteFuelEntry(id: string): Promise<string | null> {
    try {
      await api.deleteFuelEntry(id);
      setFuelEntries(await api.fetchFuelEntries());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not delete the fuel entry';
    }
  }

  async function updateFuel(trip: Trip, line: TripExpenseLine): Promise<string | null> {
    try {
      await api.updateTripExpense(trip.id, line.id, line);
      setTrips(await api.fetchTrips());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save the fuel entry';
    }
  }

  async function deleteFuel(trip: Trip, line: TripExpenseLine): Promise<string | null> {
    try {
      await api.deleteTripExpense(trip.id, line.id);
      setTrips(await api.fetchTrips());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not delete the fuel entry';
    }
  }

  async function addExpense(expense: MonthlyExpense) {
    try {
      await api.createMonthlyExpense(expense);
      setExpenses(await api.fetchMonthlyExpenses());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add expense');
    }
  }

  // Add-truck / add-driver report failures back to the form itself (returned
  // as a message) rather than the page-top banner, which sits off-screen
  // while someone is filling in a form further down the People page.
  async function addVehicle(vehicle: Vehicle): Promise<string | null> {
    try {
      await api.createVehicle(vehicle);
      setVehicles(await api.fetchVehicles());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not add truck';
    }
  }

  async function editVehicle(id: string, v: api.VehicleEdit): Promise<string | null> {
    try {
      await api.updateVehicle(id, v);
      setVehicles(await api.fetchVehicles());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save truck';
    }
  }

  async function saveMasterSettings(r: Partial<MasterSettings>): Promise<string | null> {
    try {
      setMaster(await api.updateMasterSettings(r));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save rates';
    }
  }

  async function addDriverLeave(l: { driver: string; startsAt: string; endsAt: string; remarks?: string }): Promise<string | null> {
    try {
      await api.createDriverLeave(l);
      setDriverLeaves(await api.fetchDriverLeaves());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save leave';
    }
  }

  async function removeDriverLeave(id: string) {
    try {
      await api.deleteDriverLeave(id);
      setDriverLeaves((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete leave');
    }
  }

  async function addVehicleUnavailability(w: { vehicle: string; startsAt: string; endsAt: string; remarks?: string }): Promise<string | null> {
    try {
      await api.createVehicleUnavailability(w);
      setVehicleUnavailability(await api.fetchVehicleUnavailability());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save unavailability';
    }
  }

  async function editVehicleUnavailability(id: string, w: { vehicle: string; startsAt: string; endsAt: string; remarks?: string }): Promise<string | null> {
    try {
      await api.updateVehicleUnavailability(id, w);
      setVehicleUnavailability(await api.fetchVehicleUnavailability());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save unavailability';
    }
  }

  async function addTransporter(name: string): Promise<string | null> {
    try {
      await api.createTransporter(name);
      setTransporters(await api.fetchTransporters());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not add transporter';
    }
  }

  async function removeTransporter(name: string) {
    try {
      await api.deleteTransporter(name);
      setTransporters((prev) => prev.filter((t) => t !== name));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete transporter');
    }
  }

  async function removeVehicleUnavailability(id: string) {
    try {
      await api.deleteVehicleUnavailability(id);
      setVehicleUnavailability((prev) => prev.filter((w) => w.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete unavailability');
    }
  }

  async function addExpenseCategory(name: string): Promise<string | null> {
    try {
      await api.createExpenseCategory(name);
      setExpenseCategories(await api.fetchExpenseCategories());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not add description';
    }
  }

  async function removeExpenseCategory(name: string) {
    try {
      await api.deleteExpenseCategory(name);
      setExpenseCategories((prev) => prev.filter((c) => c !== name));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete description');
    }
  }

  async function editDriver(name: string, d: { licence: string; expiry: string; credential: string }): Promise<string | null> {
    try {
      await api.updateDriver(name, d);
      setDrivers(await api.fetchDrivers());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save driver';
    }
  }

  async function addUser(u: { name: string; phone: string; role: string; password: string; branchId: string; userId: string }): Promise<string | null> {
    try {
      await api.createUser(u);
      setUsers(await api.fetchUsers());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not create account';
    }
  }

  async function editUser(id: string, u: { name: string; phone: string; role: string; branchId: string; userId: string }): Promise<string | null> {
    try {
      await api.updateUser(id, u);
      setUsers(await api.fetchUsers());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not save account';
    }
  }

  async function changeUserPassword(id: string, password: string): Promise<string | null> {
    try {
      await api.changeUserPassword(id, password);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not change password';
    }
  }

  async function removeVehicle(id: string) {
    try {
      await api.deleteVehicle(id);
      setVehicles(await api.fetchVehicles());
      if (vehicleFilter === id) setVehicleFilter('all');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete truck');
    }
  }

  async function addDriver(driver: DriverMaster): Promise<string | null> {
    try {
      await api.createDriver(driver);
      setDrivers(await api.fetchDrivers());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Could not add driver';
    }
  }

  async function removeDriver(name: string) {
    try {
      await api.deleteDriver(name);
      const [d, v] = await Promise.all([api.fetchDrivers(), api.fetchVehicles()]);
      setDrivers(d);
      setVehicles(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete driver');
    }
  }

  async function removeUser(id: string) {
    try {
      await api.deleteUser(id);
      setUsers(await api.fetchUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete account');
    }
  }

  if (checkingSession) return null;

  if (!authed) {
    return (
      <>
        <SignIn onSignIn={signIn} />
        <PwaInstall />
      </>
    );
  }

  // A viewer can only ever be on their own three screens, whatever sets the tab.
  const shownTab: TabId = role === 'Viewer' && !ROLE_TABS.Viewer.includes(tab) ? ROLE_TABS.Viewer[0] : tab;

  return (
    <>
      <AppShell
        role={role}
        userName={currentUserName}
        tab={shownTab}
        onTabChange={setTab}
        onSignOut={signOut}
        notifications={notifications}
        onOpenNotification={openNotification}
        onMarkAllNotificationsRead={markAllNotificationsRead}
        openMovements={role === 'Viewer' ? undefined : trips.filter((t) => t.status !== 'approved').length}
      >
        {error && (
          <div className="banner" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        {loading && <div className="loading-line"><span className="spinner" /> Loading…</div>}

        {shownTab === 'dashboard' && (
          <Dashboard
            trips={trips}
            expenses={expenses}
            vehicles={vehicles}
            drivers={drivers}
            leaves={driverLeaves}
            unavailability={vehicleUnavailability}
            onTabChange={setTab}
            onEditTrip={startEditingTrip}
            readOnly={role === 'Viewer'}
          />
        )}
        {shownTab === 'summary' && (
          <MovementSummary
            trips={trips}
            expenses={expenses}
            vehicles={vehicles}
            drivers={drivers}
            vehicleFilter={vehicleFilter}
            driverFilter={driverFilter}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onVehicleFilter={setVehicleFilter}
            onDriverFilter={setDriverFilter}
            onDateFrom={setDateFrom}
            onDateTo={setDateTo}
            onResetFilters={resetFilters}
          />
        )}
        {shownTab === 'addtrip' && (
          <AddMovement
            key={role + (editingTrip?.id ?? 'new')}
            onSubmit={submitTrip}
            driverOnly={role === 'Driver'}
            vehicles={vehicles}
            drivers={drivers}
            master={master}
            leaves={driverLeaves}
            unavailability={vehicleUnavailability}
            transporters={transporters}
            defaultDriverName={role === 'Driver' ? currentUserName : undefined}
            editingTrip={editingTrip}
            onCancelEdit={cancelEditingTrip}
          />
        )}
        {shownTab === 'fuel' && (
          <FuelExpenses trips={trips} vehicles={vehicles} drivers={drivers} master={master} role={role} dateFrom={dateFrom} dateTo={dateTo} onDateFrom={setDateFrom} onDateTo={setDateTo} onResetFilters={resetFilters} onPost={postFuel} onUpdate={updateFuel} onDelete={deleteFuel}
            unassigned={fuelEntries} onPostUnassigned={postFuelEntry} onUpdateUnassigned={updateFuelEntry} onDeleteUnassigned={deleteFuelEntry} />
        )}
        {shownTab === 'triplog' && (
          <TripLog
            trips={trips}
            vehicles={vehicles}
            drivers={drivers}
            leaves={driverLeaves}
            unavailability={vehicleUnavailability}
            vehicleFilter={vehicleFilter}
            driverFilter={driverFilter}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onVehicleFilter={setVehicleFilter}
            onDriverFilter={setDriverFilter}
            onDateFrom={setDateFrom}
            onDateTo={setDateTo}
            onResetFilters={resetFilters}
            onAddMovement={() => { setEditingTrip(null); setTab('addtrip'); }}
            onApprove={approveTrip}
            onBackup={backupEverything}
            onEdit={startEditingTrip}
            onDelete={deleteTrip}
            role={role}
          />
        )}
        {shownTab === 'expenses' && (
          <MonthlyExpenses
            expenses={expenses}
            trips={trips}
            vehicles={vehicles}
            drivers={drivers}
            categories={expenseCategories}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFrom={setDateFrom}
            onDateTo={setDateTo}
            onResetFilters={resetFilters}
            onAdd={addExpense}
            onUpdate={updateExpense}
            onDelete={deleteMonthlyExpense}
          />
        )}
        {shownTab === 'report' && (
          <MonthlyReport
            trips={trips}
            expenses={expenses}
            vehicles={vehicles}
            drivers={drivers}
            vehicleFilter={vehicleFilter}
            driverFilter={driverFilter}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onVehicleFilter={setVehicleFilter}
            onDriverFilter={setDriverFilter}
            onDateFrom={setDateFrom}
            onDateTo={setDateTo}
            onResetFilters={resetFilters}
          />
        )}
        {shownTab === 'people' && (
          <People
            vehicles={vehicles}
            drivers={drivers}
            users={users}
            onAddUser={addUser}
            onAddVehicle={addVehicle}
            onRemoveVehicle={removeVehicle}
            onAddDriver={addDriver}
            onUpdateVehicle={editVehicle}
            onUpdateDriver={editDriver}
            onUpdateUser={editUser}
            onChangeUserPassword={changeUserPassword}
            onRemoveDriver={removeDriver}
            onRemoveUser={removeUser}
            canDeleteAccounts={role === 'Manager'}
            canEditAccounts={role === 'Manager'}
          />
        )}
        {shownTab === 'master' && (
          <Master
            vehicles={vehicles}
            drivers={drivers}
            settings={master}
            onSave={saveMasterSettings}
            onSetDefaultDriver={(vehicleId, driver) => editVehicle(vehicleId, { defaultDriver: driver })}
            leaves={driverLeaves}
            onAddLeave={addDriverLeave}
            onRemoveLeave={removeDriverLeave}
            unavailability={vehicleUnavailability}
            onAddUnavailability={addVehicleUnavailability}
            onUpdateUnavailability={editVehicleUnavailability}
            onRemoveUnavailability={removeVehicleUnavailability}
            transporters={transporters}
            onAddTransporter={addTransporter}
            onRemoveTransporter={removeTransporter}
            categories={expenseCategories}
            onAddCategory={addExpenseCategory}
            onRemoveCategory={removeExpenseCategory}
            isManager={role === 'Manager'}
          />
        )}
        {shownTab === 'movements' && (
          <Movements
            trips={trips}
            role={role}
            onAddMovement={() => { setEditingTrip(null); setTab('addtrip'); }}
            onEdit={startEditingTrip}
            onDelete={deleteTrip}
            onOpenTripLog={() => setTab('triplog')}
          />
        )}
        {shownTab === 'schema' && <DataModel />}
        {shownTab === 'settings' && <SettingsPage role={role} userName={currentUserName} onSignOut={signOut} onTabChange={setTab} />}
        {shownTab === 'help' && <HelpPage role={role} />}
      </AppShell>
      <PwaInstall />
    </>
  );
}
