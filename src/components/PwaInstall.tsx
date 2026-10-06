import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

const DISMISS_KEY = 'fleet_ledger_install_dismissed_at';
const DISMISS_COOLDOWN_DAYS = 14;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !('MSStream' in window);
}

function dismissedRecently(): boolean {
  const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return at > 0 && Date.now() - at < DISMISS_COOLDOWN_DAYS * 86_400_000;
}

// The banner strip shared by both the install prompt and the update notice
// (never both — an update taking over is the more useful thing to surface).
function Banner({ children, onDismiss }: { children: React.ReactNode; onDismiss?: () => void }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        flexWrap: 'wrap', padding: '10px 16px calc(10px + env(safe-area-inset-bottom))', background: 'var(--color-text)', color: 'var(--color-bg)',
        fontSize: 13
      }}
    >
      {children}
      {onDismiss && (
        <button type="button" className="btn btn-ghost" onClick={onDismiss} style={{ color: 'var(--color-bg)', padding: '2px 8px' }} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

// Handles three independent, mutually-exclusive-in-practice situations:
//  - Android / desktop Chrome: capture beforeinstallprompt and offer a real
//    one-tap install button.
//  - iOS Safari: there's no programmatic prompt at all, so this can only
//    ever show the manual "Share > Add to Home Screen" steps.
//  - Either platform, already installed: a newer version has taken over the
//    service worker and the open tab is still running the old JS bundle.
// Skipped entirely inside the Capacitor native apps, which install through
// the OS's own app store instead.
export function PwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform() || isStandalone()) return;

    if (isIos()) {
      if (!dismissedRecently()) setShowIosHint(true);
    } else {
      const onPrompt = (e: Event) => {
        e.preventDefault();
        if (!dismissedRecently()) setDeferredPrompt(e as BeforeInstallPromptEvent);
      };
      window.addEventListener('beforeinstallprompt', onPrompt);
      window.addEventListener('appinstalled', () => setDeferredPrompt(null));
      return () => window.removeEventListener('beforeinstallprompt', onPrompt);
    }
  }, []);

  useEffect(() => {
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener('fleetledger:update-ready', onUpdate);
    return () => window.removeEventListener('fleetledger:update-ready', onUpdate);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDeferredPrompt(null);
    setShowIosHint(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    setInstalling(true);
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setInstalling(false);
    setDeferredPrompt(null);
  }

  // A new version taking over always wins over an install nudge — refreshing
  // is the one thing actually worth interrupting for.
  if (updateReady) {
    return (
      <Banner>
        <span>A new version of Fleet Ledger is ready.</span>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Refresh</button>
      </Banner>
    );
  }

  if (deferredPrompt) {
    return (
      <Banner onDismiss={dismiss}>
        <span>Install Fleet Ledger for one-tap access from your home screen.</span>
        <button type="button" className="btn btn-primary" onClick={install} disabled={installing}>
          {installing ? 'Installing…' : 'Install'}
        </button>
      </Banner>
    );
  }

  if (showIosHint) {
    return (
      <Banner onDismiss={dismiss}>
        <span>Install Fleet Ledger: tap the Share icon, then "Add to Home Screen".</span>
      </Banner>
    );
  }

  return null;
}

// Chrome's install prompt event isn't in TypeScript's lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
