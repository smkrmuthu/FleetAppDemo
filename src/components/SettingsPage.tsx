import { LogOut } from 'lucide-react';
import type { Role, TabId } from '../types';
import { ROLE_TABS } from '../data/mockData';
import { PageHeader, SecondaryButton, StatusBadge } from './ui';

interface Props {
  role: Role;
  userName: string;
  onSignOut: () => void;
  onTabChange: (t: TabId) => void;
}

const ROLE_ACCESS: Record<Role, string> = {
  Manager: 'Every screen, approvals, month close, accounts and masters.',
  Office: 'Movements, the Trip Log, monthly expenses and reports.',
  Driver: 'Your own movements: add them on the road and complete them.',
  Viewer: 'Read-only: the dashboard and reports. Nothing can be changed.'
};

// Display-only: who is signed in and where each kind of setting lives.
// Nothing here writes data.
export function SettingsPage({ role, userName, onSignOut, onTabChange }: Props) {
  const can = (t: TabId) => ROLE_TABS[role].includes(t);
  return (
    <section>
      <PageHeader eyebrow="Account" title="Settings" description="Your account on this device, and where the shared settings for the fleet are managed." />

      <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: 880 }}>
        <div className="card card-pad" style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div className="card-title">Your account</div>
          <div className="info-grid">
            <div className="info-item"><div className="label">Name</div><div className="value">{userName || '—'}</div></div>
            <div className="info-item"><div className="label">Role</div><div className="value"><StatusBadge tone="info">{role}</StatusBadge></div></div>
            <div className="info-item"><div className="label">Organisation</div><div className="value">Demo Logistics</div></div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{ROLE_ACCESS[role]}</div>
          <div>
            <SecondaryButton icon={<LogOut size={15} />} onClick={onSignOut}>Sign out of this device</SecondaryButton>
          </div>
        </div>

        {(can('master') || can('people')) && (
          <div className="card card-pad" style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <div className="card-title">Fleet settings</div>
            <ul className="prose-list">
              {can('master') && <li><strong>Masters</strong> — diesel and AdBlue rates, the loading point, transporters, expense descriptions, driver leave and truck availability.</li>}
              {can('people') && <li><strong>People</strong> — trucks, drivers and sign-in accounts.</li>}
            </ul>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {can('master') && <SecondaryButton onClick={() => onTabChange('master')}>Open Masters</SecondaryButton>}
              {can('people') && <SecondaryButton onClick={() => onTabChange('people')}>Open People</SecondaryButton>}
            </div>
          </div>
        )}

        <div className="card card-pad" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div className="card-title">Install on a phone or computer</div>
          <ul className="prose-list">
            <li><strong>Android / Chrome</strong> — open the browser menu and choose <em>Install app</em>.</li>
            <li><strong>iPhone / iPad</strong> — tap Share, then <em>Add to Home Screen</em>.</li>
            <li><strong>Desktop</strong> — use the install icon at the right of the address bar.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
