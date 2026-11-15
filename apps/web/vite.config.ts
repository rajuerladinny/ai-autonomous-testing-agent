import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  // A relative base lets the demo build be served from any static path (e.g. GitHub Pages).
  base: process.env.VITE_BASE ?? '/',
  // Demo builds open straight into the in-browser sample workspace and never call the API.
  define: { __DEMO__: JSON.stringify(process.env.VITE_DEMO_MODE === 'true') },
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001', '/health': 'http://127.0.0.1:3001' },
  },
});
