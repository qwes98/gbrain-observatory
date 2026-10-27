import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Deliberately independent of Next routes and production composition.
export default defineConfig({
  root: fileURLToPath(new URL('./tests/fixtures', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react()],
  // Next Link has no router in this host; its environment defaults still need a browser-safe object.
  define: { 'process.env': {} },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] },
  },
});
