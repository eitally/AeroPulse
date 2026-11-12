import 'dotenv/config';
import express from 'express';
import { apiRouter } from './apiRouter.ts';
import { securityHeadersMiddleware } from './securityUtils.ts';

const app = express();
app.disable('x-powered-by');
app.use(securityHeadersMiddleware);
app.use(express.json({ limit: '2mb' }));
app.use(apiRouter);

export default app;
