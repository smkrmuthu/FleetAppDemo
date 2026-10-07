import { useState } from 'react';
import { BrandMark, TruckArt } from './Brand';
import { FormField } from './ui';

interface Props {
  onSignIn: (identifier: string, password: string) => Promise<void>;
}

export function SignIn({ onSignIn }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function attempt(p: string, pw: string) {
    setError('');
    setBusy(true);
    try {
      await onSignIn(p, pw);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sign-in-grid">
      <div className="sign-in-brand">
        <div className="sign-in-brand-mark">
          <BrandMark size={42} />
          <div>
            <div className="sidebar-brand-name" style={{ fontSize: 18 }}>Fleet Ledger</div>
            <div className="sidebar-brand-sub" style={{ fontSize: 12 }}>Demo Logistics</div>
          </div>
        </div>
        <div className="sign-in-hero">
          <h2 className="sign-in-headline">
            <span>Every trip.</span>
            <span>Every rupee.</span>
            <span>One ledger.</span>
          </h2>
          <p className="sign-in-copy">
            Track every trip, fuel stop, and expense across your fleet — from the road to the ledger.
          </p>
        </div>
        <div className="sign-in-road">
          <TruckArt />
          <div className="sign-in-lane" />
          <div className="sign-in-foot">
            <span>Demo account · sample data only</span>
            <span>Powered by <strong style={{ color: 'var(--color-sidebar-text)', fontWeight: 600 }}>OneupTech</strong></span>
          </div>
        </div>
      </div>

      <div className="sign-in-form-panel">
        <div className="sign-in-form">
          <h1 style={{ marginBottom: 6 }}>Welcome back</h1>
          <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 28px' }}>Sign in to your Fleet Ledger account.</p>

          <form
            style={{ display: 'grid', gap: 18 }}
            onSubmit={(e) => {
              e.preventDefault();
              attempt(identifier, pass);
            }}
          >
            <FormField label="Mobile number or User ID" htmlFor="signin-id">
              <input id="signin-id" className="input" type="text" autoComplete="username" placeholder="Mobile number or User ID" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus />
            </FormField>
            <FormField label="Password" htmlFor="signin-password">
              <input id="signin-password" className="input" type="password" autoComplete="current-password" placeholder="••••••••" value={pass} onChange={(e) => setPass(e.target.value)} />
            </FormField>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" defaultChecked style={{ accentColor: 'var(--color-primary)' }} />
              <span>Keep me signed in on this device</span>
            </label>
            {error && <div role="alert" className="banner" style={{ margin: 0 }}>{error}</div>}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <a href="#reset">Forgot password</a>
              <a href="#otp">Sign in with OTP instead</a>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
