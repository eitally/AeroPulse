import { useCallback, useRef, useState } from 'react';
import type {
  AthleteProfile,
  CoachChatMessage,
  PlannedWorkoutEvent,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { INITIAL_CHAT_MESSAGES } from '../data/mockTelemetry';
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage';

interface UseCoachChatParams {
  latestWellness: UnifiedWellnessDay | null;
  effectiveActivities: UnifiedActivity[];
  effectiveAthleteProfile: AthleteProfile;
  telemetrySummaryForGemini: any;
}

export function useCoachChat({
  latestWellness,
  effectiveActivities,
  effectiveAthleteProfile,
  telemetrySummaryForGemini,
}: UseCoachChatParams) {
  const [isCoachDrawerOpen, setIsCoachDrawerOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<CoachChatMessage[]>(INITIAL_CHAT_MESSAGES);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [coachDraftPrompt, setCoachDraftPrompt] = useState('');
  const chatAbortRef = useRef<AbortController | null>(null);

  const buildClientCoachFallback = useCallback(
    (userText: string): Omit<CoachChatMessage, 'id' | 'role' | 'timestamp'> => {
      const hasAnyTelemetry = Boolean(latestWellness || effectiveActivities.length > 0);
      const ctl = latestWellness?.ctl ?? 0;
      const atl = latestWellness?.atl ?? 0;
      const tsb = latestWellness?.tsb ?? Number((ctl - atl).toFixed(1));
      const hrv = latestWellness?.hrvRMSSD ?? 0;
      const hrvStatus = latestWellness?.hrvStatus || 'Not synced';
      const sleepScore = latestWellness?.sleepScore ?? 0;
      const sleepHours = latestWellness?.sleepSecs
        ? Number((latestWellness.sleepSecs / 3600).toFixed(1))
        : 0;
      const ftp = effectiveAthleteProfile?.ftp || 250;
      const isRecoveryNeeded =
        hasAnyTelemetry &&
        (tsb < -15 ||
          (sleepScore > 0 && sleepScore < 65) ||
          /unbalanced|low|poor/i.test(hrvStatus));
      const wantsRun = /run|track|pace|5k|10k|marathon|threshold run/i.test(userText);
      const todayIso = new Date().toISOString().slice(0, 10);
      const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      const primaryWorkout: PlannedWorkoutEvent = isRecoveryNeeded
        ? {
            id: `ai-local-${Date.now()}-1`,
            date: todayIso,
            name: wantsRun
              ? 'Autonomic Recovery Aerobic Flush (Z1/Z2)'
              : 'Active Recovery Spin & Parasympathetic Reset',
            sportCategory: wantsRun ? 'Running' : 'Cycling',
            environmentPreference: 'FLEXIBLE',
            plannedDurationSecs: 2700,
            plannedLoad: 34,
            targetZoneSummary: 'Z1–Z2 Active Recovery',
            workoutSyntax: wantsRun
              ? 'Warmup\n- 10m Z1 Pace\n\nMain Set\n- 25m Z2 Easy Pace\n\nCooldown\n- 10m Z1 Jog'
              : 'Warmup\n- 10m 50% FTP\n\nMain Set\n- 25m 58% FTP 90rpm\n\nCooldown\n- 10m 48% FTP',
            description: hasAnyTelemetry
              ? `Adapted for TSB ${tsb >= 0 ? `+${tsb}` : tsb}${hrv > 0 ? ` and HRV ${hrv}ms (${hrvStatus})` : ''}.`
              : 'Baseline aerobic recovery session.',
          }
        : wantsRun
          ? {
              id: `ai-local-${Date.now()}-1`,
              date: todayIso,
              name: 'Cruise Threshold + Aerobic Economy',
              sportCategory: 'Running',
              environmentPreference: 'OUTDOOR',
              plannedDurationSecs: 3600,
              plannedLoad: 72,
              targetZoneSummary: 'Z4 Threshold Intervals',
              workoutSyntax:
                'Warmup\n- 15m Easy Z2\n- 4x20s Strides\n\nMain Set\n- 3x8m at Half Marathon Pace (Z4)\n- 2m Recovery Jog\n\nCooldown\n- 10m Z1 Jog',
              description:
                'Sub-lactate threshold intervals targeting mitochondrial density with manageable acute fatigue.',
            }
          : {
              id: `ai-local-${Date.now()}-1`,
              date: todayIso,
              name: 'Sweet Spot Sustained Aerobic Power',
              sportCategory: 'Cycling',
              environmentPreference: 'INDOOR',
              plannedDurationSecs: 3900,
              plannedLoad: 68,
              targetZoneSummary: '88%–94% FTP Sustained',
              workoutSyntax: `Warmup\n- 10m ramp to 65% FTP\n- 3x1m fast cadence 100rpm\n\nMain Set\n- 2x16m at ${Math.round(
                ftp * 0.9
              )}W (90% FTP)\n- 5m recovery at 50% FTP\n\nCooldown\n- 8m easy spin`,
              description: `Precision sweet-spot intervals adapted for your ${ftp}W threshold baseline.`,
            };

      const secondaryWorkout: PlannedWorkoutEvent = {
        id: `ai-local-${Date.now()}-2`,
        date: tomorrowIso,
        name: 'Aerobic Foundation + Neuromuscular Strides',
        sportCategory: wantsRun ? 'Running' : 'Cycling',
        environmentPreference: 'FLEXIBLE',
        plannedDurationSecs: 3000,
        plannedLoad: 42,
        targetZoneSummary: 'Zone 2 Aerobic Base',
        workoutSyntax: wantsRun
          ? 'Warmup\n- 10m Z1 Easy\n\nMain Set\n- 35m Steady Z2 Pace\n- 4x20s relaxed accelerations\n\nCooldown\n- 5m Walk/Jog'
          : 'Warmup\n- 10m 55% FTP\n\nMain Set\n- 35m 68% FTP Steady Spin (88-92 rpm)\n\nCooldown\n- 5m 50% FTP',
        description: 'Capillary bed development and mitochondrial enzyme recovery.',
      };

      const cited: string[] = [
        `Chronic Training Load (CTL): ${ctl} TSS/day`,
        `Training Stress Balance (TSB): ${tsb >= 0 ? `+${tsb}` : tsb} (${
          tsb < -20 ? 'High Fatigue' : tsb < -5 ? 'Productive Overload' : 'Fresh/Primed'
        })`,
      ];
      if (hrv > 0) {
        cited.push(`Overnight HRV: ${hrv} ms RMSSD (${hrvStatus})`);
      }
      if (sleepScore > 0) {
        cited.push(`Sleep Quality: ${sleepScore}/100 (${sleepHours} hrs)`);
      }
      cited.push(`Current Functional Threshold: ${ftp}W`);

      return {
        content: isRecoveryNeeded
          ? `Based on your current autonomic readiness indicators (TSB ${tsb >= 0 ? `+${tsb}` : tsb}, ${
              sleepScore > 0 ? `Sleep Score ${sleepScore}/100` : ''
            }${hrv > 0 ? `, HRV ${hrv}ms` : ''}), your central nervous system requires an active recovery intervention today rather than high-intensity threshold load. I have staged a parasympathetic recovery session below.`
          : `Your physiological markers indicate a productive training window (CTL ${ctl}, TSB ${tsb >= 0 ? `+${tsb}` : tsb}${
              hrv > 0 ? `, HRV ${hrv}ms ${hrvStatus}` : ''
            }). Your neuromuscular and cardiovascular systems are well-adapted for today’s structured target stimulus:`,
        citedMetrics: cited,
        proposedWorkouts: [primaryWorkout, secondaryWorkout],
      };
    },
    [latestWellness, effectiveActivities.length, effectiveAthleteProfile]
  );

  const handleCancelSendChat = useCallback(() => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
    }
    setIsSendingChat(false);
  }, []);

  const handleSendChatMessage = async (userText: string) => {
    const cleanText =
      userText.trim() ||
      'Analyze my Garmin Sleep, HRV, and CTL/TSB readiness and prescribe today’s optimal workout.';
    const userMsg: CoachChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: cleanText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setIsSendingChat(true);

    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
    }
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 6500);

    try {
      const resp = await fetch('/api/coach/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        signal: controller.signal,
        body: JSON.stringify({
          message: cleanText,
          history: chatMessages.map((m) => ({ role: m.role, content: m.content })),
          telemetrySummary: telemetrySummaryForGemini,
        }),
      });
      window.clearTimeout(timeoutId);
      const data = await resp.json();
      const fallback = buildClientCoachFallback(cleanText);
      const assistantMsg: CoachChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: resp.ok && data.reply ? data.reply : fallback.content,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        citedMetrics:
          Array.isArray(data.citedMetrics) && data.citedMetrics.length > 0
            ? data.citedMetrics
            : fallback.citedMetrics,
        proposedWorkouts:
          Array.isArray(data.proposedWorkouts) && data.proposedWorkouts.length > 0
            ? data.proposedWorkouts
            : fallback.proposedWorkouts,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch {
      window.clearTimeout(timeoutId);
      const fallback = buildClientCoachFallback(cleanText);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `ai-local-${Date.now()}`,
          role: 'assistant',
          content: fallback.content,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          citedMetrics: fallback.citedMetrics,
          proposedWorkouts: fallback.proposedWorkouts,
        },
      ]);
    } finally {
      chatAbortRef.current = null;
      setIsSendingChat(false);
    }
  };

  const handleOpenCoachWithPrompt = useCallback((prompt: string) => {
    if (prompt.trim()) {
      setCoachDraftPrompt(prompt.trim());
    }
    setIsCoachDrawerOpen(true);
  }, []);

  return {
    isCoachDrawerOpen,
    setIsCoachDrawerOpen,
    chatMessages,
    setChatMessages,
    isSendingChat,
    coachDraftPrompt,
    setCoachDraftPrompt,
    handleSendChatMessage,
    handleCancelSendChat,
    handleOpenCoachWithPrompt,
  };
}
