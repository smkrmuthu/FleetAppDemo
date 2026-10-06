import { Capacitor } from '@capacitor/core';

/**
 * Registers the PWA service worker so the site is installable ("Add to Home
 * Screen") on Android Chrome and iOS Safari. Skipped inside the Capacitor
 * native apps — they already have a real home-screen icon via the OS.
 */
export function registerServiceWorker(): void {
  if (Capacitor.isNativePlatform()) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    const scope = new URL('.', document.baseURI).toString();
    const swUrl = new URL('sw.js', document.baseURI).toString();
    navigator.serviceWorker
      .register(swUrl, { scope })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          // A worker was already active *before* this new one showed up —
          // this is a later deploy taking over, not the page's very first
          // install, so it's the one case worth telling the user about.
          const isUpdate = !!registration.active;
          newWorker.addEventListener('statechange', () => {
            if (isUpdate && newWorker.state === 'activated') {
              window.dispatchEvent(new CustomEvent('fleetledger:update-ready'));
            }
          });
        });
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}
