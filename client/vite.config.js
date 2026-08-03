import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API is fixed at 5401 by contract; the dev server is fixed at 5400.
const API = 'http://localhost:5401';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5400,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
    },
  },
  preview: {
    port: 5400,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
