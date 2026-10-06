import { useEffect, useState } from 'react';
import { fetchBackupStatus, runBackupNow, type BackupStatus } from '../lib/api';

const STALE_AFTER_HOURS = 36;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Manager-only: shows that the nightly backup is actually running.
export function BackupPanel() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');

  async function refresh() {
    try {
      setStatus(await fetchBackupStatus());
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load backup status');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function backupNow() {
    setRunning(true);
    setRunError('');
    try {
      await runBackupNow();
      await refresh();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'The backup did not complete');
      await refresh();
    } finally {
      setRunning(false);
    }
  }

  const latest = status?.latest ?? null;
  const ageHours = latest ? (Date.now() - new Date(latest.finishedAt).getTime()) / 3_600_000 : null;
  const stale = ageHours !== null && ageHours > STALE_AFTER_HOURS;

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 24, background: 'var(--color-surface)' }}>
      <h2 style={{ fontSize: 'var(--fs-section)', marginBottom: 6 }}>Data backup</h2>
      <p style={{ color: 'var(--color-neutral-700)', fontSize: 13, marginBottom: 14 }}>
        A copy of all data is saved automatically every night and the last {status?.keepDays ?? 30} days are kept.
      </p>

      {loadError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13, marginBottom: 10 }}>{loadError}</div>}

      {status && (
        <div style={{ display: 'grid', gap: 6, fontSize: 14, marginBottom: 14 }}>
          {latest ? (
            <div>
              Last backup: <strong>{formatWhen(latest.finishedAt)}</strong> · {latest.totalRows.toLocaleString('en-IN')} records · {formatBytes(latest.bytes)}
              {latest.files.total > 0 && <> · {latest.files.total} uploaded files</>}
            </div>
          ) : (
            <div style={{ color: 'var(--color-accent-700)', fontWeight: 600 }}>No backup has run yet.</div>
          )}
          {stale && (
            <div role="alert" style={{ color: 'var(--color-accent-700)', fontWeight: 600 }}>
              The last backup is more than a day old — the nightly backup may not be running. Press "Back up now" and tell the developer if it keeps happening.
            </div>
          )}
          {status.lastError && (
            <div role="alert" style={{ color: 'var(--color-accent-700)' }}>
              The most recent backup attempt failed ({formatWhen(status.lastError.at)}): {status.lastError.message}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={backupNow} disabled={running}>{running ? 'Backing up…' : 'Back up now'}</button>
        {runError && <span role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{runError}</span>}
      </div>
    </div>
  );
}
