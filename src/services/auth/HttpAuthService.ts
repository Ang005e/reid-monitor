import type { AuthSession, Credentials } from '@/types';
import { AuthError, type AuthService } from './AuthService';
import { clearSession, readSession, writeSession } from './sessionStore';

/**
 * STUB for the real backend. Fill in when the auth API exists.
 *
 * Expected endpoints (agree with backend team, then update here only):
 *   POST {baseUrl}/auth/login   {username, password} → AuthSession
 *   POST {baseUrl}/auth/guest                        → AuthSession (community scope)
 *   GET  {baseUrl}/auth/session (Bearer token)       → AuthSession | 401
 *   POST {baseUrl}/auth/logout  (Bearer token)       → 204
 *
 * If the backend prefers httpOnly cookies over a bearer token, drop the token
 * from storage and send `credentials: 'include'` — nothing above this file changes.
 */
export class HttpAuthService implements AuthService {
  constructor(private baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? '/api') {}

  async login(credentials: Credentials): Promise<AuthSession> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (res.status === 401) throw new AuthError('Incorrect username or password.');
    if (!res.ok) throw new AuthError(`Sign-in failed (${res.status}). Try again.`);

    const session = (await res.json()) as AuthSession;
    writeSession(session);
    return session;
  }

  async loginAsGuest(): Promise<AuthSession> {
    const res = await fetch(`${this.baseUrl}/auth/guest`, { method: 'POST' });
    if (!res.ok) throw new AuthError(`Could not open the public view (${res.status}).`);

    const session = (await res.json()) as AuthSession;
    writeSession(session);
    return session;
  }

  /** Trust but verify: use the stored session, then confirm it with the server. */
  async restore(): Promise<AuthSession | null> {
    const stored = readSession();
    if (!stored) return null;

    try {
      const res = await fetch(`${this.baseUrl}/auth/session`, {
        headers: { Authorization: `Bearer ${stored.token}` },
      });
      if (!res.ok) {
        clearSession();
        return null;
      }
      const fresh = (await res.json()) as AuthSession;
      writeSession(fresh);
      return fresh;
    } catch {
      // Network down — keep the local session rather than kicking the user out.
      return stored;
    }
  }

  async logout(session: AuthSession | null): Promise<void> {
    clearSession();
    if (!session) return;
    try {
      await fetch(`${this.baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch {
      // Local sign-out already happened; a failed server call must not block it.
    }
  }

  describe(): string {
    return `live · ${this.baseUrl}`;
  }
}
