import { useState } from 'react';
import logoFleetWhite from '../assets/logo-fleet-white.png';

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
      <div className="sign-in-brand" style={{ background: 'var(--color-accent)', color: '#fff' }}>
        <img src={logoFleetWhite} alt="" className="sign-in-watermark-fleet" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 28, letterSpacing: '0.02em', textTransform: 'uppercase' }}>Demo Logistics</div>
          <div className="sign-in-divider" style={{ width: 2, alignSelf: 'stretch', background: '#fff', opacity: 0.6 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={logoFleetWhite} alt="" style={{ height: 34, width: 'auto' }} />
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18, letterSpacing: '0.02em', textTransform: 'uppercase' }}>Fleet Ledger</div>
          </div>
        </div>
        <div style={{ alignSelf: 'center' }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 'clamp(32px, 6.4vw, 72px)', lineHeight: 1.02, letterSpacing: '-0.03em' }}>
            Every trip, every rupee, one ledger.
          </div>
          <div style={{ height: 2, background: '#fff', opacity: 0.6, margin: '24px 0 18px', maxWidth: 340 }} />
          <div style={{ fontSize: 15, lineHeight: 1.6, maxWidth: '44ch' }}>
            Track every trip, fuel stop, and expense across your fleet — from the road to the ledger, in one place for your whole team.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.85 }}>Demo Logistics · Demo account</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.7 }}>
            <span>Powered by</span>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 9.5L7 3l5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontWeight: 700 }}>OneupTech</span>
          </div>
        </div>
      </div>

      <div className="sign-in-form-panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <h1 style={{ fontSize: 32, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Sign in</h1>
        <p style={{ color: 'var(--color-neutral-700)', margin: '0 0 28px' }}>Sign in with your registered account credentials.</p>

        <form
          style={{ display: 'grid', gap: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            attempt(identifier, pass);
          }}
        >
          <div className="field">
            <label>Mobile number or User ID</label>
            <input className="input" type="text" placeholder="Mobile number or User ID" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" placeholder="••••••••" value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" defaultChecked />
            <span>Keep me signed in on this device</span>
          </label>
          {error && <div style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{error}</div>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <a href="#reset">Forgot password</a>
            <a href="#otp">Sign in with OTP instead</a>
          </div>
        </form>
      </div>
    </div>
  );
}
