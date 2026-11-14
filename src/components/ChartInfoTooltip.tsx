import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Activity, CheckCircle2, HelpCircle, Sparkles, TriangleAlert, X } from './icons/PhosphorIcons';

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

    const handlePointerDownOutside = (e: PointerEvent) => {
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
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    };
    const handleWindowChange = () => updateCoords();

    document.addEventListener('pointerdown', handlePointerDownOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleWindowChange, true);
    window.addEventListener('resize', handleWindowChange);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside);
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
        return 'ap-status-prime';
      case 'caution':
        return 'ap-status-caution';
      case 'warning':
        return 'ap-status-strained';
      default:
        return 'ap-status-info';
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center align-middle"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          updateCoords();
          setIsOpen(true);
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          updateCoords();
          setIsOpen((prev) => !prev);
        }}
        aria-label={`Physiological & Coaching Guide: ${title}`}
        aria-expanded={isOpen}
        title={`What is ${title}?`}
        className="inline-flex items-center justify-center -m-1.5 p-1.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#558B00] dark:focus-visible:ring-[#C8FF00]"
      >
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors select-none ${
            isOpen
              ? 'bg-[#F7FEE7] dark:bg-[#C8FF00]/15 text-[#3F6212] dark:text-[#C8FF00] border border-[#BEF264] dark:border-[#C8FF00]/40'
              : 'liquid-capsule-track text-[#525866] dark:text-slate-400 hover:opacity-85'
          }`}
        >
          <HelpCircle className="w-3.5 h-3.5 shrink-0 ap-text-brand" />
        </span>
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            data-thresh-popover-open="true"
            role="dialog"
            aria-modal="false"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse') setIsOpen(true);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setIsOpen(false);
            }}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
            }}
            className="z-[110] rounded-2xl liquid-glass p-4 shadow-2xl text-left space-y-3"
          >
            <div className="flex items-start justify-between gap-2 border-b border-black/8 dark:border-white/10 pb-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 ap-text-brand shrink-0" />
                  <span className="text-xs font-bold text-[#111318] dark:text-white leading-snug">
                    {title}
                  </span>
                </div>
                {subtitle && (
                  <p className="text-2xs font-mono text-[#525866] dark:text-slate-400 mt-0.5 pl-5">
                    {subtitle}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-2xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ap-status-info">
                  Guide
                </span>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg text-[#525866] hover:text-[#111318] dark:text-slate-400 dark:hover:text-white"
                  aria-label="Close guide"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {liveStatus && (
              <div
                className={`rounded-xl px-3 py-2 text-xs space-y-1 ${getToneBadgeClasses(
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
                    <span>Live Status</span>
                  </span>
                  <span className="font-mono text-2xs">{liveStatus.label}</span>
                </div>
                {resolvedDescription && (
                  <p className="text-xs font-sans leading-relaxed">{resolvedDescription}</p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <h4 className="ap-telemetry-label">Physiological Mechanism</h4>
              <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                {whatItMeasures}
              </p>
            </div>

            <div className="space-y-1">
              <h4 className="ap-telemetry-label">Reference Benchmarks</h4>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-mono ap-card-inset rounded-lg px-2.5 py-1.5">
                {benchmarks}
              </p>
            </div>

            <div className="space-y-1 pt-0.5">
              <h4 className="ap-telemetry-label flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Coaching Action</span>
              </h4>
              <p className="text-xs text-[#101411] dark:text-slate-200 leading-relaxed font-medium">
                {coachingAction}
              </p>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
