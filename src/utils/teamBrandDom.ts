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

function buildTeamFaviconDataUri(accentLight: string, accentDark: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -2 198 196" fill="none"><style>.bg{fill:#F3F5ED}.ink{fill:#101411}.ac{fill:${accentLight}}@media (prefers-color-scheme:dark){.bg{fill:#080A09}.ink{fill:#F4F7F4}.ac{fill:${accentDark}}}</style><rect x="0" y="-2" width="198" height="196" rx="44" class="bg"/><g class="ink"><path d="M 188.4 143 L 98 143 A 47 47 0 0 1 91.46 49.46 L 92.99 60.35 A 36 36 0 0 0 98 132 L 191.65 132 Z"/><path d="M 183.6 159.2 L 98 159.2 A 63.2 63.2 0 1 1 108.97 33.76 L 107.06 44.59 A 52.2 52.2 0 1 0 98 148.2 L 186.86 148.2 Z"/><path d="M 178.8 175.4 L 98 175.4 A 79.4 79.4 0 1 1 135.28 25.89 L 130.11 35.61 A 68.4 68.4 0 1 0 98 164.4 L 182.06 164.4 Z"/><path d="M 174 191.6 L 98 191.6 A 95.6 95.6 0 1 1 166.77 29.59 L 158.86 37.23 A 84.6 84.6 0 1 0 98 180.6 L 177.26 180.6 Z"/></g><g class="ac"><path d="M 99.64 49.03 A 47 47 0 0 1 145 96 L 134 96 A 36 36 0 0 0 99.26 60.02 Z"/><path d="M 119.62 36.61 A 63.2 63.2 0 0 1 161.2 96 L 150.2 96 A 52.2 52.2 0 0 0 115.85 46.95 Z"/><path d="M 146.88 33.43 A 79.4 79.4 0 0 1 177.4 96 L 166.4 96 A 68.4 68.4 0 0 0 140.11 42.1 Z"/><path d="M 177.26 42.54 A 95.6 95.6 0 0 1 193.6 96 L 182.6 96 A 84.6 84.6 0 0 0 168.14 48.69 Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M 112.3 91.47 A 15 15 0 1 1 101.01 81.3 L 118.28 69.59 L 122.15 73.07 Z M 103.2 96 A 5.2 5.2 0 1 0 92.8 96 A 5.2 5.2 0 1 0 103.2 96 Z"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Dynamically injects WCAG 2.1 AA contrast-clamped school/club accent tokens into
 * the document chrome (`.ap-content-stage`, `.ap-brand-hairline`, `.ap-btn-primary`, `.ap-nav-volt-active`)
 * AND re-themes the browser tab's T3 Track-Gauge SVG favicon to the team's primary color,
 * while strictly preserving THRESH physiological zone colors (`Z1–Z7`) and Readiness signals.
 */
export function applyTeamBrandToDocument(brand: TeamBrandConfig | null | undefined): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  const faviconEl = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;

  if (!brand) {
    if (existing) existing.remove();
    if (faviconEl && faviconEl.getAttribute('href') !== '/icon.svg') {
      faviconEl.setAttribute('href', '/icon.svg');
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
