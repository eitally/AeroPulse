import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Activity, CheckCircle2, HelpCircle, Info, Sparkles, TriangleAlert, X } from "./icons/PhosphorIcons";

export interface ChartInfoLiveStatus {
  label: string;
  valueText?: string;
  interpretation?: string;
  tone?: 'optimal' | 'caution' | 'warning' | 'neutral';
  state?: 'optimal' | 'caution' | 'warning' | 'neutral';
}

export interface ChartInfoTooltipProps {
  title: string;
  subtitle?: string;
  whatItMeasures: string;
  benchmarks: string;
  liveStatus?: ChartInfoLiveStatus;
  coachingAction: string;
  align?: 'left' | 'right';
}

export const ChartInfoTooltip: React.FC<ChartInfoTooltipProps> = ({
  title,
  subtitle,
  whatItMeasures,
  benchmarks,
  liveStatus,
  coachingAction,
  align = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 380,
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const updateCoords = useCallback(() => {
    if (!containerRef.current || typeof window === 'undefined') return;
    const rect = containerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(390, Math.max(290, vw - 24));
    let left = align === 'right' ? rect.right - cardWidth : rect.left;
    if (left + cardWidth > vw - 12) left = vw - cardWidth - 12;
    if (left < 12) left = 12;

    let top = rect.bottom + 8;
    const estHeight = 310;
    if (top + estHeight > vh - 12 && rect.top > estHeight + 16) {
      top = Math.max(12, rect.top - estHeight - 8);
    }
    setCoords({ top, left, width: cardWidth });
  }, [align]);

  useEffect(() => {
    if (!isOpen) return;
    updateCoords();

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!popoverRef.current || !popoverRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    const handleWindowChange = () => updateCoords();

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleWindowChange, true);
    window.addEventListener('resize', handleWindowChange);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleWindowChange, true);
      window.removeEventListener('resize', handleWindowChange);
    };
  }, [isOpen, updateCoords]);

  const resolvedTone = liveStatus?.tone || liveStatus?.state || 'neutral';
  const resolvedDescription = liveStatus?.interpretation || liveStatus?.valueText || '';

  const getToneBadgeClasses = (tone: 'optimal' | 'caution' | 'warning' | 'neutral') => {
    switch (tone) {
      case 'optimal':
        return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35';
      case 'caution':
        return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35';
      case 'warning':
        return 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35';
      default:
        return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/35';
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => {
        updateCoords();
        setIsOpen(true);
      }}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          updateCoords();
          setIsOpen((prev) => !prev);
        }}
        aria-label={`Physiological & Coaching Guide: ${title}`}
        title={`What is ${title}?`}
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full transition-all select-none ${
          isOpen
            ? 'bg-blue-500/20 text-blue-600 dark:text-sky-300 border border-blue-500/40 shadow-xs'
            : 'liquid-capsule-track text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-sky-300 border border-transparent hover:border-blue-500/30'
        }`}
      >
        <HelpCircle className="w-3.5 h-3.5 shrink-0 text-blue-500 dark:text-sky-400" />
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
            }}
            className="z-[110] rounded-2xl liquid-glass p-4 shadow-2xl border border-slate-200/90 dark:border-white/15 text-left space-y-3 animate-in fade-in duration-150"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2 border-b border-slate-200/70 dark:border-white/10 pb-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-blue-500 dark:text-sky-400 shrink-0" />
                  <span className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                    {title}
                  </span>
                </div>
                {subtitle && (
                  <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 pl-5">
                    {subtitle}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-sky-300">
                  Physiology Guide
                </span>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  aria-label="Close guide"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Live Athlete Interpretation Pill */}
            {liveStatus && (
              <div
                className={`rounded-xl border px-3 py-2 text-xs space-y-1 ${getToneBadgeClasses(
                  resolvedTone
                )}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5 font-bold">
                  <span className="inline-flex items-center gap-1">
                    {resolvedTone === 'optimal' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    ) : resolvedTone === 'warning' || resolvedTone === 'caution' ? (
                      <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <Activity className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>Live Telemetry Status</span>
                  </span>
                  <span className="font-mono text-[11px]">{liveStatus.label}</span>
                </div>
                {resolvedDescription && (
                  <p className="text-[11px] opacity-95 font-sans leading-relaxed">
                    {resolvedDescription}
                  </p>
                )}
              </div>
            )}

            {/* 1. What It Measures */}
            <div className="space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                1. Physiological Mechanism
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-normal">
                {whatItMeasures}
              </p>
            </div>

            {/* 2. Benchmarks */}
            <div className="space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                2. Reference Benchmarks
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-mono bg-slate-100/70 dark:bg-slate-900/60 rounded-lg px-2.5 py-1.5 border border-slate-200/60 dark:border-white/5">
                {benchmarks}
              </p>
            </div>

            {/* 3. Coaching Action */}
            <div className="space-y-1 pt-0.5">
              <div className="text-[10px] font-mono uppercase tracking-wider text-blue-600 dark:text-sky-400 font-semibold flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>3. Performance Coach Prescription</span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-medium">
                {coachingAction}
              </p>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
