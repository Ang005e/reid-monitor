import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './state/AuthContext';
import './index.css';

// ViewModeProvider now lives inside App, below the auth gate, so the view mode
// can be derived from the signed-in user's role.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
