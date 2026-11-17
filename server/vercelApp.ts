import 'dotenv/config';
import express from 'express';
import { apiRouter } from './apiRouter.ts';
import { securityHeadersMiddleware } from './securityUtils.ts';
import { strava64BitJsonReviver } from './stravaIdUtils.ts';

const app = express();
app.disable('x-powered-by');
app.use(securityHeadersMiddleware);
app.use(
  express.json({
    limit: '2mb',
    reviver: strava64BitJsonReviver as unknown as (key: string, value: any) => any,
  })
);
app.use(apiRouter);

export default app;
