import express from 'express';
import {
  getEffectiveIntervalsConfig,
  getIntervalsAuthHeader,
  getEffectiveIntervalsClientConfig,
  intervalsIdentityByKey,
  resolveIntervalsAthleteIdentity,
  intervalsCallbackHandler,
  intervalsAuthRouter,
  type RawIntervalsGear,
  type RawIntervalsAthleteProfile,
  type CachedIntervalsIdentity,
} from './intervals/intervalsAuthAndConfig.ts';
import { syncIntervalsAllHistory } from './intervals/intervalsSyncService.ts';
import { intervalsProfileAndPushRouter } from './intervals/intervalsProfileAndPushRouter.ts';
import { intervalsCalendarRouter } from './intervals/intervalsCalendarRouter.ts';

export {
  getEffectiveIntervalsConfig,
  getIntervalsAuthHeader,
  getEffectiveIntervalsClientConfig,
  intervalsIdentityByKey,
  resolveIntervalsAthleteIdentity,
  syncIntervalsAllHistory,
  intervalsCallbackHandler,
  type RawIntervalsGear,
  type RawIntervalsAthleteProfile,
  type CachedIntervalsIdentity,
};

export const intervalsRouter = express.Router();

intervalsRouter.use(intervalsAuthRouter);
intervalsRouter.use(intervalsProfileAndPushRouter);
intervalsRouter.use(intervalsCalendarRouter);
