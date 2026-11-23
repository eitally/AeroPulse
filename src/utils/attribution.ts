export interface CoachLandingAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  src?: string;
  referrerHost?: string;
  landing_path?: string;
  selfReportedChannel?: string;
  capturedAt?: string;
}

const ATTRIBUTION_STORAGE_KEY = 'meetready_first_party_attr_v1';

function extractSafeReferrerHost(): string | undefined {
  if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
  try {
    const rawRef = String(document.referrer || '').trim();
    if (!rawRef) return undefined;
    const refUrl = new URL(rawRef);
    const host = refUrl.hostname.trim().toLowerCase().slice(0, 80);
    if (!host || host === window.location.hostname.trim().toLowerCase()) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

/**
 * Pure first-party sessionStorage campaign capture (zero cookies, zero third-party pixels).
 * Attaches attribution strictly to adult Coach team-creation payloads — never minor/student records.
 */
export function captureLandingAttribution(): CoachLandingAttribution | null {
  if (typeof window === 'undefined') return null;
  try {
    const existingRaw = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    const params = new URLSearchParams(window.location.search);
    const fresh: CoachLandingAttribution = {};
    const referrerHost = extractSafeReferrerHost();

    const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'src'] as const;
    let hasParam = false;
    for (const k of keys) {
      const val = params.get(k)?.trim().slice(0, 80);
      if (val) {
        fresh[k] = val;
        hasParam = true;
      }
    }

    if (hasParam) {
      let existingParsed: CoachLandingAttribution | null = null;
      if (existingRaw) {
        try {
          existingParsed = JSON.parse(existingRaw) as CoachLandingAttribution;
        } catch {
          existingParsed = null;
        }
      }
      if (existingParsed?.referrerHost) {
        fresh.referrerHost = existingParsed.referrerHost;
      } else if (referrerHost) {
        fresh.referrerHost = referrerHost;
      }
      fresh.landing_path =
        existingParsed?.landing_path ||
        `${window.location.pathname}${window.location.hash ? window.location.hash.slice(0, 48) : ''}`.slice(0, 120);
      fresh.capturedAt = existingParsed?.capturedAt || new Date().toISOString();
      window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }

    if (existingRaw) {
      const parsed = JSON.parse(existingRaw) as CoachLandingAttribution & { referrer?: string };
      if (!parsed.referrerHost && (parsed.referrer || referrerHost)) {
        try {
          const derived = parsed.referrer
            ? new URL(parsed.referrer).hostname.trim().toLowerCase().slice(0, 80)
            : referrerHost;
          if (derived && derived !== window.location.hostname.trim().toLowerCase()) {
            parsed.referrerHost = derived;
          }
        } catch {
          if (referrerHost) parsed.referrerHost = referrerHost;
        }
        delete parsed.referrer;
        window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(parsed));
      }
      return parsed;
    }

    const initial: CoachLandingAttribution = {
      ...(referrerHost ? { referrerHost } : {}),
      landing_path: window.location.pathname.slice(0, 120) || '/',
      capturedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(initial));
    return initial;
  } catch {
    return null;
  }
}

export function getStoredCoachAttribution(
  selfReportedChannel?: string
): CoachLandingAttribution | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    const parsed: CoachLandingAttribution = raw ? JSON.parse(raw) : {};
    const cleanChannel = selfReportedChannel?.trim().slice(0, 40);
    if (cleanChannel) {
      parsed.selfReportedChannel = cleanChannel;
    }
    return Object.keys(parsed).length > 0 ? parsed : null;
  } catch {
    return selfReportedChannel ? { selfReportedChannel: selfReportedChannel.slice(0, 40) } : null;
  }
}
