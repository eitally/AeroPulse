import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import { apiRouter } from './apiRouter.ts';
import { captureServerException } from './observability.ts';
import { ogPreviewRouter } from './routers/ogPreviewRouter.ts';
import { strava64BitJsonReviver } from './stravaIdUtils.ts';

const app = express();
app.disable('x-powered-by');
app.use(
  express.json({
    limit: '2mb',
    reviver: strava64BitJsonReviver as (key: string, value: unknown) => unknown,
  })
);
app.use(apiRouter);
app.use(ogPreviewRouter);
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const statusCode =
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;
  void captureServerException(err, {
    scope: 'vercel-app-error',
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

export default app;
