import { Header } from '@/components/Header';
import { EngineerView } from '@/components/EngineerView';
import { CommunityView } from '@/components/CommunityView';
import { AlertCenter } from '@/components/AlertCenter';
import { LoginPage } from '@/components/LoginPage';
import { useMonitor } from '@/state/useMonitor';
import { useViewMode, ViewModeProvider } from '@/state/ViewModeContext';
import { useAuth } from '@/state/AuthContext';

/**
 * Auth gate. The dashboard (and therefore the data stream) only mounts once a
 * session exists, so ViewModeProvider can take its defaults from the user's role.
 */
export default function App() {
  const { session, restoring, pending, error, login, loginAsGuest, logout, sourceLabel, demoAccounts } =
    useAuth();

  if (restoring) {
    return (
      <div className="login-page">
        <p className="hint">Restoring session…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginPage
        onLogin={(username, password) => void login({ username, password })}
        onGuest={() => void loginAsGuest()}
        pending={pending}
        error={error}
        sourceLabel={sourceLabel}
        demoAccounts={demoAccounts}
      />
    );
  }

  const isEngineer = session.user.role === 'engineer';

  return (
    <ViewModeProvider
      // Remount on identity change so a new sign-in never inherits the old view.
      key={session.user.id}
      initialMode={isEngineer ? 'engineer' : 'community'}
      canUseEngineerView={isEngineer}
    >
      <Dashboard
        userName={session.user.displayName}
        role={session.user.role}
        onSignOut={() => void logout()}
      />
    </ViewModeProvider>
  );
}

function Dashboard({
  userName,
  role,
  onSignOut,
}: {
  userName: string;
  role: string;
  onSignOut: () => void;
}) {
  const monitor = useMonitor();
  const { mode, setMode, canUseEngineerView } = useViewMode();

  return (
    <div className="app">
      <Header
        mode={mode}
        onModeChange={setMode}
        canUseEngineerView={canUseEngineerView}
        paused={monitor.paused}
        onTogglePaused={() => monitor.setPaused(!monitor.paused)}
        sourceLabel={monitor.sourceLabel}
        lastTimestamp={monitor.latest?.timestamp ?? null}
        userName={userName}
        role={role}
        onSignOut={onSignOut}
      />

      <main className="layout">
        <div className="layout-main">
          {mode === 'engineer' ? (
            <EngineerView monitor={monitor} />
          ) : (
            <CommunityView monitor={monitor} />
          )}
        </div>
        <aside className="layout-side">
          <AlertCenter
            alerts={monitor.alerts}
            onAcknowledge={monitor.acknowledgeAlert}
            notificationsReady={monitor.notificationsReady}
            onEnableNotifications={() => void monitor.enableNotifications()}
          />
        </aside>
      </main>
    </div>
  );
}
