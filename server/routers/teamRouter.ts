import express from 'express';
import { emailOtpRouter, resetEmailOtpRateLimitsForTesting } from './team/emailOtpRouter.ts';
import { timingRouter, resetTimingDelegationRateLimitsForTesting } from './team/timingRouter.ts';
import { rosterAndLifecycleRouter } from './team/rosterAndLifecycleRouter.ts';
import { workoutsAndOpsRouter } from './team/workoutsAndOpsRouter.ts';
import { messagingAndPushRouter } from './team/messagingAndPushRouter.ts';

export const teamRouter = express.Router();

export { resetEmailOtpRateLimitsForTesting, resetTimingDelegationRateLimitsForTesting };

teamRouter.use(emailOtpRouter);
teamRouter.use(timingRouter);
teamRouter.use(rosterAndLifecycleRouter);
teamRouter.use(workoutsAndOpsRouter);
teamRouter.use(messagingAndPushRouter);
