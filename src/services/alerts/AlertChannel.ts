import type { AppAlert } from '@/types';

/**
 * BACKEND SEAM — outbound alert delivery.
 *
 * Today: BrowserNotificationChannel (device notifications via the
 * Notification API — the "send alert to device" feature, no backend needed).
 * Later: add a WebhookAlertChannel / PushAlertChannel that POSTs to the
 * backend for SMS-style fan-out, and register it in ./index.ts.
 */
export interface AlertChannel {
  /** Idempotent setup (e.g. permission prompts). Resolves to readiness. */
  init(): Promise<boolean>;
  send(alert: AppAlert): Promise<void>;
  readonly name: string;
}
