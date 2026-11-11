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

/**
 * Dynamically injects WCAG 2.1 AA contrast-clamped school/club accent tokens into
 * the document chrome (`.ap-brand-hairline`, `.ap-btn-primary`, `--ap-action-cobalt`)
 * while strictly preserving THRESH physiological zone colors (`Z1–Z7`) and Readiness signals.
 */
export function applyTeamBrandToDocument(brand: TeamBrandConfig | null | undefined): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!brand) {
    if (existing) existing.remove();
    return;
  }

  const palette = computeAccessibleTeamPalette(brand.primaryHex, brand.secondaryHex);
  const css = `
    :root {
      --ap-action-cobalt: ${palette.primaryOnLight};
      --ap-team-primary: ${palette.primaryOnLight};
      --ap-team-secondary: ${palette.secondaryOnLight};
    }
    .dark {
      --ap-action-cobalt: ${palette.primaryOnDark};
      --ap-team-primary: ${palette.primaryOnDark};
      --ap-team-secondary: ${palette.secondaryOnDark};
    }
    .ap-brand-hairline {
      background: ${palette.hairlineGradientLight};
    }
    .dark .ap-brand-hairline {
      background: ${palette.hairlineGradientDark};
    }
    .ap-btn-primary {
      background-color: ${palette.primaryOnLight};
      color: ${palette.textOnPrimaryLight};
    }
    .ap-btn-primary:hover {
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
}

export { escapeTextForSafeAttr };
