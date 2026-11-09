import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './server/apiRouter.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '2mb' }));
  app.use(apiRouter);

  app.get('/manifest.webmanifest', (_req, res, next) => {
    const builtManifest = path.resolve(__dirname, 'dist', 'manifest.webmanifest');
    res.type('application/manifest+json');
    res.sendFile(builtManifest, (err) => {
      if (err) next();
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true as const,
        hmr: {
          server: httpServer,
        },
        watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
      },
      appType: 'spa',
    });

    // Prevent @vite/client from throwing "Error: WebSocket closed without opened."
    // when HMR WebSockets are disabled in the preview container.
    app.use('/@vite/client', (req, res, next) => {
      const origEnd = res.end.bind(res);
      const chunks: Buffer[] = [];

      res.write = ((chunk: any) => {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        return true;
      }) as any;

      res.end = ((chunk?: any) => {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        const body = Buffer.concat(chunks).toString('utf-8');
        const patched = body.replace(
          'transport.connect(createHMRHandler(handleMessage));',
          '/* HMR WebSocket connection suppressed in preview container */'
        );
        res.setHeader('Content-Length', Buffer.byteLength(patched, 'utf-8'));
        res.setHeader('Cache-Control', 'no-store');
        return origEnd(patched, 'utf-8');
      }) as any;

      next();
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AeroPulse server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
