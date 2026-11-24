import express, { type Request, type Response } from 'express';
import {
  runtimeStore,
  loadJsonFile,
  saveJsonFile,
  getScopedPlannedEventsFile,
  getActiveGarminSession,
  getGarminScopeKey,
  GARMIN_SESSION_DIR,
} from '../../sessionContext.ts';
import { parseWorkoutSyntaxToSteps } from '../../physiologyEngine.ts';
import type {
  PlannedWorkoutEvent,
  StructuredWorkoutStep,
} from '../../../src/types.ts';
import {
  loadAthleteCloudState,
  saveAthleteCloudState,
} from '../athleteStateRouter.ts';
import {
  pushWorkoutToGarminConnect,
  saveGarminSession,
} from '../../garminConnectService.ts';
import {
  getEffectiveIntervalsConfig,
  getIntervalsAuthHeader,
} from './intervalsAuthAndConfig.ts';

export const intervalsCalendarRouter = express.Router();

// Training Calendar Planned Events API (Vault + Local + Sync to Intervals.icu / Garmin)
intervalsCalendarRouter.get('/api/calendar/events', async (req: Request, res: Response) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  if (cloud && cloud.plannedEvents.length > 0) {
    res.json({ events: cloud.plannedEvents });
    return;
  }
  if (!scopedFile) {
    res.json({ events: [] });
    return;
  }
  const localPlanned = loadJsonFile<PlannedWorkoutEvent[]>(scopedFile, []);
  res.json({ events: localPlanned });
});

intervalsCalendarRouter.post('/api/calendar/events', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const date = String(body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const name = String(body.name || 'Structured Workout');
    const sportCategory = body.sportCategory || 'Cycling';
    const environmentPreference = body.environmentPreference || 'FLEXIBLE';
    const plannedDurationSecs = Number(body.plannedDurationSecs || 3600);
    const plannedLoad = Number(body.plannedLoad || 65);
    const workoutSyntax = String(
      body.workoutSyntax ||
        body.description ||
        `- 10m 60% FTP\n- ${Math.max(15, Math.round(plannedDurationSecs / 60) - 20)}m 85% FTP\n- 10m 55% FTP`
    );

    const scheduledTime = typeof body.scheduledTime === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(body.scheduledTime.trim()) ? body.scheduledTime.trim().padStart(5, '0') : undefined;
    const sessionSlot = body.sessionSlot === 'AM' || body.sessionSlot === 'PM' || body.sessionSlot === 'SINGLE' ? body.sessionSlot : undefined;
    const locationName = typeof body.locationName === 'string' && body.locationName.trim() ? body.locationName.trim().slice(0, 120) : undefined;
    const locationCategory = typeof body.locationCategory === 'string' && body.locationCategory.trim() ? body.locationCategory.trim().slice(0, 32) : undefined;
    const meetingNotes = typeof body.meetingNotes === 'string' && body.meetingNotes.trim() ? body.meetingNotes.trim().slice(0, 240) : undefined;
    const newEvent = {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date,
      name,
      sportCategory,
      environmentPreference,
      description: String(body.description || workoutSyntax),
      plannedLoad,
      plannedDurationSecs,
      targetZoneSummary: String(body.targetZoneSummary || `${plannedLoad} TSS Planned`),
      workoutSyntax,
      ...(scheduledTime ? { scheduledTime } : {}),
      ...(sessionSlot ? { sessionSlot } : {}),
      ...(locationName ? { locationName } : {}),
      ...(locationCategory ? { locationCategory } : {}),
      ...(meetingNotes ? { meetingNotes } : {}),
      structuredSteps:
        Array.isArray(body.structuredSteps) && body.structuredSteps.length > 0
          ? body.structuredSteps
          : parseWorkoutSyntaxToSteps(workoutSyntax, plannedDurationSecs),
      ...(body.trackSpec && typeof body.trackSpec === 'object' ? { trackSpec: body.trackSpec } : {}),
      ...(body.planBlockId ? { planBlockId: String(body.planBlockId) } : {}),
      ...(body.planBlockName ? { planBlockName: String(body.planBlockName) } : {}),
      ...(typeof body.planWeekNum === 'number' ? { planWeekNum: body.planWeekNum } : {}),
      source: body.source || 'USER',
    };

    const scopedFile = getScopedPlannedEventsFile(req);
    const cloud = await loadAthleteCloudState(req);
    const existingLocal = scopedFile ? loadJsonFile<PlannedWorkoutEvent[]>(scopedFile, []) : [];
    const existing =
      cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
    const updated = [newEvent, ...existing];
    if (scopedFile) {
      saveJsonFile(scopedFile, updated);
    }
    await saveAthleteCloudState(req, { plannedEvents: updated });

    // Also push to Intervals.icu Calendar if connected and requested
    const intervalsConfig = getEffectiveIntervalsConfig(req);
    const intervalsAuth = getIntervalsAuthHeader(intervalsConfig);
    let pushedToIntervals = false;
    if (intervalsAuth && body.syncToIntervals !== false) {
      try {
        const authHeader = intervalsAuth;
        const athleteId = intervalsConfig.athleteId || '0';
        const icuType =
          sportCategory === 'Running'
            ? 'Run'
            : environmentPreference === 'INDOOR'
              ? 'VirtualRide'
              : 'Ride';
        const icuResp = await fetch(
          `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/events`,
          {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              category: 'WORKOUT',
              start_date_local: `${date}T${scheduledTime ? `${scheduledTime}:00` : '08:00:00'}`,
              name,
              type: icuType,
              description: workoutSyntax,
              moving_time: plannedDurationSecs,
              icu_training_load: plannedLoad,
            }),
          }
        );
        pushedToIntervals = icuResp.ok;
      } catch {
        // Non-fatal if user API key is read-only
      }
    }

    // Also push directly to Garmin Connect Calendar if Direct Garmin is connected
    let pushedToGarmin = false;
    let garminWorkoutId: string | number | undefined;
    const garminSession = getActiveGarminSession(req);
    if (garminSession && body.syncToGarmin !== false) {
      try {
        const garminSteps = (newEvent.structuredSteps || []).map((st: StructuredWorkoutStep) => ({
          label: st.label || 'Interval',
          durationSecs: Number(st.durationSecs || 600),
          targetPctFtp: Number(st.targetPctFtp || 75),
        }));
        const garminRes = await pushWorkoutToGarminConnect(
          garminSession,
          {
            date,
            name,
            sportCategory,
            description: newEvent.description,
            workoutSyntax,
            ftpWatts: Number(body.ftpWatts || runtimeStore.athleteProfile?.ftp || 250),
            lthrBpm: Number(body.lthrBpm || runtimeStore.athleteProfile?.lthr || 165),
            thresholdPaceSecsPerKm: Number(
              body.thresholdPaceSecsPerKm ||
                runtimeStore.athleteProfile?.thresholdPaceSecsPerKm ||
                245
            ),
            steps: garminSteps,
          },
          req
        );
        pushedToGarmin = garminRes.pushed;
        garminWorkoutId = garminRes.workoutId;
        saveGarminSession(GARMIN_SESSION_DIR, getGarminScopeKey(req), garminSession);
      } catch {
        // Non-fatal if Garmin token expired
      }
    }

    res.json({
      event: newEvent,
      pushedToGarmin,
      garminWorkoutId,
      pushedToIntervals,
      events: updated,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to schedule workout event',
    });
  }
});

intervalsCalendarRouter.put('/api/calendar/events/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  const body = req.body || {};
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  const nextSyntax = typeof body.workoutSyntax === 'string' ? body.workoutSyntax : undefined;
  const nextDurationSecs =
    typeof body.plannedDurationSecs === 'number' ? body.plannedDurationSecs : 3600;
  if (!scopedFile && !cloud) {
    res.json({ updated: true, event: { id, ...body } });
    return;
  }
  const existingLocal = scopedFile ? loadJsonFile<PlannedWorkoutEvent[]>(scopedFile, []) : [];
  const existing =
    cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
  const idx = existing.findIndex((e) => e.id === id);
  const patched = {
    ...(idx >= 0 ? existing[idx] : {}),
    ...body,
    id,
    ...(nextSyntax
      ? {
          structuredSteps:
            Array.isArray(body.structuredSteps) && body.structuredSteps.length > 0
              ? body.structuredSteps
              : parseWorkoutSyntaxToSteps(nextSyntax, nextDurationSecs),
        }
      : {}),
  };
  const updated =
    idx >= 0 ? existing.map((e, i) => (i === idx ? patched : e)) : [patched, ...existing];
  if (scopedFile) {
    saveJsonFile(scopedFile, updated);
  }
  await saveAthleteCloudState(req, { plannedEvents: updated });
  res.json({ updated: true, event: patched, events: updated });
});

intervalsCalendarRouter.delete('/api/calendar/blocks/:blockId', async (req: Request, res: Response) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  if (!scopedFile && !cloud) {
    res.json({ deleted: true, events: [] });
    return;
  }
  const blockId = req.params.blockId;
  const existingLocal = scopedFile ? loadJsonFile<PlannedWorkoutEvent[]>(scopedFile, []) : [];
  const existing =
    cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
  const updated = existing.filter((e) => e.planBlockId !== blockId);
  if (scopedFile) {
    saveJsonFile(scopedFile, updated);
  }
  await saveAthleteCloudState(req, { plannedEvents: updated });
  res.json({ deleted: true, events: updated });
});

intervalsCalendarRouter.delete('/api/calendar/events/:id', async (req: Request, res: Response) => {
  const scopedFile = getScopedPlannedEventsFile(req);
  const cloud = await loadAthleteCloudState(req);
  if (!scopedFile && !cloud) {
    res.json({ deleted: true, events: [] });
    return;
  }
  const id = req.params.id;
  const existingLocal = scopedFile ? loadJsonFile<PlannedWorkoutEvent[]>(scopedFile, []) : [];
  const existing =
    cloud && cloud.plannedEvents.length > 0 ? cloud.plannedEvents : existingLocal;
  const updated = existing.filter((e) => e.id !== id);
  if (scopedFile) {
    saveJsonFile(scopedFile, updated);
  }
  await saveAthleteCloudState(req, { plannedEvents: updated });
  res.json({ deleted: true, events: updated });
});
