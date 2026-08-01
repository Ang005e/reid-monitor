import type { AppAlert } from '@/types';

export function AlertCenter({
  alerts,
  onAcknowledge,
  notificationsReady,
  onEnableNotifications,
}: {
  alerts: AppAlert[];
  onAcknowledge: (id: string) => void;
  notificationsReady: boolean;
  onEnableNotifications: () => void;
}) {
  const unacked = alerts.filter((a) => !a.acknowledged);
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">
          Alerts {unacked.length > 0 && <span className="alert-count">{unacked.length}</span>}
        </span>
        <button
          className={`btn ${notificationsReady ? 'btn-ok' : ''}`}
          onClick={onEnableNotifications}
          disabled={notificationsReady}
        >
          {notificationsReady ? '✓ Device notifications on' : 'Enable device notifications'}
        </button>
      </div>
      {alerts.length === 0 ? (
        <p className="hint">No alerts yet. Warning/critical findings will appear here and push to this device.</p>
      ) : (
        <ul className="alert-list">
          {alerts.slice(0, 12).map((a) => (
            <li key={a.id} className={`alert-item ${a.acknowledged ? 'acked' : ''}`}>
              <span className={`sev-badge sev-badge-${a.severity}`}>{a.severity}</span>
              <div className="alert-text">
                <span className="alert-title">{a.title}</span>
                <span className="alert-time">
                  data time {new Date(a.triggeredAt).toLocaleString()}
                </span>
              </div>
              {!a.acknowledged && (
                <button className="btn btn-small" onClick={() => onAcknowledge(a.id)}>
                  Ack
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
