import React from 'react';

export const PENDING_TEAM_JOIN_STORAGE_KEY = 'thresh_pending_team_join_v1';

export interface StoredPendingJoin {
  codeOrSlug: string;
  slug?: string;
  token: string;
  email?: string;
}

export function detectInitialJoinParams(): StoredPendingJoin {
  if (typeof window === 'undefined') return { codeOrSlug: '', token: '' };
  const pathMatch = window.location.pathname.match(/^\/join\/([^/?#]+)/i);
  const params = new URLSearchParams(window.location.search);
  const queryJoin = (params.get('join') || params.get('team') || '').trim();
  const token = (params.get('t') || params.get('token') || '').trim();
  const queryEmail = (params.get('email') || params.get('e') || '').trim().toLowerCase();
  const slug = pathMatch ? decodeURIComponent(pathMatch[1]).trim() : '';
  const codeOrSlug = slug || queryJoin;
  if (codeOrSlug) {
    return { codeOrSlug, slug: slug || undefined, token, email: queryEmail || undefined };
  }
  try {
    const saved = sessionStorage.getItem(PENDING_TEAM_JOIN_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as StoredPendingJoin;
      if (parsed?.codeOrSlug) return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return { codeOrSlug: '', token: '', email: queryEmail || undefined };
}

export function detectEmbeddedWebView(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Instagram|FBAN|FBAV|GroupMe|Line\/|Snapchat|TikTok|BytedanceWebview|LinkedInApp/i.test(ua);
}

export const GoogleGIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.665-5.17 3.665-9.09z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.09C3.26 21.36 7.33 24 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.59H1.26C.46 8.19 0 9.99 0 12s.46 3.81 1.26 5.41l4.02-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.26 6.59l4.02 3.09c.95-2.83 3.6-4.93 6.72-4.93z"
    />
  </svg>
);

export const StravaChevronMark: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
  </svg>
);

export const SEED_EVENT_PILLS: Array<{
  id: string;
  label: string;
  sport: 'Running' | 'Cycling';
  prefix: string;
  placeholder: string;
}> = [
  { id: '5k', label: '5K Race', sport: 'Running', prefix: '5K ', placeholder: 'e.g. 18:45' },
  { id: '3200m', label: '3200m', sport: 'Running', prefix: '3200m ', placeholder: 'e.g. 10:15' },
  { id: '1600m', label: '1600m / Mile', sport: 'Running', prefix: '1600m ', placeholder: 'e.g. 4:52' },
  { id: '800m', label: '800m', sport: 'Running', prefix: '800m ', placeholder: 'e.g. 2:04' },
  { id: '400m', label: '400m', sport: 'Running', prefix: '400m ', placeholder: 'e.g. 51.4' },
  { id: '200m', label: '200m', sport: 'Running', prefix: '200m ', placeholder: 'e.g. 22.8' },
  { id: '100m', label: '100m', sport: 'Running', prefix: '100m ', placeholder: 'e.g. 11.2' },
  { id: 'hurdles', label: '100H / 110H / 300H', sport: 'Running', prefix: '300mH ', placeholder: 'e.g. 41.5' },
  { id: 'jumps', label: 'LJ / TJ / HJ', sport: 'Running', prefix: 'LJ ', placeholder: "e.g. 21' 6\"" },
  { id: 'pv', label: 'Pole Vault', sport: 'Running', prefix: 'PV ', placeholder: "e.g. 14' 0\"" },
  { id: 'throws', label: 'Shot / Discus', sport: 'Running', prefix: 'Shot ', placeholder: "e.g. 46' 2\"" },
  { id: 'ftp', label: 'Known FTP', sport: 'Cycling', prefix: '', placeholder: 'e.g. 265W' },
  { id: '20m', label: '20m Power', sport: 'Cycling', prefix: '20m ', placeholder: 'e.g. 280W' },
];
