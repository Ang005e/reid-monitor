import type { AuthService } from './AuthService';
import { MockAuthService } from './MockAuthService';
import { HttpAuthService } from './HttpAuthService';

export type { AuthService };
export { AuthError } from './AuthService';

/**
 * Factory — the single switch between demo accounts and the real auth API.
 * Set VITE_AUTH_SOURCE=http in .env when the API is ready.
 */
export function createAuthService(): AuthService {
  const kind = import.meta.env.VITE_AUTH_SOURCE ?? 'mock';
  switch (kind) {
    case 'http':
      return new HttpAuthService();
    case 'mock':
    default:
      return new MockAuthService();
  }
}
