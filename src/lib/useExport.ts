import { useState } from 'react';

// Runs an export while showing which button is busy, and turns a failure into
// a short message. Dismissing the Android share sheet isn't an error.
export function useExport() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function run(key: string, job: () => Promise<void>) {
    setError('');
    setBusy(key);
    try {
      await job();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) setError('Could not create the file — please try again.');
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, run };
}
