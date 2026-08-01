import type { AppAlert } from '@/types';
import type { AlertChannel } from './AlertChannel';

/**
 * STUB for backend-mediated delivery (push, SMS, pager…).
 * Expected endpoint: POST {baseUrl}/alerts with the AppAlert JSON body.
 * Enable by adding it to the channel list in ./index.ts once the API exists.
 */
export class WebhookAlertChannel implements AlertChannel {
  readonly name = 'webhook';

  constructor(private baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? '/api') {}

  async init(): Promise<boolean> {
    return true;
  }

  async send(alert: AppAlert): Promise<void> {
    await fetch(`${this.baseUrl}/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
    });
  }
}
