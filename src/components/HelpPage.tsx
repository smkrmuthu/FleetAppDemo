import type { Role, TabId } from '../types';
import { ROLE_TABS, TAB_LABELS } from '../data/mockData';
import { DataTable, PageHeader } from './ui';

const GUIDE: { section: string; items: [TabId, string][] }[] = [
  {
    section: 'Overview',
    items: [['dashboard', 'Headline numbers for a period, the fleet performance table, charts and what needs attention today.']]
  },
  {
    section: 'Operations',
    items: [
      ['movements', 'Movements still in progress — drafts and trips waiting for approval. Start a new one with "+ Add Movement".'],
      ['triplog', 'Every movement for the period. Expand a row for its stops and expenses; complete, approve or export from here.'],
      ['fuel', 'Diesel fills by truck. Post a fill to a trip, or save it unassigned and attach it later.']
    ]
  },
  {
    section: 'Reports',
    items: [
      ['summary', 'Movement totals by truck and driver for the selected period.'],
      ['expenses', 'Fixed costs — permits, insurance, EMI, maintenance — with their bills.'],
      ['report', 'The month-end report: income, trip costs and fixed costs per truck.']
    ]
  },
  {
    section: 'Management',
    items: [
      ['people', 'Trucks, drivers and sign-in accounts.'],
      ['master', 'Rates, loading point, transporters, expense descriptions, leave and truck availability.'],
      ['schema', 'How the data is organised, for anyone connecting reports or exports.']
    ]
  }
];

const ROLES: { role: Role; summary: string }[] = [
  { role: 'Manager', summary: 'Everything, including approvals, corrections to completed movements, accounts and masters.' },
  { role: 'Office', summary: 'Adds and completes movements, records monthly expenses and runs reports.' },
  { role: 'Driver', summary: 'Adds their own movements on the road and completes them.' },
  { role: 'Viewer', summary: 'Read-only access to the dashboard and reports.' }
];

export function HelpPage({ role }: { role: Role }) {
  const allowed = ROLE_TABS[role];
  return (
    <section>
      <PageHeader eyebrow="Help" title="Using Fleet Ledger" description="A short guide to each screen you can open, and what each role is allowed to do." />

      <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: 960 }}>
        {GUIDE.map((g) => {
          const items = g.items.filter(([t]) => allowed.includes(t));
          if (items.length === 0) return null;
          return (
            <div key={g.section} className="card card-pad" style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <div className="card-title">{g.section}</div>
              <ul className="prose-list">
                {items.map(([t, text]) => <li key={t}><strong>{TAB_LABELS[t]}</strong> — {text}</li>)}
              </ul>
            </div>
          );
        })}

        <div>
          <div className="card-title" style={{ margin: 'var(--space-4) 0 var(--space-3)' }}>Roles</div>
          <DataTable>
            <thead><tr><th style={{ width: 140 }}>Role</th><th>What it can do</th></tr></thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r.role}>
                  <td className="cell-strong">{r.role}{r.role === role ? ' (you)' : ''}</td>
                  <td style={{ color: 'var(--color-text-secondary)' }}>{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </div>
    </section>
  );
}
