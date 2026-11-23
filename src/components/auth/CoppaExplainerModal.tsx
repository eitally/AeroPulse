import React, { useRef } from 'react';
import { ShieldCheck, X } from '../icons/PhosphorIcons';
import { useModalDialog } from '../../hooks/useModalDialog';

export interface CoppaExplainerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CoppaExplainerModal: React.FC<CoppaExplainerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalDialog({ isOpen, onClose, dialogRef });

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="coppa-explainer-title"
      tabIndex={-1}
      data-testid="coppa-explainer-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65"
    >
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto ap-card rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-ap-emerald shrink-0" weight="fill" />
            <h2
              id="coppa-explainer-title"
              className="text-base sm:text-lg font-extrabold text-ap-ink dark:text-ap-chalk"
            >
              COPPA 13+ &amp; Youth Athlete Protection
            </h2>
          </div>
          <button
            type="button"
            data-testid="coppa-explainer-close"
            aria-label="Close COPPA explanation"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -m-1.5 rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs sm:text-sm leading-relaxed text-ap-ink/90 dark:text-ap-chalk/90">
          <div className="rounded-xl ap-card-inset p-3.5 space-y-1">
            <div className="font-bold text-ap-ink dark:text-ap-chalk">
              1. Accounts require athletes to be 13 or older (Federal COPPA)
            </div>
            <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
              Athletes under age 13 cannot register personal MeetReady logins or connect personal
              wearable accounts.
            </p>
          </div>

          <div className="rounded-xl ap-card-inset p-3.5 space-y-1">
            <div className="font-bold text-ap-ink dark:text-ap-chalk">
              2. Under-13 athletes can still be timed trackside
            </div>
            <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
              Coaches use MeetReady&apos;s Trackside Stopwatch and Field Events Sheet watchlessly
              to time races and record marks without creating child accounts or collecting child
              emails.
            </p>
          </div>

          <div className="rounded-xl ap-card-inset p-3.5 space-y-1">
            <div className="font-bold text-ap-ink dark:text-ap-chalk">
              3. Ages 13–17 enforce Parent / Guardian visibility (SafeSport MAAPP)
            </div>
            <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
              High school and youth athletes aged 13–17 automatically include Guardian CC on
              coach–athlete messages and workout comments — private 1:1 adult–minor messaging is
              never allowed.
            </p>
          </div>

          <div className="rounded-xl ap-card-inset p-3.5 space-y-1">
            <div className="font-bold text-ap-ink dark:text-ap-chalk">
              4. SafeSport Weight Shield &amp; No Advertising. Ever.
            </div>
            <p className="text-xs text-ap-muted dark:text-ap-muted-dark">
              Body weight, BMI, and power-to-weight ratios are stripped from team views by
              default, and athlete data is never used for advertising or sold to third parties.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl bg-ap-volt hover:brightness-95 text-ap-obsidian font-extrabold text-xs cursor-pointer"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
