import React, { useEffect, useState } from 'react';

export interface AuthLandingPreviewCardProps {
  onboardingRole: 'ATHLETE' | 'COACH';
  onSelectOnboardingRole: (nextRole: 'ATHLETE' | 'COACH') => void;
}

export const AuthLandingPreviewCard: React.FC<AuthLandingPreviewCardProps> = ({
  onboardingRole,
  onSelectOnboardingRole,
}) => {
  const [specimenView, setSpecimenView] = useState<'SOLO' | 'COACH'>(() =>
    onboardingRole === 'COACH' ? 'COACH' : 'SOLO'
  );
  const [isSimulatedFatigued, setIsSimulatedFatigued] = useState(false);

  useEffect(() => {
    setSpecimenView(onboardingRole === 'COACH' ? 'COACH' : 'SOLO');
  }, [onboardingRole]);

  const atlSpecimenValue = isSimulatedFatigued ? 88 : 58;
  const tsbSpecimenValue = isSimulatedFatigued ? '-24' : '+6';
  const loadSumSpecimen = isSimulatedFatigued ? '1,180 TSS' : '920 TSS';
  const isSlateVariant =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('theme-slate');
  const z2Scale = isSimulatedFatigued ? 0.38 : 0.54;
  const z4Scale = isSimulatedFatigued ? 0.39 : 0.31;
  const z6Scale = isSimulatedFatigued ? 0.23 : 0.15;
  const z2Pct = isSimulatedFatigued ? '38%' : '54%';
  const z4Pct = isSimulatedFatigued ? '39%' : '31%';
  const z6Pct = isSimulatedFatigued ? '23%' : '15%';

  return (
    <>
                {/* Block 3: Interactive Live Cockpit Preview */}
                <section
                  data-testid="homepage-live-cockpit-preview"
                  aria-label="Live Cockpit Preview"
                  className="order-3 lg:col-span-7 lg:col-start-1 lg:row-start-2 w-full liquid-glass rounded-2xl p-4 sm:px-5 sm:py-3.5 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base font-extrabold text-ap-ink dark:text-ap-chalk">
                        Live Cockpit Preview
                      </h2>
                      <span className="ap-lane-badge">
                        <span className="ap-lane-badge-inner">REAL-TIME ENGINE</span>
                      </span>
                    </div>

                    <div
                      role="tablist"
                      aria-label="Preview audience"
                      className="inline-flex ap-pill-track p-1 rounded-xl gap-1"
                    >
                      <button
                        type="button"
                        role="tab"
                        data-testid="specimen-tab-solo"
                        aria-selected={specimenView === 'SOLO'}
                        onClick={() => { setSpecimenView('SOLO'); onSelectOnboardingRole('ATHLETE'); }}
                        className={`min-h-[44px] sm:min-h-[36px] px-3 rounded-lg text-xs sm:text-sm font-bold cursor-pointer transition-[background-color,color,box-shadow,border-color] duration-150 ${
                          specimenView === 'SOLO'
                            ? 'ap-pill-active'
                            : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                        }`}
                      >
                        Solo Athlete
                      </button>
                      <button
                        type="button"
                        role="tab"
                        data-testid="specimen-tab-coach"
                        aria-selected={specimenView === 'COACH'}
                        onClick={() => { setSpecimenView('COACH'); onSelectOnboardingRole('COACH'); }}
                        className={`min-h-[44px] sm:min-h-[36px] px-3 rounded-lg text-xs sm:text-sm font-bold cursor-pointer transition-[background-color,color,box-shadow,border-color] duration-150 ${
                          specimenView === 'COACH'
                            ? 'ap-pill-active'
                            : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                        }`}
                      >
                        Team Coach
                      </button>
                    </div>
                  </div>

                  {specimenView === 'SOLO' ? (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-ap-muted dark:text-ap-muted-dark">
                          Simulate Morning Readiness:
                        </span>
                        <div className="inline-flex ap-pill-track p-1 rounded-xl gap-1">
                          <button
                            type="button"
                            data-testid="specimen-readiness-optimal"
                            aria-pressed={!isSimulatedFatigued}
                            onClick={() => setIsSimulatedFatigued(false)}
                            className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-lg text-xs font-bold cursor-pointer transition-[background-color,color,box-shadow,border-color] duration-150 ${
                              !isSimulatedFatigued
                                ? 'ap-pill-active'
                                : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                            }`}
                          >
                            Optimal (+6 TSB)
                          </button>
                          <button
                            type="button"
                            data-testid="specimen-readiness-fatigued"
                            aria-pressed={isSimulatedFatigued}
                            onClick={() => setIsSimulatedFatigued(true)}
                            className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-lg text-xs font-bold cursor-pointer transition-[background-color,color,box-shadow,border-color] duration-150 ${
                              isSimulatedFatigued
                                ? 'ap-pill-active'
                                : 'text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                            }`}
                          >
                            Fatigued (-24 TSB)
                          </button>
                        </div>
                      </div>

                      {/* 3 KPI Strip */}
                      <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
                        <div className="rounded-xl ap-card-inset p-2.5 sm:p-3">
                          <div className="text-xs font-semibold text-ap-muted dark:text-ap-muted-dark mb-1">
                            42d Fitness (CTL)
                          </div>
                          <div className="font-mono tabular-nums text-base sm:text-xl font-extrabold text-ap-ink dark:text-ap-chalk">
                            64
                          </div>
                        </div>
                        <div className="rounded-xl ap-card-inset p-2.5 sm:p-3">
                          <div className="text-xs font-semibold text-ap-muted dark:text-ap-muted-dark mb-1">
                            7d Fatigue (ATL)
                          </div>
                          <div
                            data-testid="specimen-atl-value"
                            className="font-mono tabular-nums text-base sm:text-xl font-extrabold text-ap-ink dark:text-ap-chalk"
                          >
                            {atlSpecimenValue}
                          </div>
                        </div>
                        <div className="rounded-xl ap-card-inset p-2.5 sm:p-3">
                          <div className="text-xs font-semibold text-ap-muted dark:text-ap-muted-dark mb-1">
                            Form (TSB)
                          </div>
                          <div className="font-mono tabular-nums text-base sm:text-xl font-extrabold text-ap-ink dark:text-ap-chalk flex items-baseline gap-1.5 flex-wrap">
                            <span data-testid="specimen-tsb-value">{tsbSpecimenValue}</span>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-2xs font-bold ${
                                isSimulatedFatigued
                                  ? 'bg-[#FEF3C7] text-[#92400E] dark:bg-[#2E210C] dark:text-[#FBBF24]'
                                  : 'bg-[#DCFCE7] text-[#166534] dark:bg-[#122B1B] dark:text-[#4ADE80]'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isSimulatedFatigued ? 'bg-[#D97706]' : 'bg-[#16A34A]'
                                }`}
                              />
                              {isSimulatedFatigued ? 'MODULATED' : 'CLEARED'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 3-Channel Load Focus Bars */}
                      <div className="rounded-xl ap-card-inset p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-ap-ink dark:text-ap-chalk">
                            7-Day Load Focus Channels
                          </span>
                          <span className="font-mono tabular-nums text-xs font-bold text-[#3F6212] dark:text-[#A3E635]">
                            {loadSumSpecimen}
                          </span>
                        </div>
                        <div className="space-y-2">
                          <div className="grid grid-cols-[120px_1fr_40px] sm:grid-cols-[150px_1fr_44px] items-center gap-2 text-xs font-semibold text-[#1F3528] dark:text-[#C8D8CE]">
                            <span>Low Aerobic Z1–Z2</span>
                            <div className="h-2.5 rounded-full bg-white dark:bg-[#111A15] overflow-hidden">
                              <div
                                className="h-full w-full rounded-full bg-[#0D9488] origin-left transition-transform duration-200"
                                style={{ transform: `scaleX(${z2Scale})` }}
                              />
                            </div>
                            <span className="font-mono tabular-nums text-right">{z2Pct}</span>
                          </div>
                          <div className="grid grid-cols-[120px_1fr_40px] sm:grid-cols-[150px_1fr_44px] items-center gap-2 text-xs font-semibold text-[#1F3528] dark:text-[#C8D8CE]">
                            <span>Threshold Z3–Z4</span>
                            <div className="h-2.5 rounded-full bg-white dark:bg-[#111A15] overflow-hidden">
                              <div
                                className="h-full w-full rounded-full bg-[#EA580C] origin-left transition-transform duration-200"
                                style={{ transform: `scaleX(${z4Scale})` }}
                              />
                            </div>
                            <span className="font-mono tabular-nums text-right">{z4Pct}</span>
                          </div>
                          <div className="grid grid-cols-[120px_1fr_40px] sm:grid-cols-[150px_1fr_44px] items-center gap-2 text-xs font-semibold text-[#1F3528] dark:text-[#C8D8CE]">
                            <span>Anaerobic Z5–Z6</span>
                            <div className="h-2.5 rounded-full bg-white dark:bg-[#111A15] overflow-hidden">
                              <div
                                className="h-full w-full rounded-full bg-[#7C3AED] origin-left transition-transform duration-200"
                                style={{ transform: `scaleX(${z6Scale})` }}
                              />
                            </div>
                            <span className="font-mono tabular-nums text-right">{z6Pct}</span>
                          </div>
                        </div>
                      </div>

                      {/* Today's Prescription Callout */}
                      <div className="rounded-xl ap-card-inset px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isSimulatedFatigued ? 'bg-[#D97706]' : 'bg-[#16A34A]'
                            }`}
                          />
                          <span
                            data-testid="specimen-prescription-text"
                            className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk"
                          >
                            {isSimulatedFatigued
                              ? 'Today: 4 × 1km @ 3:48/km · Auto-modulated -15% strain guard'
                              : 'Today: 5 × 1km @ 3:42/km · Full Prescription'}
                          </span>
                        </div>
                        <span className="font-mono tabular-nums text-xs font-bold text-[#3F6212] dark:text-[#A3E635]">
                          {isSimulatedFatigued ? 'STRAIN GUARD -15%' : 'AUTO-CLEAR 100%'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div data-testid="specimen-coach-panel" className="space-y-2.5">
                      <div className="rounded-xl ap-card-inset p-3 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
                            Squad Safety Triage · Morning Check
                          </span>
                          <span className="font-mono tabular-nums text-xs font-bold text-[#3F6212] dark:text-[#A3E635]">
                            28 ACTIVE ROSTER
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#166534] dark:bg-[#122B1B] dark:text-[#4ADE80] font-mono text-xs font-bold">
                            <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
                            24 Cleared
                          </span>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#92400E] dark:bg-[#2E210C] dark:text-[#FBBF24] font-mono text-xs font-bold">
                            <span className="w-2 h-2 rounded-full bg-[#D97706]" />
                            3 Auto-Modulated
                          </span>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FEE2E2] text-[#991B1B] dark:bg-[#321316] dark:text-[#F87171] font-mono text-xs font-bold">
                            <span className="w-2 h-2 rounded-full bg-[#DC2626]" />
                            1 ACWR 1.48 Hold
                          </span>
                        </div>
                      </div>

                      <div className="rounded-xl ap-card-inset p-3 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs sm:text-sm font-extrabold text-ap-ink dark:text-ap-chalk">
                            Trackside Pod Splits
                          </span>
                          <span className="font-mono tabular-nums text-xs font-bold text-[#3F6212] dark:text-[#A3E635]">
                            0.01s PHONE STOPWATCH
                          </span>
                        </div>
                        <div className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-[#1F3528] dark:text-[#C8D8CE]">
                          Varsity Pod A · 4 × 800m · Avg 2:18.42 · Spread 0.61s
                        </div>
                      </div>

                      <div className="rounded-xl ap-card-inset px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-[#16A34A] shrink-0" />
                          <span className="text-xs font-bold text-ap-ink dark:text-ap-chalk">
                            Willow Glen XC (<span className="font-mono">WGXC-26</span>) · Athletic.net
                            Roster &amp; PRs Linked
                          </span>
                        </div>
                        <span className="font-mono text-xs font-bold text-[#166534] dark:text-[#4ADE80] shrink-0">
                          U18 SAFE-SPORT SHIELD ON
                        </span>
                      </div>
                    </div>
                  )}
                </section>

                {/* Block 4: Dual-Audience Value Wells */}
                <div className="order-4 lg:col-span-7 lg:col-start-1 lg:row-start-3 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl ap-card-inset p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-extrabold text-ap-ink dark:text-ap-chalk">
                        For Individual Athletes
                      </h2>
                      <span className="ap-lane-badge shrink-0">
                        <span className="ap-lane-badge-inner">SOLO</span>
                      </span>
                    </div>
                    <ul className="space-y-1.5 text-xs sm:text-sm leading-snug text-[#1F3528] dark:text-[#C8D8CE]">
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#0D9488] shrink-0 mt-1.5" />
                        <span>
                          Auto-scales workouts when <span className="font-mono">7d</span> strain spikes
                          or recovery drops
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#EA580C] shrink-0 mt-1.5" />
                        <span>
                          Works with Strava, Garmin, Polar, Wahoo, Intervals.icu, or{' '}
                          <span className="font-mono">.FIT/.ZIP</span>
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#7C3AED] shrink-0 mt-1.5" />
                        <span>
                          Keep 100% of your training history across clubs, seasons, and graduation
                        </span>
                      </li>
                    </ul>
                  </div>

                  <div className="rounded-xl ap-card-inset p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-extrabold text-ap-ink dark:text-ap-chalk">
                        For Coaches &amp; Programs
                      </h2>
                      <span className="ap-lane-badge shrink-0">
                        <span className="ap-lane-badge-inner">TEAM</span>
                      </span>
                    </div>
                    <ul className="space-y-1.5 text-xs sm:text-sm leading-snug text-[#1F3528] dark:text-[#C8D8CE]">
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#0D9488] shrink-0 mt-1.5" />
                        <span>
                          Onboard a squad in 2 minutes via <span className="font-mono">Athletic.net</span>
                          , <span className="font-mono">TFRRS</span>, or a{' '}
                          <span className="font-mono">6-char</span> code
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#EA580C] shrink-0 mt-1.5" />
                        <span>
                          Spot <span className="font-mono">ACWR</span> overload early, including
                          watchless high school athletes
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#7C3AED] shrink-0 mt-1.5" />
                        <span>
                          Build pace pods once and time <span className="font-mono">0.01s</span> splits
                          right from the infield
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
    </>
  );
};
