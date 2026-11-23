import React, { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
} from '../icons/PhosphorIcons';

export interface AuthByoStravaKeysSectionProps {
  showCustomStravaKeys: boolean;
  setShowCustomStravaKeys: React.Dispatch<React.SetStateAction<boolean>>;
  currentHostname: string;
  stravaClientId: string;
  setStravaClientId: (val: string) => void;
  stravaClientSecret: string;
  setStravaClientSecret: (val: string) => void;
  savedStravaClientId?: string;
  busy: boolean;
  setIsExchanging: (val: boolean) => void;
  onClearStepNotice: () => void;
  onSaveKeysAndLaunchStrava: (e: React.FormEvent) => Promise<void>;
  onExchangeStravaCode?: (codeOrUrl: string) => Promise<void>;
  onSaveStravaDirectToken?: (refreshToken: string, accessToken?: string) => Promise<void>;
}

export const AuthByoStravaKeysSection: React.FC<AuthByoStravaKeysSectionProps> = ({
  showCustomStravaKeys,
  setShowCustomStravaKeys,
  currentHostname,
  stravaClientId,
  setStravaClientId,
  stravaClientSecret,
  setStravaClientSecret,
  savedStravaClientId,
  busy,
  setIsExchanging,
  onClearStepNotice,
  onSaveKeysAndLaunchStrava,
  onExchangeStravaCode,
  onSaveStravaDirectToken,
}) => {
  const [manualCodeInput, setManualCodeInput] = useState('');
  const [directRefreshToken, setDirectRefreshToken] = useState('');
  const [copiedDomain, setCopiedDomain] = useState(false);

  const handleCopyDomain = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(currentHostname).catch(() => {});
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2000);
    }
  };

  const handleManualExchangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCodeInput.trim() && !directRefreshToken.trim()) return;
    setIsExchanging(true);
    onClearStepNotice();
    try {
      if (directRefreshToken.trim() && onSaveStravaDirectToken) {
        await onSaveStravaDirectToken(directRefreshToken.trim());
        setDirectRefreshToken('');
      } else if (manualCodeInput.trim() && onExchangeStravaCode) {
        await onExchangeStravaCode(manualCodeInput.trim());
        setManualCodeInput('');
      }
    } finally {
      setIsExchanging(false);
    }
  };

  return (
    <div className="pt-2 border-t border-ap-frame/20 dark:border-white/15">
      <button
        type="button"
        onClick={() => setShowCustomStravaKeys((prev) => !prev)}
        className="w-full flex items-center justify-between text-xs font-semibold text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white cursor-pointer py-1"
      >
        <span>Self-hosting MeetReady? Configure Strava API Keys</span>
        {showCustomStravaKeys ? (
          <ChevronUp className="w-4 h-4 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 shrink-0" />
        )}
      </button>

      {showCustomStravaKeys && (
        <div className="mt-2 rounded-xl ap-card-inset p-3.5 space-y-3 text-xs">
          <ol className="space-y-2 text-ap-ink/85 dark:text-ap-chalk/85 list-decimal list-inside leading-relaxed">
            <li>
              Open{' '}
              <a
                href="https://www.strava.com/settings/api"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline ap-text-brand inline-flex items-center gap-1"
              >
                <span>strava.com/settings/api</span>
                <ExternalLink className="w-3 h-3" />
              </a>{' '}
              and set <strong>Authorization Callback Domain</strong> to:
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-ap-carbon px-3 py-1.5 font-mono">
                <span className="font-bold text-ap-ink dark:text-white truncate">
                  {currentHostname}
                </span>
                <button
                  type="button"
                  onClick={handleCopyDomain}
                  className="inline-flex items-center gap-1 text-xs font-semibold ap-text-brand shrink-0 cursor-pointer"
                >
                  {copiedDomain ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-ap-emerald" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </li>
            <li>Enter your Strava API Client ID and Secret:</li>
          </ol>

          <form onSubmit={onSaveKeysAndLaunchStrava} className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                required
                aria-label="Strava API Client ID"
                value={stravaClientId}
                onChange={(e) => setStravaClientId(e.target.value)}
                placeholder="Client ID (e.g. 123456)"
                className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg bg-white dark:bg-ap-carbon px-3 py-1.5 text-xs font-mono text-ap-ink dark:text-ap-chalk"
              />
              <input
                type="password"
                aria-label="Strava API Client Secret"
                value={stravaClientSecret}
                onChange={(e) => setStravaClientSecret(e.target.value)}
                placeholder={
                  savedStravaClientId ? 'Client Secret (saved)' : 'Client Secret'
                }
                className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg bg-white dark:bg-ap-carbon px-3 py-1.5 text-xs font-mono text-ap-ink dark:text-ap-chalk"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !stravaClientId.trim()}
              className="w-full min-h-[44px] rounded-lg bg-ap-ink text-white dark:bg-ap-chalk dark:text-ap-obsidian disabled:opacity-50 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Save Keys &amp; Authorize Strava</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </form>

          {(onExchangeStravaCode || onSaveStravaDirectToken) && (
            <details className="pt-1.5">
              <summary className="cursor-pointer text-xs font-medium text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white select-none">
                Or paste a Strava Refresh Token / localhost callback URL
              </summary>
              <form onSubmit={handleManualExchangeSubmit} className="mt-2 space-y-2">
                <input
                  type="text"
                  aria-label="Strava Refresh Token or localhost callback URL"
                  value={directRefreshToken || manualCodeInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.includes('code=') || val.startsWith('http')) {
                      setManualCodeInput(val);
                      setDirectRefreshToken('');
                    } else {
                      setDirectRefreshToken(val);
                      setManualCodeInput(val);
                    }
                  }}
                  placeholder="Paste Refresh Token or http://localhost/...?code=..."
                  className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg bg-white dark:bg-ap-carbon px-3 py-1.5 text-xs font-mono text-ap-ink dark:text-ap-chalk"
                />
                <button
                  type="submit"
                  disabled={
                    busy || (!manualCodeInput.trim() && !directRefreshToken.trim())
                  }
                  className="w-full min-h-[44px] rounded-lg ap-card-inset text-xs font-bold cursor-pointer"
                >
                  Verify &amp; Connect
                </button>
              </form>
            </details>
          )}
        </div>
      )}
    </div>
  );
};
