import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { isAllowed } from '../lib/allowlist';
import { CompassIcon } from './icons';

// Email-only sign-in. If the email is on the team allow-list we start an anonymous
// Supabase session (which satisfies RLS so data loads) — no password, no email round-trip.
// This is a convenience gate, not hard security: see src/lib/allowlist.ts.
export default function Login() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!addr || !supabase) return;

    if (!isAllowed(addr)) {
      setError("That email isn't on the team list. Ask Alex to add it, then try again.");
      return;
    }

    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInAnonymously();
    if (err) {
      setBusy(false);
      setError(
        /disabled|anonymous/i.test(err.message)
          ? 'Sign-in isn’t switched on yet on the server. Ping the admin — it’s a one-time toggle.'
          : err.message,
      );
      return;
    }
    // Remember who they are for the header + next visit. onAuthStateChange in Dashboard
    // then swaps this screen out for the directory.
    localStorage.setItem('pd_email', addr);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-mark">
          <CompassIcon />
        </div>
        <h1>Faculty Directory</h1>
        <p>
          Indonesia university faculty outreach. Internal team
          only — enter your work email to continue.
        </p>

        {error && <div className="notice notice-err">{error}</div>}

        <div className="field">
          <label htmlFor="login-email">Work email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@yventures.com.sg"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <button className="btn btn-gold" type="submit" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" /> Signing in…
            </>
          ) : (
            'Continue'
          )}
        </button>
      </form>
    </div>
  );
}
