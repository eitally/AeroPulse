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
            ? 'w-full min-h-[44px] flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0'
            : 'min-h-[40px] flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0'
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
            ? 'w-full min-h-[44px] flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0'
            : 'min-h-[40px] flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0'
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
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl liquid-glass border border-slate-200 dark:border-slate-800 p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Install AeroPulse as a Standalone App
                </h3>
                <button
                  onClick={() => setShowGuideModal(false)}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  aria-label="Close install guide"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  AeroPulse includes a full Web App Manifest and offline Service Worker so you can launch it directly from your phone or desktop home screen:
                </p>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                  <p className="font-medium text-slate-900 dark:text-slate-100">On iPhone / iPad (Safari):</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Open the deployed app URL directly in Safari.</li>
                    <li>Tap the <strong>Share</strong> icon in the bottom toolbar.</li>
                    <li>Select <strong>Add to Home Screen</strong>.</li>
                  </ol>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                  <p className="font-medium text-slate-900 dark:text-slate-100">On Android / Desktop (Chrome or Edge):</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Open the app in a top-level browser tab (or your Vercel URL).</li>
                    <li>Click the <strong>Install AeroPulse</strong> icon in the address bar or browser menu.</li>
                  </ol>
                </div>
              </div>
              <button
                onClick={() => setShowGuideModal(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
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
    <div className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline Mode · Viewing cached physiological & workout telemetry</span>
    </div>
  );
};
