import React, { useState } from 'react';
import { Check, RefreshCw, Send } from 'lucide-react';
import {
  ActivityEnvironment,
  CoachChatMessage,
  DailyWorkoutOption,
  SportCategory,
} from '../types';

interface CoachViewProps {
  workoutOptions: DailyWorkoutOption[];
  selectedOptionId: string;
  onSelectWorkoutOption: (option: DailyWorkoutOption) => void;
  onGenerateNewOptions: (
    sport: SportCategory,
    environment: ActivityEnvironment,
    durationMinutes: number
  ) => Promise<void>;
  isGeneratingOptions: boolean;
  chatMessages: CoachChatMessage[];
  onSendChatMessage: (message: string) => Promise<void>;
  isSendingChat: boolean;
}

const QUICK_PROMPTS = [
  'How does my morning HRV (71 ms) and sleep score affect today’s interval intensity?',
  'Compare my Outdoor vs. Indoor (Trainer/Treadmill) mileage pacing for 2026.',
  'Analyze my Old La Honda and Skyline Climb Strava segment PR progressions.',
  'Am I on track to hit my 84 CTL target for the Marin Headlands 50K A-Race?',
];

export const CoachView: React.FC<CoachViewProps> = ({
  workoutOptions,
  selectedOptionId,
  onSelectWorkoutOption,
  onGenerateNewOptions,
  isGeneratingOptions,
  chatMessages,
  onSendChatMessage,
  isSendingChat,
}) => {
  const [genSport, setGenSport] = useState<SportCategory>('Cycling');
  const [genEnv, setGenEnv] = useState<ActivityEnvironment>('INDOOR');
  const [genDuration, setGenDuration] = useState<number>(75);
  const [chatInput, setChatInput] = useState('');

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSendingChat) return;
    const msg = chatInput.trim();
    setChatInput('');
    await onSendChatMessage(msg);
  };

  return (
    <div className="space-y-6">
      {/* 1. 3-Option Daily Workout Generator */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              AI Training & Recovery Coach · 3-Option Daily Workout Generator
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Synthesizes your Garmin/Intervals.icu HRV, Sleep Score, CTL/ATL/TSB, annual mileage pacing, and race targets into 3 tailored daily workout options
            </p>
          </div>

          {/* Generator Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={genSport}
              onChange={(e) => setGenSport(e.target.value as SportCategory)}
              className="min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
            >
              <option value="Cycling">Cycling</option>
              <option value="Running">Running</option>
              <option value="Swimming">Swimming</option>
              <option value="Strength">Strength</option>
            </select>

            <select
              value={genEnv}
              onChange={(e) => setGenEnv(e.target.value as ActivityEnvironment)}
              className="min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
            >
              <option value="OUTDOOR">Outdoor (Road / Trail)</option>
              <option value="INDOOR">Indoor (Smart Trainer / Treadmill)</option>
            </select>

            <select
              value={genDuration}
              onChange={(e) => setGenDuration(Number(e.target.value))}
              className="min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
            >
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
              <option value={75}>75 min</option>
              <option value={90}>90 min</option>
              <option value={120}>120 min</option>
            </select>

            <button
              onClick={() => onGenerateNewOptions(genSport, genEnv, genDuration)}
              disabled={isGeneratingOptions}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingOptions ? 'animate-spin' : ''}`} />
              <span>{isGeneratingOptions ? 'Synthesizing Options...' : 'Generate 3 Daily Options'}</span>
            </button>
          </div>
        </div>

        {/* 3 Selectable Daily Workout Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {workoutOptions.map((opt) => {
            const isSelected = opt.id === selectedOptionId;
            return (
              <div
                key={opt.id}
                className={`rounded-xl border p-5 flex flex-col justify-between space-y-4 transition-colors ${
                  isSelected
                    ? 'border-blue-600 dark:border-blue-500 bg-blue-50/30 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span
                      className={
                        opt.tier === 'OPTIMAL'
                          ? 'text-blue-600 dark:text-blue-400 font-semibold'
                          : opt.tier === 'MODULATED'
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : 'text-amber-600 dark:text-amber-400 font-semibold'
                      }
                    >
                      {opt.tierLabel}
                    </span>
                    <span className="text-slate-500">
                      {opt.durationMinutes}m · {opt.estimatedLoad} TSS
                    </span>
                  </div>

                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {opt.title}
                    </h2>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {opt.sportCategory} · {opt.environment === 'INDOOR' ? 'Indoor Trainer/Treadmill' : 'Outdoor Road/Trail'}
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {opt.physiologicalWhy}
                  </p>

                  <div className="space-y-1.5 pt-1">
                    {opt.structuredSteps.map((step, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                      >
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {step.label}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {step.duration} · {step.targetZoneOrOutput}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => onSelectWorkoutOption(opt)}
                  className={`w-full min-h-[40px] rounded-lg px-4 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5" />}
                  <span>{isSelected ? 'Selected for Today' : 'Select This Workout'}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Interactive Multi-Turn Gemini Health, Physiology & Fitness Chat */}
      <section className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Interactive Gemini Health, Physiology & Workout Q&A
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Ask anything about your HRV/sleep trends, aerobic decoupling, Outdoor vs. Indoor trainer/treadmill metrics, Strava segments, or race pacing
          </p>
        </div>

        {/* Quick Prompt Starters */}
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              onClick={() => onSendChatMessage(q)}
              disabled={isSendingChat}
              className="text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 hover:border-blue-500 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Message History */}
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-xl p-4 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white ml-auto max-w-2xl'
                  : 'bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] opacity-75 mb-1.5 font-mono">
                <span>{msg.role === 'user' ? 'Athlete' : 'AeroPulse Gemini Physiologist'}</span>
                <span>{msg.timestamp}</span>
              </div>
              <div className="whitespace-pre-line">{msg.content}</div>
              {msg.citedMetrics && msg.citedMetrics.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-800 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Telemetry Cited:</span>
                  {msg.citedMetrics.map((m, idx) => (
                    <span key={idx} className="text-blue-600 dark:text-blue-400">
                      {m}
                      {idx < msg.citedMetrics!.length - 1 ? ' ·' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {isSendingChat && (
            <div className="rounded-xl p-4 bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 font-mono">
              Analyzing your HRV, CTL/ATL/TSB, annual mileage splits, and Strava segment history...
            </div>
          )}
        </div>

        {/* Chat Input Form */}
        <form onSubmit={handleChatSubmit} className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ask Gemini about your readiness, indoor vs. outdoor workouts, Strava segments, or race goals..."
            className="flex-1 min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={isSendingChat || !chatInput.trim()}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Ask Coach</span>
          </button>
        </form>
      </section>
    </div>
  );
};
