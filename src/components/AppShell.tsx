import { useEffect, useState, type ReactNode } from 'react';
import {
  ChartColumn, CircleHelp, ClipboardList, Database, FileText, Fuel, LayoutDashboard, LogOut, Menu, Receipt,
  Settings, SlidersHorizontal, Truck, Users, X, type LucideIcon
} from 'lucide-react';
import type { AppNotification, Role, TabId } from '../types';
import { ROLE_TABS, TAB_LABELS } from '../data/mockData';
import { NotificationBell } from './NotificationBell';
import { BrandMark } from './Brand';

interface Props {
  role: Role;
  userName: string;
  tab: TabId;
  onTabChange: (t: TabId) => void;
  onSignOut: () => void;
  notifications: AppNotification[];
  onOpenNotification: (n: AppNotification) => void;
  onMarkAllNotificationsRead: () => void;
  // Shown as a count next to "Movements" in the sidebar.
  openMovements?: number;
  children: ReactNode;
}

interface NavSection { label?: string; items: TabId[] }

// Where each screen sits in the sidebar. Screens a role can't open are left out.
const NAV: NavSection[] = [
  { items: ['dashboard'] },
  { label: 'Operations', items: ['movements', 'triplog', 'fuel'] },
  { label: 'Reports', items: ['summary', 'expenses', 'report'] },
  { label: 'Management', items: ['people', 'master', 'schema'] }
];
const NAV_FOOTER: TabId[] = ['settings', 'help'];

const ICONS: Partial<Record<TabId, LucideIcon>> = {
  dashboard: LayoutDashboard,
  movements: Truck,
  triplog: ClipboardList,
  fuel: Fuel,
  summary: ChartColumn,
  expenses: Receipt,
  report: FileText,
  people: Users,
  master: SlidersHorizontal,
  schema: Database,
  settings: Settings,
  help: CircleHelp
};

// The Add / Edit Movement form isn't in the sidebar; while it's open,
// "Movements" is the highlighted section.
function navTabFor(tab: TabId): TabId {
  return tab === 'addtrip' ? 'movements' : tab;
}

function sectionOf(tab: TabId): string | undefined {
  return NAV.find((s) => s.items.includes(navTabFor(tab)))?.label;
}

function initials(name: string): string {
  return name.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

function Sidebar({ role, tab, onSelect, openMovements, onClose }: {
  role: Role;
  tab: TabId;
  onSelect: (t: TabId) => void;
  openMovements?: number;
  onClose: () => void;
}) {
  const allowed = ROLE_TABS[role];
  const current = navTabFor(tab);

  const item = (t: TabId) => {
    const Icon = ICONS[t];
    const label = TAB_LABELS[t];
    return (
      <button
        key={t}
        type="button"
        className="nav-item"
        aria-current={current === t ? 'page' : undefined}
        title={label}
        onClick={() => onSelect(t)}
      >
        {Icon && <Icon size={17} strokeWidth={1.75} aria-hidden="true" />}
        <span className="nav-label">{label}</span>
        {t === 'movements' && !!openMovements && <span className="nav-badge">{openMovements}</span>}
      </button>
    );
  };

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <BrandMark size={32} />
        <div className="sidebar-brand-text" style={{ flex: 1, minWidth: 0 }}>
          <div className="sidebar-brand-name">Fleet Ledger</div>
          <div className="sidebar-brand-sub">Demo Logistics</div>
        </div>
        <button type="button" className="btn btn-icon menu-toggle" aria-label="Close menu" onClick={onClose} style={{ color: 'var(--color-sidebar-text)' }}>
          <X size={18} />
        </button>
      </div>
      <nav className="sidebar-scroll">
        {NAV.map((section, i) => {
          const items = section.items.filter((t) => allowed.includes(t));
          if (items.length === 0) return null;
          return (
            <div key={section.label ?? i} className="sidebar-section">
              {section.label && <div className="sidebar-section-label">{section.label}</div>}
              {items.map(item)}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-footer">{NAV_FOOTER.filter((t) => allowed.includes(t)).map(item)}</div>
    </aside>
  );
}

function TopHeader({ role, userName, tab, onMenu, onSignOut, notifications, onOpenNotification, onMarkAllNotificationsRead }: {
  role: Role;
  userName: string;
  tab: TabId;
  onMenu: () => void;
  onSignOut: () => void;
  notifications: AppNotification[];
  onOpenNotification: (n: AppNotification) => void;
  onMarkAllNotificationsRead: () => void;
}) {
  const section = sectionOf(tab);
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="btn btn-icon menu-toggle" aria-label="Open menu" onClick={onMenu}>
          <Menu size={20} />
        </button>
        <div className="topbar-crumb">
          {section && <>{section} <span aria-hidden="true">/</span> </>}
          <strong>{TAB_LABELS[tab]}</strong>
        </div>
      </div>
      <div className="topbar-right">
        {role !== 'Driver' && role !== 'Viewer' && (
          <NotificationBell notifications={notifications} onOpen={onOpenNotification} onMarkAllRead={onMarkAllNotificationsRead} />
        )}
        <div className="topbar-divider" />
        <div className="topbar-user">
          <div className="avatar" aria-hidden="true">{initials(userName)}</div>
          <div className="topbar-user-text">
            <div className="topbar-user-name">{userName}</div>
            <div className="topbar-user-role">{role}</div>
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onSignOut} aria-label="Sign out">
          <LogOut size={14} aria-hidden="true" /><span className="topbar-signout-label">Sign out</span>
        </button>
      </div>
    </header>
  );
}

export function AppShell({
  role, userName, tab, onTabChange, onSignOut, notifications, onOpenNotification, onMarkAllNotificationsRead, openMovements, children
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A fresh screen starts at the top, and the phone drawer closes behind it.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setDrawerOpen(false);
  }, [tab]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="app-layout" data-drawer={drawerOpen ? 'open' : 'closed'}>
      <Sidebar role={role} tab={tab} onSelect={onTabChange} openMovements={openMovements} onClose={() => setDrawerOpen(false)} />
      <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />
      <div className="app-main">
        <TopHeader
          role={role}
          userName={userName}
          tab={tab}
          onMenu={() => setDrawerOpen(true)}
          onSignOut={onSignOut}
          notifications={notifications}
          onOpenNotification={onOpenNotification}
          onMarkAllNotificationsRead={onMarkAllNotificationsRead}
        />
        <main className="app-shell-main">{children}</main>
        <footer className="app-footer">
          <span>© {new Date().getFullYear()} Fleet Ledger Demo · Sample data only</span>
          <span>Fleet Ledger · Goods movement &amp; expense log</span>
        </footer>
      </div>
    </div>
  );
}
