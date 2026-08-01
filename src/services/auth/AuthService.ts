import type { AuthSession, Credentials } from '@/types';

/**
 * BACKEND SEAM — the only contract the UI depends on for identity.
 *
 * Today: MockAuthService checks a small table of demo accounts in the browser.
 * Later: implement HttpAuthService against the real API and flip the factory in
 * ./index.ts (or set VITE_AUTH_SOURCE=http). Nothing in the UI layer changes.
 *
 * NOTE ON SECURITY: the mock implementation is a UI gate, not authentication.
 * Passwords live in the client bundle and anyone can read them. That is fine for
 * a demo with no backend; the real credential check must happen server-side once
 * HttpAuthService is wired.
 */
export interface AuthService {
  /** Sign in with credentials. Rejects with AuthError on bad credentials. */
  login(credentials: Credentials): Promise<AuthSession>;

  /**
   * Sign in as an anonymous community visitor (no password).
   * The public dashboard is read-only, so this needs no server round-trip in
   * the mock; a real backend may still want to issue a scoped token here.
   */
  loginAsGuest(): Promise<AuthSession>;

  /** Restore a previously stored session on page load, or null if none/expired. */
  restore(): Promise<AuthSession | null>;

  /** Discard the session locally and (for HTTP) server-side. */
  logout(session: AuthSession | null): Promise<void>;

  /** Human-readable label for the login screen (e.g. "demo · local accounts"). */
  describe(): string;

  /**
   * Credentials to show on the login screen as a hint. Mock only — a real
   * implementation must leave this undefined.
   */
  readonly demoAccounts?: ReadonlyArray<{ username: string; password: string; role: string }>;
}

/** Thrown for any failure the user should see on the login form. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
