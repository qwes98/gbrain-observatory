import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Deliberately independent of Next routes and production composition.
export default defineConfig({
  root: fileURLToPath(new URL('./tests/fixtures', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react(), {
    name: 'isolated-hydration-fixture',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/hydration') return next();
        try {
          const { render } = await server.ssrLoadModule('/hydration-server.tsx');
          const html = await server.transformIndexHtml('/hydration', `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>Timestamp hydration verification</title></head>
<body><div id="root">${render()}</div><script type="module" src="/hydration-client.tsx"></script></body></html>`);
          response.setHeader('Content-Type', 'text/html');
          response.setHeader('Cache-Control', 'no-store');
          response.end(html);
        } catch (error) {
          if (error instanceof Error) server.ssrFixStacktrace(error);
          next(error);
        }
      });
    },
  }],
  // Next Link has no router in this host; its environment defaults still need a browser-safe object.
  define: { 'process.env': {} },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] },
  },
});
