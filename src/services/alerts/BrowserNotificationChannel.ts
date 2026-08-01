import type { AppAlert } from '@/types';
import type { AlertChannel } from './AlertChannel';

/** Device notifications via the browser Notification API. */
export class BrowserNotificationChannel implements AlertChannel {
  readonly name = 'browser-notification';

  async init(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  async send(alert: AppAlert): Promise<void> {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    // eslint-disable-next-line no-new
    new Notification(`Reid Library · ${alert.title}`, {
      body: `${alert.communityMessage}\n→ ${alert.action}`,
      tag: alert.ruleId, // collapses repeat alerts for the same rule
    });
  }
}
