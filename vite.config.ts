import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Proxies the dashboard's /api calls to the backend in server/ (default
    // port 8787). Keeping the frontend on a same-origin path means local dev
    // needs no CORS config and no VITE_API_BASE_URL — just `npm run dev` in
    // both directories.
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { echarts: ['echarts'] },
      },
    },
  },
});
