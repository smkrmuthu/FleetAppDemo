import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import type { AppNotification } from '../types';

interface Props {
  notifications: AppNotification[];
  onOpen: (n: AppNotification) => void;
  onMarkAllRead: () => void;
}

export function NotificationBell({ notifications, onOpen, onMarkAllRead }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-icon"
        aria-expanded={open}
        style={{ position: 'relative', background: open ? 'var(--color-table-header)' : undefined }}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span
            style={{
              position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
              background: 'var(--color-primary)', color: '#fff', fontSize: 10, fontWeight: 600, display: 'flex',
              alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px var(--color-surface)'
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: 44, width: 'min(340px, calc(100vw - 24px))', background: 'var(--color-surface)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden',
            zIndex: 20, boxShadow: 'var(--shadow-overlay)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Notifications</span>
            {unread > 0 && (
              <button type="button" className="btn btn-ghost" style={{ padding: 0, fontSize: 12 }} onClick={onMarkAllRead}>Mark all read</button>
            )}
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {notifications.length === 0 && (
              <div style={{ padding: '18px 14px', color: 'var(--color-neutral-700)', fontSize: 13 }}>No notifications.</div>
            )}
            {notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  onOpen(n);
                  setOpen(false);
                }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', appearance: 'none', border: 0,
                  borderBottom: '1px solid var(--color-border)', background: n.read ? 'transparent' : 'var(--color-info-soft)',
                  padding: '10px 14px', cursor: 'pointer', font: 'inherit'
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-info)', flex: 'none', marginTop: 5 }} />}
                  <span style={{ fontSize: 13, lineHeight: 1.4 }}>{n.message}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 4, marginLeft: n.read ? 0 : 15 }}>{n.createdAt}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
