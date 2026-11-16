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

export function buildTeamFaviconDataUri(
  tileFill: string,
  inkFill: string,
  borderStroke = '#0B1911'
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><rect x="1" y="1" width="30" height="30" rx="6" fill="${escapeTextForSafeAttr(tileFill)}" stroke="${escapeTextForSafeAttr(borderStroke)}" stroke-width="2"/><path d="M 7 6 H 27 L 26 10 H 6 Z" fill="${escapeTextForSafeAttr(inkFill)}"/><path d="M 12.5 12 H 18.5 L 15 26 H 9 Z" fill="${escapeTextForSafeAttr(inkFill)}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Dynamically injects WCAG 2.1 AA contrast-clamped school/club accent tokens into
 * the document chrome (`.ap-content-stage`, `.ap-brand-hairline`, `.ap-btn-primary`, `.ap-nav-volt-active`)
 * AND re-themes the browser tab's THRESH Beacon SVG favicon to the team's primary color,
 * while strictly preserving THRESH physiological zone colors (`Z1–Z6`) and Readiness signals.
 */
export function applyTeamBrandToDocument(brand: TeamBrandConfig | null | undefined): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  const faviconEl = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;

  if (!brand) {
    if (existing) existing.remove();
    if (faviconEl && faviconEl.getAttribute('href') !== '/icon.svg?v=3') {
      faviconEl.setAttribute('href', '/icon.svg?v=3');
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
    .ap-nav-volt-active {
      background-color: ${palette.primaryOnLight};
      color: ${palette.textOnPrimaryLight};
      border-color: transparent;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
    }
    .dark .ap-btn-primary,
    .dark .ap-nav-volt-active {
      background-color: ${palette.primaryOnDark};
      color: ${palette.textOnPrimaryDark};
      border-color: transparent;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.36);
    }
    .ap-btn-primary:hover {
      background-color: ${palette.primaryOnLight};
      filter: brightness(0.92);
    }
    .dark .ap-btn-primary:hover {
      background-color: ${palette.primaryOnDark};
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
      buildTeamFaviconDataUri(
        palette.primaryOnLight,
        palette.textOnPrimaryLight,
        palette.secondaryOnLight
      ),
    );
  }
}

export { escapeTextForSafeAttr };
