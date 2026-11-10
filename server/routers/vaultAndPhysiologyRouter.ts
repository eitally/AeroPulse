import express, { type Request, type Response } from 'express';
import { getVerifiedSessionClaims } from '../securityUtils.ts';
import { getVaultStorageBackend } from '../tokenVault.ts';
import { evaluateOrthopedicInterference } from '../../src/physiology/orthopedicEngine.ts';
import { generatePostWorkoutDebrief } from '../../src/physiology/workoutDebrief.ts';

export const vaultAndPhysiologyRouter = express.Router();

vaultAndPhysiologyRouter.get('/api/vault/status', (req: Request, res: Response) => {
  const claims = getVerifiedSessionClaims(req);
  res.json({
    ok: true,
    storageBackend: getVaultStorageBackend(),
    encryptionCipher: 'AES-256-GCM',
    databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
    sessionIsolated: Boolean(claims?.sid),
    cleanRoomPolicy: 'FIRST_PARTY_GARMIN_FIT_WELLNESS_ONLY',
  });
});

vaultAndPhysiologyRouter.post(
  '/api/physiology/orthopedic-summary',
  (req: Request, res: Response) => {
    try {
      const { activities = [], athleteProfile = {}, todayPlannedEvents = [] } = req.body || {};
      const summary = evaluateOrthopedicInterference(
        Array.isArray(activities) ? activities : [],
        athleteProfile,
        Array.isArray(todayPlannedEvents) ? todayPlannedEvents : []
      );
      res.json({ ok: true, summary });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to compute orthopedic summary.',
      });
    }
  }
);

vaultAndPhysiologyRouter.post('/api/physiology/debrief', (req: Request, res: Response) => {
  try {
    const { activity, streams, athleteProfile } = req.body || {};
    if (!activity || !streams || !athleteProfile) {
      res.status(400).json({ error: 'activity, streams, and athleteProfile are required.' });
      return;
    }
    const report = generatePostWorkoutDebrief(activity, streams, athleteProfile);
    res.json({ ok: true, report });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to generate post-workout debrief.',
    });
  }
});
