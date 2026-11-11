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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" fill="none"><style>.bg{fill:#F4F5F0}.ink{fill:#101411}.ac{fill:${accentLight}}@media (prefers-color-scheme:dark){.bg{fill:#080A09}.ink{fill:#F4F7F4}.ac{fill:${accentDark}}}</style><rect width="192" height="192" rx="42" class="bg"/><g transform="translate(0,2)"><g class="ink"><path d="M 176.84 138.5 L 96 138.5 A 46.5 46.5 0 0 1 91.14 45.75 L 92.03 54.21 A 38 38 0 0 0 96 130 L 179.36 130 Z"/><path d="M 173.23 150.7 L 96 150.7 A 58.7 58.7 0 1 1 108.2 34.58 L 106.44 42.9 A 50.2 50.2 0 1 0 96 142.2 L 175.75 142.2 Z"/><path d="M 169.61 162.9 L 96 162.9 A 70.9 70.9 0 1 1 131.45 30.6 L 127.2 37.96 A 62.4 62.4 0 1 0 96 154.4 L 172.13 154.4 Z"/><path d="M 166 175.1 L 96 175.1 A 83.1 83.1 0 1 1 157.76 36.4 L 151.44 42.08 A 74.6 74.6 0 1 0 96 166.6 L 168.52 166.6 Z"/></g><g class="ac"><path d="M 97.62 45.53 A 46.5 46.5 0 0 1 142.5 92 L 134 92 A 38 38 0 0 0 97.33 54.02 Z"/><path d="M 116.08 36.84 A 58.7 58.7 0 0 1 154.7 92 L 146.2 92 A 50.2 50.2 0 0 0 113.17 44.83 Z"/><path d="M 139.65 36.13 A 70.9 70.9 0 0 1 166.9 92 L 158.4 92 A 62.4 62.4 0 0 0 134.42 42.83 Z"/><path d="M 164.89 45.53 A 83.1 83.1 0 0 1 179.1 92 L 170.6 92 A 74.6 74.6 0 0 0 157.85 50.28 Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M 107.89 88.14 A 12.5 12.5 0 1 1 98.6 79.77 L 116.79 65.63 L 120.05 68.57 Z M 100.5 92 A 4.5 4.5 0 1 0 91.5 92 A 4.5 4.5 0 1 0 100.5 92 Z"/></g></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Dynamically injects WCAG 2.1 AA contrast-clamped school/club accent tokens into
 * the document chrome (`.ap-brand-hairline`, `.ap-btn-primary`, `--ap-brand-primary`)
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
      --ap-team-primary: ${palette.primaryOnLight};
      --ap-team-secondary: ${palette.secondaryOnLight};
    }
    .dark {
      --ap-brand-volt: ${palette.primaryOnDark};
      --ap-brand-primary: ${palette.primaryOnDark};
      --ap-action-cobalt: ${palette.primaryOnDark};
      --ap-thresh-vermilion: ${palette.primaryOnDark};
      --ap-team-primary: ${palette.primaryOnDark};
      --ap-team-secondary: ${palette.secondaryOnDark};
    }
    .ap-brand-hairline {
      background: ${palette.hairlineGradientLight};
    }
    .dark .ap-brand-hairline {
      background: ${palette.hairlineGradientDark};
    }
    .ap-btn-primary,
    .dark .ap-btn-primary {
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
