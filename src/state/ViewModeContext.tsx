import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ViewMode } from '@/types';

interface ViewModeCtx {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  /** False for community accounts — the engineer toggle is hidden for them. */
  canUseEngineerView: boolean;
}

const Ctx = createContext<ViewModeCtx>({
  mode: 'community',
  setMode: () => {},
  canUseEngineerView: false,
});

export function ViewModeProvider({
  children,
  initialMode = 'community',
  canUseEngineerView = true,
}: {
  children: ReactNode;
  /** Signed-in role decides where the dashboard opens. */
  initialMode?: ViewMode;
  canUseEngineerView?: boolean;
}) {
  const [mode, setModeState] = useState<ViewMode>(initialMode);

  // Guard the setter too, so the mode can never be raised past the user's role.
  const setMode = (m: ViewMode) => {
    if (m === 'engineer' && !canUseEngineerView) return;
    setModeState(m);
  };

  return (
    <Ctx.Provider value={{ mode, setMode, canUseEngineerView }}>{children}</Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useViewMode() {
  return useContext(Ctx);
}
