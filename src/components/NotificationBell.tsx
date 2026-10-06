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
        style={{
          appearance: 'none', border: '2px solid var(--color-text)', background: open ? 'var(--color-text)' : 'transparent',
          color: open ? 'var(--color-bg)' : 'var(--color-text)', width: 36, height: 36, display: 'grid', placeItems: 'center',
          cursor: 'pointer', position: 'relative'
        }}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            style={{
              position: 'absolute', top: -8, right: -8, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9,
              background: 'var(--color-accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex',
              alignItems: 'center', justifyContent: 'center', border: '2px solid var(--color-bg)'
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: 44, width: 340, background: 'var(--color-bg)', border: '2px solid var(--color-text)',
            zIndex: 20, boxShadow: '0 8px 24px rgba(0,0,0,0.18)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '2px solid var(--color-divider)' }}>
            <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-neutral-700)' }}>Notifications</span>
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
                  borderBottom: '1px solid var(--color-neutral-300)', background: n.read ? 'transparent' : 'var(--color-accent-100)',
                  padding: '10px 14px', cursor: 'pointer', font: 'inherit'
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)', flex: 'none', marginTop: 5 }} />}
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
