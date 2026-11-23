import type { TeamOrgType } from '../types';

export type AthleteAgeComplianceTier =
  | 'U13_COPPA'
  | 'YOUTH_13_17'
  | 'ADULT_18_PLUS'
  | 'UNKNOWN';

export interface ResolvedAthleteAgeCompliance {
  ageTier: AthleteAgeComplianceTier;
  estimatedAgeYears: number | null;
  isUnder13: boolean;
  isMinorU18: boolean;
  shouldAutoGraduateHs: boolean;
  birthYear?: number;
  birthMonthYear?: string;
}

export function normalizeBirthMonthYear(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(trimmed);
  if (!match) return undefined;
  const yr = Number(match[1]);
  if (yr < 1920 || yr > new Date().getUTCFullYear() + 1) return undefined;
  return `${match[1]}-${match[2]}`;
}

export function parseBirthYearFromBirthMonthYear(raw?: string | null): number | undefined {
  const norm = normalizeBirthMonthYear(raw);
  if (!norm) return undefined;
  return Number(norm.slice(0, 4));
}

/**
 * Resolves COPPA (<13), Youth Safe-Sport (13-17), Adult (18+), and HS July 15
 * graduation rollover using a conservative YYYY-MM month-end birthday rule so
 * exact day-of-birth PII never needs to be stored while eliminating Jan-1 drift.
 */
export function resolveAthleteAgeTier(params: {
  birthMonthYear?: string | null;
  birthYear?: number | null;
  orgType?: TeamOrgType | null;
  graduationYear?: number | null;
  now?: Date | string | number;
}): ResolvedAthleteAgeCompliance {
  const nowDate =
    params.now instanceof Date
      ? params.now
      : params.now !== undefined
        ? new Date(params.now)
        : new Date();
  const safeNow = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate;
  const nowYear = safeNow.getUTCFullYear();
  const nowMonth = safeNow.getUTCMonth() + 1; // 1..12
  const currentIsoDate = safeNow.toISOString().slice(0, 10);

  const normBmy = normalizeBirthMonthYear(params.birthMonthYear);
  const explicitYear =
    typeof params.birthYear === 'number' &&
    Number.isFinite(params.birthYear) &&
    params.birthYear >= 1920 &&
    params.birthYear <= nowYear + 1
      ? Math.round(params.birthYear)
      : undefined;
  // Conservatively normalize year-only birthYear to YYYY-12 so 12-year-olds born
  // late in currentYear - 13 cannot bypass COPPA (<13) or U18 SafeSport checks.
  const effectiveBmy =
    normBmy ?? (explicitYear !== undefined ? `${explicitYear}-12` : undefined);

  let estimatedAgeYears: number | null = null;
  if (effectiveBmy) {
    const bYear = Number(effectiveBmy.slice(0, 4));
    const bMonth = Number(effectiveBmy.slice(5, 7));
    const completedMonths = (nowYear - bYear) * 12 + (nowMonth - bMonth) - 1;
    estimatedAgeYears = Math.max(0, Math.floor(completedMonths / 12));
  }

  let ageTier: AthleteAgeComplianceTier = 'UNKNOWN';
  let isUnder13 = false;
  let isMinorU18 = Boolean(params.orgType === 'HIGH_SCHOOL');

  if (estimatedAgeYears !== null) {
    if (estimatedAgeYears < 13) {
      ageTier = 'U13_COPPA';
      isUnder13 = true;
      isMinorU18 = true;
    } else if (estimatedAgeYears < 18) {
      ageTier = 'YOUTH_13_17';
      isUnder13 = false;
      isMinorU18 = true;
    } else {
      ageTier = 'ADULT_18_PLUS';
      isUnder13 = false;
      isMinorU18 = false;
    }
  }

  const gradYr =
    typeof params.graduationYear === 'number' && Number.isFinite(params.graduationYear)
      ? Math.round(params.graduationYear)
      : undefined;
  const shouldAutoGraduateHs = Boolean(
    params.orgType === 'HIGH_SCHOOL' &&
      gradYr &&
      gradYr >= 2000 &&
      gradYr <= 2100 &&
      currentIsoDate >= `${gradYr}-07-15`
  );

  return {
    ageTier,
    estimatedAgeYears,
    isUnder13,
    isMinorU18,
    shouldAutoGraduateHs,
    birthYear: parseBirthYearFromBirthMonthYear(effectiveBmy) ?? explicitYear,
    birthMonthYear: effectiveBmy,
  };
}
