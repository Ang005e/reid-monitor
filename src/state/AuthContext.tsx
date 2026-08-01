import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthSession, Credentials } from '@/types';
import { AuthError, createAuthService } from '@/services/auth';

interface AuthCtx {
  session: AuthSession | null;
  /** True while the stored session is being restored on first paint. */
  restoring: boolean;
  /** True while a sign-in attempt is in flight. */
  pending: boolean;
  /** Message to show on the login form, or null. */
  error: string | null;
  login: (credentials: Credentials) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  /** Label for the login screen footer (which auth backend is in use). */
  sourceLabel: string;
  /** Demo credentials to display; empty once a real backend is wired. */
  demoAccounts: ReadonlyArray<{ username: string; password: string; role: string }>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // One service instance for the app's lifetime — the factory reads env once.
  const serviceRef = useRef(createAuthService());
  const service = serviceRef.current;

  const [session, setSession] = useState<AuthSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void service
      .restore()
      .then((restored) => {
        if (!cancelled) setSession(restored);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  /** Shared wrapper: one attempt in flight, errors surfaced as form copy. */
  const attempt = useCallback(async (run: () => Promise<AuthSession>) => {
    setPending(true);
    setError(null);
    try {
      setSession(await run());
    } catch (err) {
      setSession(null);
      setError(
        err instanceof AuthError
          ? err.message
          : 'Could not reach the sign-in service. Check your connection and try again.',
      );
    } finally {
      setPending(false);
    }
  }, []);

  const login = useCallback(
    (credentials: Credentials) => attempt(() => service.login(credentials)),
    [attempt, service],
  );

  const loginAsGuest = useCallback(
    () => attempt(() => service.loginAsGuest()),
    [attempt, service],
  );

  const logout = useCallback(async () => {
    const current = session;
    setSession(null);
    setError(null);
    await service.logout(current);
  }, [service, session]);

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      restoring,
      pending,
      error,
      login,
      loginAsGuest,
      logout,
      sourceLabel: service.describe(),
      demoAccounts: service.demoAccounts ?? [],
    }),
    [session, restoring, pending, error, login, loginAsGuest, logout, service],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
