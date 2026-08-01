import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ViewMode } from '@/types';

interface ViewModeCtx {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
}

const Ctx = createContext<ViewModeCtx>({ mode: 'community', setMode: () => {} });

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>('community');
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useViewMode() {
  return useContext(Ctx);
}
