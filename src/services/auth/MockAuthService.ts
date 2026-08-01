import type { AuthSession, AuthUser, Credentials } from '@/types';
import { AuthError, type AuthService } from './AuthService';
import { clearSession, readSession, writeSession } from './sessionStore';

/** How long a session lasts before the user must sign in again. */
const SESSION_HOURS = 8;

/** Simulated network latency, so the form's loading state is visible in the demo. */
const FAKE_LATENCY_MS = 350;

/**
 * Demo accounts. These are NOT secrets — they ship in the client bundle and are
 * printed on the login screen on purpose. Delete this table the moment the real
 * auth API exists (see HttpAuthService).
 */
const ACCOUNTS: ReadonlyArray<AuthUser & { password: string }> = [
  {
    id: 'u-cloudy',
    username: 'cloudy',
    password: 'notes2026',
    displayName: 'Cloudy · Facilities',
    role: 'engineer',
  },
  {
    id: 'u-facilities',
    username: 'facilities',
    password: 'reid2026',
    displayName: 'Facilities Desk',
    role: 'engineer',
  },
  {
    id: 'u-librarian',
    username: 'librarian',
    password: 'reid2026',
    displayName: 'Library Staff',
    role: 'community',
  },
];

export class MockAuthService implements AuthService {
  readonly demoAccounts = ACCOUNTS.map((a) => ({
    username: a.username,
    password: a.password,
    role: a.role as string,
  }));

  async login({ username, password }: Credentials): Promise<AuthSession> {
    await delay(FAKE_LATENCY_MS);

    const match = ACCOUNTS.find(
      (a) => a.username.toLowerCase() === username.trim().toLowerCase(),
    );
    // Same message for unknown user and wrong password — don't leak which.
    if (!match || match.password !== password) {
      throw new AuthError('Incorrect username or password.');
    }

    const { password: _pw, ...user } = match;
    return this.issue(user);
  }

  async loginAsGuest(): Promise<AuthSession> {
    await delay(FAKE_LATENCY_MS / 2);
    return this.issue({
      id: 'u-visitor',
      username: 'visitor',
      displayName: 'Library Visitor',
      role: 'community',
    });
  }

  async restore(): Promise<AuthSession | null> {
    return readSession();
  }

  async logout(): Promise<void> {
    clearSession();
  }

  describe(): string {
    return 'demo · local accounts';
  }

  private issue(user: AuthUser): AuthSession {
    const session: AuthSession = {
      user,
      token: `mock.${user.id}.${Date.now().toString(36)}`,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString(),
    };
    writeSession(session);
    return session;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
