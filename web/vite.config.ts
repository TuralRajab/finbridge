import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow GitHub Codespaces forwarded URLs (*.app.github.dev) in dev mode.
    allowedHosts: ['.app.github.dev'],
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: { outDir: 'dist', sourcemap: true },
});
