/**
 * Plain-Language terminology rewrites for Today & Readiness views (RT-24).
 * Underlying physiological formulas stay preserved inside Info tooltips.
 */

export function formatVerdictLabel(rawLabel: string, plainLanguage: boolean): string {
  if (!plainLanguage) return rawLabel;
  if (/polarization deficit/i.test(rawLabel)) {
    return 'Too Much Medium-Hard Effort';
  }
  if (/neuromuscular shortfall/i.test(rawLabel)) {
    return 'Needs Fast Strides / Speed Work';
  }
  return rawLabel;
}

export function formatOptimalTunnelLabel(plainLanguage: boolean): string {
  return plainLanguage ? 'Healthy Weekly Range' : 'Optimal Tunnel';
}

export function formatOrthoChannelLabel(
  channel: 1 | 2 | 3,
  plainLanguage: boolean
): string {
  if (!plainLanguage) {
    if (channel === 1) return '1. Central Cardiorespiratory (7d)';
    if (channel === 2) return '2. Eccentric Run Impact (7d)';
    return '3. Concentric Bike Torque (7d)';
  }
  if (channel === 1) return '1. Heart & Lungs Load (7d)';
  if (channel === 2) return '2. Leg & Joint Impact · Running (7d)';
  return '3. Leg Muscle Force · Cycling (7d)';
}

export function formatMorphRunLabel(mins: number, plainLanguage: boolean): string {
  return plainLanguage
    ? `Swap Run to Easy ${mins}m Bike / Cross-Train`
    : `Morph Run → ${mins}m Zero-Impact Ride`;
}

export function formatOneHzHint(plainLanguage: boolean): string {
  return plainLanguage
    ? 'View second-by-second pace, heart rate recovery & lap splits'
    : 'Open 1Hz streams for Skiba W’ match-burn, HRR60 & lap splits';
}
