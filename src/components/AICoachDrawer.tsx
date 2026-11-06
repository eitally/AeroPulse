import React, { useState } from 'react';
import { Bot, CalendarPlus, Check, Send, Sparkles, X } from 'lucide-react';
import {
  CoachChatMessage,
  PlannedWorkoutEvent,
  UnifiedWellnessDay,
} from '../types';

interface AICoachDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeViewName: string;
  latestWellness?: UnifiedWellnessDay;
  chatMessages: CoachChatMessage[];
  onSendChatMessage: (message: string) => void;
  isSendingChat: boolean;
  onScheduleProposedWorkout: (workout: PlannedWorkoutEvent) => Promise<void>;
}

const QUICK_COACH_PROMPTS = [
  'Design a 5-day cycling + running schedule starting today based on my Garmin Sleep & HRV.',
  'Give me an indoor smart-trainer threshold workout for today and schedule it.',
  'Build a 1-week running speed + aerobic base block around my track intervals.',
  'How is my Garmin Sleep Score and HRV affecting my Training Status right now?',
];

export const AICoachDrawer: React.FC<AICoachDrawerProps> = ({
  isOpen,
  onClose,
  activeViewName,
  latestWellness,
  chatMessages,
  onSendChatMessage,
  isSendingChat,
  onScheduleProposedWorkout,
}) => {
  const [input, setInput] = useState('');
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set());
  const [schedulingId, setSchedulingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSendingChat) return;
    onSendChatMessage(input.trim());
    setInput('');
  };

  const handleScheduleOne = async (pw: PlannedWorkoutEvent) => {
    setSchedulingId(pw.id);
    try {
      await onScheduleProposedWorkout(pw);
      setScheduledIds((prev) => new Set([...prev, pw.id]));
    } finally {
      setSchedulingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-lg h-full bg-white dark:bg-[#0B0F17] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
        {/* Drawer Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-[#111827]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-500">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                AeroPulse AI Training & Program Coach
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Context: {activeViewName} · Schedules directly to Training Calendar
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white"
            aria-label="Close AI Coach drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Garmin Sleep, HRV & Training Status Context Strip */}
        {latestWellness && (
          <div className="px-4 py-2.5 bg-slate-100/80 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              {latestWellness.garminTrainingStatus || 'Productive'}
            </span>
            <span className="text-blue-500">
              CTL {latestWellness.ctl} / TSB{' '}
              {latestWellness.tsb > 0 ? `+${latestWellness.tsb}` : latestWellness.tsb}
            </span>
            {latestWellness.sleepSecs > 0 && (
              <span className="text-indigo-500 dark:text-indigo-400">
                Sleep {(latestWellness.sleepSecs / 3600).toFixed(1)}h (Score{' '}
                {latestWellness.sleepScore})
              </span>
            )}
            {latestWellness.hrvRMSSD > 0 && (
              <span className="text-slate-600 dark:text-slate-300">
                HRV {latestWellness.hrvRMSSD}ms ({latestWellness.hrvStatus || 'Balanced'})
              </span>
            )}
          </div>
        )}

        {/* Quick Prompts */}
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex gap-2 overflow-x-auto">
          {QUICK_COACH_PROMPTS.map((q, idx) => (
            <button
              key={idx}
              onClick={() => onSendChatMessage(q)}
              disabled={isSendingChat}
              className="shrink-0 text-[11px] px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Chat Message History + Interactive Proposed Calendar Workout Cards */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-[92%] rounded-xl px-4 py-3 text-xs leading-relaxed space-y-2.5 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                }`}
              >
                <div className="whitespace-pre-line">{msg.content}</div>

                {/* Cited Physiological Metrics */}
                {msg.citedMetrics && msg.citedMetrics.length > 0 && (
                  <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800 flex flex-wrap gap-1.5 font-mono text-[10px]">
                    {msg.citedMetrics.map((cm, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900 text-blue-600 dark:text-blue-400 border border-slate-200 dark:border-slate-800"
                      >
                        {cm}
                      </span>
                    ))}
                  </div>
                )}

                {/* Proposed Scheduleable Workouts */}
                {msg.proposedWorkouts && msg.proposedWorkouts.length > 0 && (
                  <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" />
                        Proposed Training Schedule ({msg.proposedWorkouts.length} Sessions)
                      </span>
                    </div>

                    {msg.proposedWorkouts.map((pw) => {
                      const isScheduled = scheduledIds.has(pw.id);
                      const isBusy = schedulingId === pw.id;
                      return (
                        <div
                          key={pw.id}
                          className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[10px] font-mono text-slate-500">
                                {pw.date} · {pw.sportCategory} ({pw.environmentPreference}) ·{' '}
                                {Math.round(pw.plannedDurationSecs / 60)}m · ~{pw.plannedLoad} TSS
                              </div>
                              <div className="font-bold text-slate-900 dark:text-slate-100 text-xs mt-0.5">
                                {pw.name}
                              </div>
                            </div>

                            <button
                              onClick={() => handleScheduleOne(pw)}
                              disabled={isScheduled || isBusy}
                              className={`min-h-[30px] px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 shrink-0 transition-colors ${
                                isScheduled
                                  ? 'bg-emerald-600/20 text-emerald-500 border border-emerald-500/30'
                                  : 'bg-blue-600 hover:bg-blue-500 text-white'
                              }`}
                            >
                              {isScheduled ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  <span>On Calendar</span>
                                </>
                              ) : (
                                <>
                                  <CalendarPlus className="w-3 h-3" />
                                  <span>{isBusy ? 'Adding...' : 'Schedule'}</span>
                                </>
                              )}
                            </button>
                          </div>

                          {pw.workoutSyntax && (
                            <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800 overflow-x-auto">
                              {pw.workoutSyntax}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-400 mt-1 font-mono">{msg.timestamp}</span>
            </div>
          ))}

          {isSendingChat && (
            <div className="rounded-xl bg-slate-100 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-500 font-mono">
              Analyzing Garmin Sleep, HRV, CTL/ATL/TSB & designing training prescription...
            </div>
          )}
        </div>

        {/* Input Form */}
        <form
          onSubmit={handleSubmit}
          className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about cycling/running plans, sleep, or schedule workouts..."
            className="flex-1 min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={isSendingChat || !input.trim()}
            className="min-h-[40px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
