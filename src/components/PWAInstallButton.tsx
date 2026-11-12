import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Smartphone, WifiOff, X } from "./icons/PhosphorIcons";
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'full' }> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  useEffect(() => {
    if (!showGuideModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowGuideModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showGuideModal]);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className={
          variant === 'full'
            ? 'w-full ap-btn-primary text-sm whitespace-nowrap shrink-0 cursor-pointer'
            : 'ap-btn-secondary !min-h-[40px] text-xs whitespace-nowrap shrink-0 cursor-pointer'
        }
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  // Fallback install guide for iOS Safari or desktop browsers inside preview iframe
  return (
    <>
      <button
        onClick={() => setShowGuideModal(true)}
        className={
          variant === 'full'
            ? 'w-full ap-btn-secondary text-sm whitespace-nowrap shrink-0 cursor-pointer'
            : 'ap-btn-secondary !min-h-[40px] text-xs whitespace-nowrap shrink-0 cursor-pointer'
        }
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span>{isIOS ? 'Install on iOS' : 'Install PWA'}</span>
      </button>

      {showGuideModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => setShowGuideModal(false)}
            className="ap-modal-backdrop z-[90]"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Install THRESH as a Standalone App"
              onClick={(e) => e.stopPropagation()}
              className="ap-modal-sheet max-w-md ap-content-stage p-5 sm:p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-2 border-b border-emerald-900/15 dark:border-[#254431] pb-3">
                <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                  Install THRESH as a Standalone App
                </h3>
                <button
                  onClick={() => setShowGuideModal(false)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 shrink-0 cursor-pointer"
                  aria-label="Close install guide"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 space-y-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                <p>
                  THRESH includes a Web App Manifest and offline Service Worker so you can launch it directly from your phone or desktop home screen:
                </p>
                <div className="rounded-lg liquid-glass-subtle p-3.5 space-y-2">
                  <p className="font-medium text-slate-900 dark:text-slate-100">On iPhone / iPad (Safari):</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Open the app URL directly in Safari.</li>
                    <li>Tap the <strong>Share</strong> icon in the bottom toolbar.</li>
                    <li>Select <strong>Add to Home Screen</strong>.</li>
                  </ol>
                </div>
                <div className="rounded-lg liquid-glass-subtle p-3.5 space-y-2">
                  <p className="font-medium text-slate-900 dark:text-slate-100">On Android / Desktop (Chrome or Edge):</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Open the app in a top-level browser tab.</li>
                    <li>Tap <strong>Install THRESH</strong> (or <strong>Install App</strong>) in the browser menu or address bar.</li>
                  </ol>
                </div>
              </div>
              <button
                onClick={() => setShowGuideModal(false)}
                className="mt-5 w-full ap-btn-primary text-sm cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:bottom-4 left-3 right-3 sm:right-auto z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">Offline Mode · Viewing cached workout telemetry</span>
    </div>
  );
};
