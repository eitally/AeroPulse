import {
  normalizeBirthMonthYear,
  resolveAthleteAgeTier,
  type AthleteAgeComplianceTier,
} from '../src/physiology/ageAndComplianceEngine.ts';

export const COPPA_UNDER_13_ERROR =
  'MeetReady accounts require athletes to be 13 or older (COPPA). Coaches can still time under-13 athletes watchlessly using Trackside Stopwatch without an athlete login.';

export const MINOR_DOB_DOWNGRADE_ERROR =
  'Minor birth date cannot be altered to an adult date directly.';

export interface CoppaAgeValidationInput {
  birthMonthYear?: unknown;
  birthYear?: unknown;
  existingBirthMonthYear?: string | null;
  required?: boolean;
  now?: Date | string | number;
}

export interface CoppaAgeValidationResult {
  ok: boolean;
  statusCode?: 400 | 403;
  error?: string;
  birthMonthYear?: string;
  birthYear?: number;
  isUnder13: boolean;
  isMinorU18: boolean;
  ageTier: AthleteAgeComplianceTier;
}

function parseOptionalBirthYear(raw: unknown, nowYear: number): {
  provided: boolean;
  valid: boolean;
  value?: number;
} {
  if (raw === undefined || raw === null) {
    return { provided: false, valid: true };
  }
  if (typeof raw === 'string' && !raw.trim()) {
    return { provided: false, valid: true };
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1920 || num > nowYear + 1) {
    return { provided: true, valid: false };
  }
  return { provided: true, valid: true, value: num };
}

/**
 * Validates optional or required DOB fields against COPPA (<13 hard reject) and
 * blocks minor (13-17) accounts from tampering their stored DOB to 18+.
 * Preserves existing returning-user flows when optional DOB fields are omitted.
 */
export function validateCoppaAgeInput(
  input: CoppaAgeValidationInput
): CoppaAgeValidationResult {
  const refDate =
    input.now instanceof Date
      ? input.now
      : input.now !== undefined
        ? new Date(input.now)
        : new Date();
  const safeNow = Number.isNaN(refDate.getTime()) ? new Date() : refDate;
  const nowYear = safeNow.getUTCFullYear();

  const existingTier = input.existingBirthMonthYear
    ? resolveAthleteAgeTier({ birthMonthYear: input.existingBirthMonthYear, now: safeNow })
    : null;

  const hasRawBmy =
    input.birthMonthYear !== undefined &&
    input.birthMonthYear !== null &&
    String(input.birthMonthYear).trim() !== '';

  let normalizedBmy: string | undefined;
  if (hasRawBmy) {
    normalizedBmy = normalizeBirthMonthYear(String(input.birthMonthYear));
    if (!normalizedBmy) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Valid YYYY-MM birth month-year required.',
        isUnder13: false,
        isMinorU18: Boolean(existingTier?.isMinorU18),
        ageTier: existingTier?.ageTier || 'UNKNOWN',
      };
    }
  }

  const parsedYear = parseOptionalBirthYear(input.birthYear, nowYear);
  if (parsedYear.provided && !parsedYear.valid) {
    return {
      ok: false,
      statusCode: 400,
      error: 'Valid 4-digit birth year required.',
      isUnder13: false,
      isMinorU18: Boolean(existingTier?.isMinorU18),
      ageTier: existingTier?.ageTier || 'UNKNOWN',
    };
  }

  if (normalizedBmy && parsedYear.value !== undefined) {
    const bmyYear = Number(normalizedBmy.slice(0, 4));
    if (bmyYear !== parsedYear.value) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Birth year must match YYYY-MM birth month-year.',
        isUnder13: false,
        isMinorU18: Boolean(existingTier?.isMinorU18),
        ageTier: existingTier?.ageTier || 'UNKNOWN',
      };
    }
  }

  if (!normalizedBmy && parsedYear.value === undefined) {
    if (input.required) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Valid YYYY-MM birth month-year required.',
        isUnder13: false,
        isMinorU18: Boolean(existingTier?.isMinorU18),
        ageTier: existingTier?.ageTier || 'UNKNOWN',
      };
    }
    return {
      ok: true,
      birthMonthYear: existingTier?.birthMonthYear,
      birthYear: existingTier?.birthYear,
      isUnder13: Boolean(existingTier?.isUnder13),
      isMinorU18: Boolean(existingTier?.isMinorU18),
      ageTier: existingTier?.ageTier || 'UNKNOWN',
    };
  }

  // If only birthYear was supplied, derive conservative YYYY-12 so a 12-year-old
  // born late in the calendar year cannot slip past COPPA <13 or U18 SafeSport.
  const effectiveBmy =
    normalizedBmy ?? (parsedYear.value !== undefined ? `${parsedYear.value}-12` : undefined);
  const incomingTier = resolveAthleteAgeTier({
    birthMonthYear: effectiveBmy,
    birthYear: parsedYear.value,
    now: safeNow,
  });

  if (incomingTier.isUnder13 || incomingTier.ageTier === 'U13_COPPA') {
    return {
      ok: false,
      statusCode: 400,
      error: COPPA_UNDER_13_ERROR,
      birthMonthYear: effectiveBmy,
      birthYear: incomingTier.birthYear,
      isUnder13: true,
      isMinorU18: true,
      ageTier: 'U13_COPPA',
    };
  }

  if (existingTier?.isMinorU18 && incomingTier.ageTier === 'ADULT_18_PLUS') {
    return {
      ok: false,
      statusCode: 403,
      error: MINOR_DOB_DOWNGRADE_ERROR,
      birthMonthYear: existingTier.birthMonthYear,
      birthYear: existingTier.birthYear,
      isUnder13: false,
      isMinorU18: true,
      ageTier: existingTier.ageTier,
    };
  }

  return {
    ok: true,
    birthMonthYear: effectiveBmy,
    birthYear: incomingTier.birthYear,
    isUnder13: false,
    isMinorU18: incomingTier.isMinorU18,
    ageTier: incomingTier.ageTier,
  };
}
