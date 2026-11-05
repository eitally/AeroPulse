import 'dotenv/config';
import express from 'express';
import { apiRouter } from '../server/apiRouter.ts';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(apiRouter);

export default app;
