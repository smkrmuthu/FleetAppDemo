import { useEffect, useRef, useState } from 'react';

export interface DialogField {
  key: string;
  label: string;
  type?: 'text' | 'tel' | 'date' | 'select';
  options?: { value: string; label: string }[];
  // Shown in view mode; what the form starts from is `value`.
  display: string;
  value: string;
  // Read-only fields still show in edit mode, greyed out, with a reason.
  locked?: boolean;
  hint?: string;
  required?: boolean;
  // Informational rows (e.g. last active) that only appear in view mode.
  viewOnly?: boolean;
  // Shown beside the value in view mode, e.g. "Due in 10 days".
  flag?: { label: string; expired: boolean } | null;
}

interface Props {
  title: string;
  subtitle?: string;
  fields: DialogField[];
  startInEdit: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSave: (values: Record<string, string>) => Promise<string | null>;
}

export function RecordDialog({ title, subtitle, fields, startInEdit, canEdit, onClose, onSave }: Props) {
  const [editing, setEditing] = useState(startInEdit && canEdit);
  const editable = fields.filter((f) => !f.viewOnly);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(editable.map((f) => [f.key, f.value])));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = 'record-dialog-title';

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const target = panelRef.current?.querySelector<HTMLElement>(editing ? 'input:not([disabled]), select:not([disabled])' : 'button');
    target?.focus();
  }, [editing]);

  function cancelEdit() {
    setValues(Object.fromEntries(editable.map((f) => [f.key, f.value])));
    setError('');
    if (startInEdit) onClose();
    else setEditing(false);
  }

  async function save() {
    const missing = editable.find((f) => f.required && !f.locked && !values[f.key].trim());
    if (missing) {
      setError(`${missing.label} can't be empty.`);
      return;
    }
    setSaving(true);
    setError('');
    const err = await onSave(values);
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(32,30,29,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !editing) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ background: 'var(--color-bg)', border: '2px solid var(--color-text)', width: '100%', maxWidth: 520 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '18px 20px 14px', borderBottom: '2px solid var(--color-divider)' }}>
          <div>
            <div className="kicker">{editing ? 'Edit' : 'Details'}</div>
            <h2 id={titleId} style={{ fontSize: 22, letterSpacing: '-0.01em', marginTop: 2 }}>{title}</h2>
            {subtitle && <div style={{ color: 'var(--color-neutral-700)', fontSize: 13, marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button type="button" className="btn btn-ghost" aria-label="Close" onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {editing ? (
            <form
              style={{ display: 'grid', gap: 14 }}
              onSubmit={(e) => { e.preventDefault(); save(); }}
            >
              {editable.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`rd-${f.key}`}>{f.label}{f.required && !f.locked ? ' *' : ''}</label>
                  {f.type === 'select' ? (
                    <select
                      id={`rd-${f.key}`}
                      className="input"
                      disabled={f.locked}
                      value={values[f.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    >
                      {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      id={`rd-${f.key}`}
                      className="input"
                      type={f.type ?? 'text'}
                      disabled={f.locked}
                      value={values[f.key]}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  )}
                  {f.hint && <div style={{ color: 'var(--color-neutral-700)', fontSize: 12, marginTop: 4 }}>{f.hint}</div>}
                </div>
              ))}
              {error && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                <button type="button" className="btn btn-ghost" disabled={saving} onClick={cancelEdit}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <dl style={{ margin: 0, display: 'grid', gap: 0 }}>
                {fields.map((f) => (
                  <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--color-neutral-300)' }}>
                    <dt style={{ color: 'var(--color-neutral-700)', fontSize: 13 }}>{f.label}</dt>
                    <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere' }}>
                      {f.display || '—'}
                      {f.flag && <span className={f.flag.expired ? 'tag tag-accent' : 'tag tag-outline'} style={{ marginLeft: 8 }}>{f.flag.label}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
              <div style={{ display: 'flex', gap: 10, paddingTop: 18 }}>
                {canEdit && <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>}
                <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
