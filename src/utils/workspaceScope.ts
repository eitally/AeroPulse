import type { AthleteProfile, SportCategory, TeamSummaryWithRole } from '../types';

export interface WorkspaceSportRoleScope {
  isCollegiateContext: boolean;
  isHighSchoolOrYouthContext: boolean;
  isNonTrackSport: boolean;
  showSpikedMeter: boolean;
  showNcaaCara: boolean;
  showGrowthPlatePhv: boolean;
  showRelayOptimizer: boolean;
  showTrackEventGroupChips: (clipboardSport: SportCategory) => boolean;
}

const COLLEGIATE_DIVISIONS = new Set(['NCAA_D1', 'NCAA_D2', 'NCAA_D3']);

/**
 * Computes deterministic sport and organizational role visibility rules so
 * Cycling/Swim/Tri workspaces and Club/Adult athletes never see misplaced
 * Track Spikes, NCAA CARA, or Youth PHV Growth-Plate chrome.
 */
export function resolveWorkspaceSportAndRoleScope(params: {
  athleteProfile?: Partial<AthleteProfile> | null;
  activeTeam?: TeamSummaryWithRole | null;
  isMinorU18?: boolean;
}): WorkspaceSportRoleScope {
  const { athleteProfile, activeTeam, isMinorU18 } = params;
  const orgType = activeTeam?.brand?.orgType;
  const teamSport = activeTeam?.brand?.primarySport;
  const athleteSport = athleteProfile?.primarySport;
  const division = athleteProfile?.academicDivision;

  const isCollegiateContext = Boolean(
    orgType === 'COLLEGIATE' || (division && COLLEGIATE_DIVISIONS.has(division))
  );
  const isHighSchoolOrYouthContext = Boolean(
    isMinorU18 ||
      orgType === 'HIGH_SCHOOL' ||
      division === 'HS_VARSITY'
  );

  const isCyclingClub = orgType === 'CYCLING_CLUB';
  const nonTrackSports = new Set(['Cycling', 'Swimming', 'Triathlon']);
  const isNonTrackSport = Boolean(
    isCyclingClub ||
      (athleteSport && nonTrackSports.has(athleteSport)) ||
      (teamSport && nonTrackSports.has(teamSport))
  );

  return {
    isCollegiateContext,
    isHighSchoolOrYouthContext,
    isNonTrackSport,
    showSpikedMeter: !isNonTrackSport,
    showNcaaCara: isCollegiateContext && !isCyclingClub,
    showGrowthPlatePhv: isHighSchoolOrYouthContext,
    showRelayOptimizer: activeTeam
      ? !isCyclingClub &&
        teamSport !== 'Cycling' &&
        teamSport !== 'Swimming' &&
        teamSport !== 'Triathlon'
      : !isNonTrackSport,
    showTrackEventGroupChips: (clipboardSport: SportCategory) =>
      clipboardSport === 'Running' && !isCyclingClub,
  };
}
