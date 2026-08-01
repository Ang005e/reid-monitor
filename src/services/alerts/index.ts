import type { AppAlert } from '@/types';
import type { AlertChannel } from './AlertChannel';
import { BrowserNotificationChannel } from './BrowserNotificationChannel';

export type { AlertChannel };
export { BrowserNotificationChannel };

/**
 * Dispatcher: fans one alert out to every registered channel.
 * Add WebhookAlertChannel here when the backend lands.
 */
export class AlertDispatcher {
  private channels: AlertChannel[] = [new BrowserNotificationChannel()];
  private ready = new Map<string, boolean>();

  async init(): Promise<void> {
    await Promise.all(
      this.channels.map(async (c) => this.ready.set(c.name, await c.init())),
    );
  }

  isReady(name: string): boolean {
    return this.ready.get(name) ?? false;
  }

  async dispatch(alert: AppAlert): Promise<void> {
    await Promise.allSettled(
      this.channels.filter((c) => this.ready.get(c.name)).map((c) => c.send(alert)),
    );
  }
}

export const alertDispatcher = new AlertDispatcher();
