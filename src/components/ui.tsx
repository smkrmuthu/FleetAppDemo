// Shared building blocks for every Fleet Ledger screen. They only arrange
// markup and pick classes from index.css — colours, sizes and spacing come
// from the design tokens there, never from values written in here.
import { useEffect, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import type { TripStatus } from '../types';

// Inline-style equivalent of the .card class, for screens that build their
// panels with style objects.
export const PANEL: CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)'
};

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function SectionHeading({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {aside && <div className="muted">{aside}</div>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; size?: 'sm' | 'md' };

function buttonClass(kind: string, size: ButtonProps['size'], extra?: string) {
  return ['btn', `btn-${kind}`, size === 'sm' ? 'btn-sm' : '', extra ?? ''].filter(Boolean).join(' ');
}

export function PrimaryButton({ icon, size, className, children, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass('primary', size, className)} {...rest}>{icon}{children}</button>;
}

export function SecondaryButton({ icon, size, className, children, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass('secondary', size, className)} {...rest}>{icon}{children}</button>;
}

export function GhostButton({ icon, size, className, children, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass('ghost', size, className)} {...rest}>{icon}{children}</button>;
}

export function FormField({ label, htmlFor, hint, children, span2 }: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? 'field field-span-2' : 'field'}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function FilterBar({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="card filter-bar" style={style}>
      <div className="filters-grid">{children}</div>
    </div>
  );
}

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export function StatusBadge({ tone = 'neutral', dot, children, title }: { tone?: Tone; dot?: boolean; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${tone}${dot ? ' badge-dot' : ''}`} title={title}>{children}</span>;
}

const TRIP_STATUS: Record<TripStatus, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  pending: { tone: 'warning', label: 'Pending approval' },
  approved: { tone: 'success', label: 'Approved' }
};

export function TripStatusBadge({ status, short }: { status: TripStatus; short?: boolean }) {
  const s = TRIP_STATUS[status] ?? TRIP_STATUS.draft;
  return <StatusBadge tone={s.tone} dot>{short && status === 'pending' ? 'Pending' : s.label}</StatusBadge>;
}

export function KpiCard({ label, value, unit, sub, icon }: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="card kpi-card">
      <div className="kpi-label">{icon}{label}</div>
      <div className="kpi-value">{value}{unit && <span className="kpi-unit">{unit}</span>}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// A bordered, horizontally scrolling table container. Pass the <table> rows as
// children; column alignment is the caller's (use className="num" on numbers).
export function DataTable({ children, minWidth, style }: { children: ReactNode; minWidth?: number; style?: CSSProperties }) {
  return (
    <div className="table-wrap" style={style}>
      <table className="table" style={minWidth ? { minWidth } : undefined}>{children}</table>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="card empty-state">{children}</div>;
}

export function AttentionCard({ tone, icon, title, count, description, children, footer }: {
  tone: Tone;
  icon?: ReactNode;
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="card attention-card" data-tone={tone}>
      <div className="attention-head">
        <div className="attention-title">{icon}{title}</div>
        {count !== undefined && <StatusBadge tone={tone}>{count}</StatusBadge>}
      </div>
      {description && <div className="attention-desc">{description}</div>}
      {children}
      {footer}
    </div>
  );
}

export function ChartCard({ title, subtitle, legend, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: { label: string; color: string }[];
  children: ReactNode;
}) {
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div className="card-title">{title}</div>
        {subtitle && <div className="chart-sub">{subtitle}</div>}
      </div>
      {legend && legend.length > 0 && (
        <div className="chart-legend">
          {legend.map((l) => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}
        </div>
      )}
      {children}
    </div>
  );
}

// Overlay dialog: closes on Escape and on a click outside the panel unless
// `locked` (e.g. while a save is in flight).
export function Modal({ label, onClose, locked, maxWidth = 760, children }: {
  label: string;
  onClose: () => void;
  locked?: boolean;
  maxWidth?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !locked) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, locked]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}
