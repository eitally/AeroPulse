import {
  computeAccessibleTeamPalette,
  escapeTextForSafeAttr,
} from './teamQrHelper';
import type { TeamBrandConfig } from '../types';

const STYLE_ELEMENT_ID = 'thresh-team-brand-vars';

export function getTeamMonogramInitials(shortName?: string, fullName?: string): string {
  const source = (shortName || fullName || 'TM').trim();
  const words = source.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'TM';
}

function buildTeamFaviconDataUri(_accentLight: string, accentDark: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect x="2" y="2" width="124" height="124" rx="28" fill="#0B1911" stroke="${accentDark}" stroke-width="3.5"/><g transform="translate(64 66) scale(0.84) translate(-64 -70)"><g fill="#475569"><path d="M 47.74 88.33 A 23.4 23.4 0 0 1 51.6 51.66 L 55.73 58.27 A 15.6 15.6 0 0 0 53.16 82.72 Z"/><path d="M 39.41 96.96 A 35.4 35.4 0 0 1 56.64 36.87 L 58.26 44.5 A 27.6 27.6 0 0 0 44.83 91.35 Z"/><path d="M 31.07 105.6 A 47.4 47.4 0 0 1 70.6 24.56 L 69.51 32.29 A 39.6 39.6 0 0 0 36.49 99.99 Z"/></g><g fill="${accentDark}"><path d="M 54.44 50.03 A 23.5 23.5 0 0 1 86.99 66.61 L 79.16 68.28 A 15.5 15.5 0 0 0 57.7 57.34 Z"/><path d="M 61.52 36.09 A 35.5 35.5 0 0 1 98.72 64.12 L 90.9 65.78 A 27.5 27.5 0 0 0 62.08 44.07 Z"/><path d="M 77.09 25.84 A 47.5 47.5 0 0 1 110.46 61.62 L 102.64 63.29 A 39.5 39.5 0 0 0 74.89 33.53 Z"/><path d="M 22.6 114.37 A 59.6 59.6 0 1 1 122.3 59.11 L 114.28 60.81 A 51.4 51.4 0 1 0 28.29 108.47 Z"/></g><line x1="78.46" y1="70.49" x2="120.5" y2="67.55" stroke="${accentDark}" stroke-width="4.2" stroke-linecap="round"/><path d="M 58.73 66.59 L 102.53 30.18 L 69.27 76.41 Z" fill="${accentDark}" stroke="#0B1911" stroke-width="7.4" stroke-linejoin="round" style="paint-order:stroke fill"/><circle cx="64" cy="71.5" r="11.8" fill="${accentDark}" stroke="#0B1911" stroke-width="4.6" style="paint-order:stroke fill"/><circle cx="64" cy="71.5" r="4.5" fill="#0B1911"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Dynamically injects WCAG 2.1 AA contrast-clamped school/club accent tokens into
 * the document chrome (`.ap-content-stage`, `.ap-brand-hairline`, `.ap-btn-primary`, `.ap-nav-volt-active`)
 * AND re-themes the browser tab's THRESH Gauge SVG favicon to the team's primary color,
 * while strictly preserving THRESH physiological zone colors (`Z1–Z7`) and Readiness signals.
 */
export function applyTeamBrandToDocument(brand: TeamBrandConfig | null | undefined): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  const faviconEl = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;

  if (!brand) {
    if (existing) existing.remove();
    if (faviconEl && faviconEl.getAttribute('href') !== '/icon.svg?v=2') {
      faviconEl.setAttribute('href', '/icon.svg?v=2');
    }
    return;
  }

  const palette = computeAccessibleTeamPalette(brand.primaryHex, brand.secondaryHex);
  const css = `
    :root {
      --ap-brand-volt: ${palette.primaryOnLight};
      --ap-brand-primary: ${palette.primaryOnLight};
      --ap-action-cobalt: ${palette.primaryOnLight};
      --ap-thresh-vermilion: ${palette.primaryOnLight};
      --ap-content-border: ${palette.primaryOnLight};
      --ap-team-primary: ${palette.primaryOnLight};
      --ap-team-secondary: ${palette.secondaryOnLight};
    }
    .dark {
      --ap-brand-volt: ${palette.primaryOnDark};
      --ap-brand-primary: ${palette.primaryOnDark};
      --ap-action-cobalt: ${palette.primaryOnDark};
      --ap-thresh-vermilion: ${palette.primaryOnDark};
      --ap-content-border: ${palette.primaryOnDark};
      --ap-team-primary: ${palette.primaryOnDark};
      --ap-team-secondary: ${palette.secondaryOnDark};
    }
    .ap-brand-hairline {
      background: ${palette.hairlineGradientLight};
    }
    .dark .ap-brand-hairline {
      background: ${palette.hairlineGradientDark};
    }
    .ap-header-bar,
    .liquid-glass-header {
      border-color: ${palette.primaryOnLight};
    }
    .dark .ap-header-bar,
    .dark .liquid-glass-header {
      border-color: ${palette.primaryOnDark};
    }
    .ap-btn-primary,
    .dark .ap-btn-primary,
    .ap-nav-volt-active,
    .dark .ap-nav-volt-active {
      background-color: ${palette.primaryOnLight};
      color: ${palette.textOnPrimaryLight};
      border-color: transparent;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
    }
    .ap-btn-primary:hover,
    .dark .ap-btn-primary:hover {
      background-color: ${palette.primaryOnLight};
      filter: brightness(0.92);
    }
  `;

  if (existing) {
    existing.textContent = css;
  } else {
    const styleEl = document.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  if (faviconEl) {
    faviconEl.setAttribute(
      'href',
      buildTeamFaviconDataUri(palette.primaryOnLight, palette.primaryOnDark),
    );
  }
}

export { escapeTextForSafeAttr };
