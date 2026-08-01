import { useState, type FormEvent } from 'react';

/**
 * Sign-in screen. Presentational only — every callback is supplied by App,
 * which owns the auth state (see the dependency rule in CLAUDE.md).
 */
export function LoginPage({
  onLogin,
  onGuest,
  pending,
  error,
  sourceLabel,
  demoAccounts,
}: {
  onLogin: (username: string, password: string) => void;
  onGuest: () => void;
  pending: boolean;
  error: string | null;
  sourceLabel: string;
  demoAccounts: ReadonlyArray<{ username: string; password: string; role: string }>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = username.trim() !== '' && password !== '' && !pending;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onLogin(username, password);
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="live-dot" aria-hidden="true" />
          <div>
            <h1>Reid Library</h1>
            <p className="login-sub">Essential Systems Monitor</p>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field-label">Username</span>
            <input
              className="input"
              type="text"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={pending}
              aria-invalid={error ? true : undefined}
            />
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <input
              className="input"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              aria-invalid={error ? true : undefined}
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="login-divider">
          <span>or</span>
        </div>

        <button className="btn login-guest" type="button" onClick={onGuest} disabled={pending}>
          Continue as a visitor
        </button>
        <p className="hint login-guest-hint">
          Visitors see the public system status. Facilities staff sign in for control
          charts, capability analysis and alerts.
        </p>

        {demoAccounts.length > 0 && (
          <details className="login-demo">
            <summary>Demo accounts</summary>
            <ul>
              {demoAccounts.map((a) => (
                <li key={a.username}>
                  <code>
                    {a.username} / {a.password}
                  </code>
                  <span className="login-demo-role">{a.role}</span>
                </li>
              ))}
            </ul>
            <p className="hint">
              Demo only — credentials are checked in the browser. Real checks move
              server-side when the auth API lands.
            </p>
          </details>
        )}

        <p className="login-foot">{sourceLabel}</p>
      </div>
    </div>
  );
}
