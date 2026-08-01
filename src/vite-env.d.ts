/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'csv' (default, bundled replay) or 'http' (real backend). */
  readonly VITE_DATA_SOURCE?: 'csv' | 'http';
  /** Base URL of the backend API when VITE_DATA_SOURCE=http. */
  readonly VITE_API_BASE_URL?: string;
  /** 'mock' (default, in-browser demo accounts) or 'http' (real auth API). */
  readonly VITE_AUTH_SOURCE?: 'mock' | 'http';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
