import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './server/apiRouter.ts';
import { captureServerException } from './server/observability.ts';
import { strava64BitJsonReviver } from './server/stravaIdUtils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(
    express.json({
      limit: '2mb',
      reviver: strava64BitJsonReviver as unknown as (key: string, value: unknown) => unknown,
    })
  );
  app.use(apiRouter);

  const serveBuiltDist =
    process.env.NODE_ENV === 'production' || process.env.SERVE_BUILT_DIST === '1';

  const vanityRedirects: Record<string, string> = {
    '/demo': '/?demo=1&sample=coach&utm_source=print&utm_medium=qr&utm_campaign=demo#coach',
    '/ad': '/for-athletic-directors?utm_source=print&utm_medium=ad_packet&utm_campaign=school_po',
    '/meet': '/?demo=1&sample=coach&utm_source=print&utm_medium=banner&utm_campaign=meet_day#coach',
    '/clinic': '/?demo=1&sample=coach&utm_source=event&utm_medium=qr&utm_campaign=clinic#coach',
    '/flyer': '/?demo=1&sample=coach&utm_source=print&utm_medium=flyer&utm_campaign=pilot_2026#coach',
    '/sticker': '/?demo=1&sample=coach&utm_source=print&utm_medium=sticker&utm_campaign=varsity_crest#coach',
    '/tee': '/?demo=1&sample=coach&utm_source=print&utm_medium=tee&utm_campaign=coach_tee#coach',
    '/go/clipboard': '/?demo=1&sample=coach&utm_source=print&utm_medium=clipboard_qr&utm_campaign=pod_sheet#coach',
    '/share': '/?role=coach&utm_source=share&utm_medium=card&utm_campaign=share_card',
  };
  for (const [sourcePath, destination] of Object.entries(vanityRedirects)) {
    app.get([sourcePath, `${sourcePath}/`], (_req, res) => {
      res.redirect(302, destination);
    });
  }

  const publicPath = path.resolve(__dirname, 'public');
  app.use(express.static(publicPath));
  app.get(['/docs', '/docs/'], (_req, res) => {
    res.sendFile(path.join(publicPath, 'docs', 'index.html'));
  });
  for (const page of ['privacy', 'terms', 'subprocessors', 'procurement'] as const) {
    app.get([`/${page}`, `/${page}/`], (_req, res) => {
      const target = serveBuiltDist
        ? path.resolve(__dirname, 'dist', 'legal', `${page}.html`)
        : path.join(publicPath, 'legal', `${page}.html`);
      res.type('text/html; charset=utf-8');
      res.sendFile(target);
    });
  }
  app.get(['/for-athletic-directors', '/for-athletic-directors/'], (_req, res) => {
    const target = serveBuiltDist
      ? path.resolve(__dirname, 'dist', 'for-athletic-directors.html')
      : path.join(publicPath, 'for-athletic-directors.html');
    res.type('text/html; charset=utf-8');
    res.sendFile(target);
  });

  app.get('/manifest.webmanifest', (_req, res, next) => {
    const builtManifest = path.resolve(__dirname, 'dist', 'manifest.webmanifest');
    res.type('application/manifest+json');
    res.sendFile(builtManifest, (err) => {
      if (err) next();
    });
  });
  if (!serveBuiltDist) {
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

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const statusCode =
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      typeof (err as { status?: unknown }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    void captureServerException(err, {
      scope: 'express-server-error',
      method: req.method,
      path: req.path,
      statusCode,
    });
    if (res.headersSent) return;
    const message =
      statusCode >= 500
        ? 'Internal server error.'
        : err instanceof Error
          ? err.message
          : 'Bad request.';
    res.status(statusCode).json({ ok: false, error: message });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`MeetReady server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
