export interface CoachLandingAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  src?: string;
  landing_path?: string;
  selfReportedChannel?: string;
  capturedAt?: string;
}

const ATTRIBUTION_STORAGE_KEY = 'meetready_first_party_attr_v1';

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
      fresh.landing_path = `${window.location.pathname}${window.location.hash ? window.location.hash.slice(0, 48) : ''}`.slice(0, 120);
      fresh.capturedAt = new Date().toISOString();
      window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }

    if (existingRaw) {
      return JSON.parse(existingRaw) as CoachLandingAttribution;
    }

    const initial: CoachLandingAttribution = {
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
