import type { AuthSession } from '@/types';

/**
 * Session persistence, shared by every AuthService implementation so a page
 * refresh does not sign the user out. Deliberately dumb: read, write, clear.
 */
const KEY = 'reid-monitor.session';

export function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    if (!session?.user?.role || !session.expiresAt) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    // Corrupt or unavailable storage (private mode) — treat as signed out.
    return null;
  }
}

export function writeSession(session: AuthSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable: the session simply won't survive a refresh.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
