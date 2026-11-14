import React, { useRef, useState } from 'react';
import { Bot, CalendarPlus, Check, KeyRound, Send, Sparkles, X } from "./icons/PhosphorIcons";
import { useModalDialog } from '../hooks/useModalDialog';
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
  onCancelSend?: () => void;
  initialDraftPrompt?: string;
  onClearDraftPrompt?: () => void;
  onScheduleProposedWorkout: (workout: PlannedWorkoutEvent) => Promise<void>;
  hasGeminiKey?: boolean;
  onSaveGeminiApiKey?: (apiKey: string) => Promise<void>;
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
  onCancelSend,
  initialDraftPrompt,
  onClearDraftPrompt,
  onScheduleProposedWorkout,
  hasGeminiKey = false,
  onSaveGeminiApiKey,
}) => {
  const [input, setInput] = useState('');
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set());
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useModalDialog({
    isOpen,
    onClose,
    dialogRef,
    initialFocusRef: inputRef,
  });

  React.useEffect(() => {
    if (isOpen && initialDraftPrompt && initialDraftPrompt.trim()) {
      setInput(initialDraftPrompt.trim());
      onClearDraftPrompt?.();
      setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
    }
  }, [isOpen, initialDraftPrompt, onClearDraftPrompt]);

  if (!isOpen) return null;

  const submitChatMessage = () => {
    if (isSendingChat) return;
    const textToSend =
      input.trim() ||
      'Analyze my Garmin Sleep, HRV, and CTL/TSB readiness and prescribe today’s optimal workout.';
    onSendChatMessage(textToSend);
    setInput('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitChatMessage();
  };

  const handleSaveKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveGeminiApiKey) return;
    setSavingKey(true);
    try {
      await onSaveGeminiApiKey(apiKeyDraft.trim());
      setShowKeyForm(false);
      setApiKeyDraft('');
    } finally {
      setSavingKey(false);
    }
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
    <div
      onClick={onClose}
      className="fixed inset-0 z-[65] flex justify-end bg-[#070F0B]/76"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="thresh-ai-coach-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg h-full bg-white dark:bg-[#080A09] border-l border-[#558B00] dark:border-[#C8FF00] shadow-2xl flex flex-col"
      >
        {/* Drawer Header */}
        <div className="relative px-4 sm:px-5 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-3.5 border-b border-lime-600/25 dark:border-[#C8FF00]/20 flex items-center justify-between gap-3 bg-[#F8FAEE] dark:bg-[#111714] overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[4px] ap-brand-hairline pointer-events-none" />
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#C8FF00] border border-[#65A30D] flex items-center justify-center text-[#080A09] shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2
                  id="thresh-ai-coach-title"
                  className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate"
                >
                  THRESH AI Coach
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-mono font-semibold ap-status-prime">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {hasGeminiKey ? 'Gemini Live' : 'AI Ready'}
                </span>
              </div>
              <p className="text-2xs text-slate-600 dark:text-slate-300 truncate">
                Context: {activeViewName} · Schedules to Training Calendar
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onSaveGeminiApiKey && !hasGeminiKey && (
              <button
                type="button"
                onClick={() => setShowKeyForm((prev) => !prev)}
                className="min-h-[44px] px-2.5 py-1.5 rounded-lg text-2xs font-mono text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white border border-slate-300 dark:border-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                title="Optional: Override or add custom Gemini API Key"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Key</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white cursor-pointer"
              aria-label="Close AI Coach drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Optional Collapsible Gemini API Key Override Bar */}
        {showKeyForm && onSaveGeminiApiKey && (
          <form
            onSubmit={handleSaveKeySubmit}
            className="px-4 py-3 bg-slate-100/90 dark:bg-[#101B15] border-b border-slate-200 dark:border-[#244331] space-y-2"
          >
            <div className="flex items-center justify-between text-2xs">
              <label
                htmlFor="thresh-ai-coach-gemini-key"
                className="font-semibold text-slate-800 dark:text-slate-200"
              >
                Optional Custom Gemini API Key (<code className="font-mono">GEMINI_API_KEY</code>)
              </label>
              <button
                type="button"
                onClick={() => setShowKeyForm(false)}
                className="min-h-[36px] px-2 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white text-2xs font-mono cursor-pointer"
              >
                Close ✕
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="thresh-ai-coach-gemini-key"
                type="password"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                placeholder="Paste AIzaSy... key (or leave blank to use server env / Physiology Engine)"
                className="flex-1 min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#558B00] dark:focus:ring-[#C8FF00]"
              />
              <button
                type="submit"
                disabled={savingKey}
                className="min-h-[40px] px-3.5 py-1.5 rounded-lg ap-btn-primary text-xs font-semibold cursor-pointer"
              >
                {savingKey ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {/* Live Garmin Sleep, HRV & Training Status Context Strip */}
        {latestWellness && (
          <div className="px-4 py-2.5 bg-slate-100/80 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs font-mono tabular-nums">
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
              className="shrink-0 text-2xs px-2.5 py-1 rounded-md liquid-glass-subtle hover:bg-emerald-950/8 dark:hover:bg-emerald-400/12 text-emerald-950 dark:text-emerald-100 transition-colors"
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
                    ? 'bg-[#1C5436] text-white dark:bg-[#C8FF00] dark:text-[#080A09]'
                    : 'bg-slate-100 dark:bg-[#101B15] border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                }`}
              >
                <div className="whitespace-pre-line">{msg.content}</div>

                {/* Cited Physiological Metrics */}
                {msg.citedMetrics && msg.citedMetrics.length > 0 && (
                  <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800 flex flex-wrap gap-1.5 font-mono text-2xs">
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
                      <span className="text-2xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
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
                              <div className="text-2xs font-mono text-slate-500">
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
                              className={`min-h-[30px] px-2.5 py-1 rounded-md text-2xs font-semibold flex items-center gap-1 shrink-0 transition-colors ${
                                isScheduled
                                  ? 'bg-emerald-600/20 text-emerald-500 border border-emerald-500/30'
                                  : 'bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09]'
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
                            <pre className="text-2xs font-mono text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800 overflow-x-auto">
                              {pw.workoutSyntax}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <span className="text-2xs text-slate-600 dark:text-slate-400 mt-1 font-mono">{msg.timestamp}</span>
            </div>
          ))}

          {isSendingChat && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl bg-slate-100 dark:bg-[#101B15] border border-slate-200 dark:border-[#244331] px-4 py-3 text-xs text-slate-600 dark:text-slate-300 font-mono flex items-center justify-between gap-2"
            >
              <span>Analyzing telemetry &amp; designing workout...</span>
              {onCancelSend && (
                <button
                  type="button"
                  onClick={onCancelSend}
                  className="min-h-[36px] px-2.5 py-1 rounded bg-slate-200 dark:bg-[#15231B] text-slate-700 dark:text-slate-200 text-2xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>

        {/* Input Form */}
        <form
          onSubmit={handleSubmit}
          className="px-3.5 pt-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] border-t border-slate-200 dark:border-[#244331] bg-white dark:bg-[#101B15] flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            aria-label="Message THRESH AI Coach"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about cycling/running plans, sleep, or click Send for today's Rx..."
            className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-[#2B543B] bg-slate-50 dark:bg-[#15231B] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#558B00] dark:focus:ring-[#C8FF00]"
          />
          {isSendingChat && onCancelSend ? (
            <button
              type="button"
              onClick={onCancelSend}
              className="min-h-[44px] px-4 py-2 rounded-xl ap-btn-secondary text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSendingChat}
              onClick={(e) => {
                e.preventDefault();
                submitChatMessage();
              }}
              className="min-h-[44px] px-4 py-2 rounded-xl ap-btn-primary disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          )}
        </form>
      </div>
    </div>
  );
};
