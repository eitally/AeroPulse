// Re-export UPlotPMCDashboard to preserve backward compatibility while eliminating the ~175 KB gzip vendor-echarts chunk
export {
  UPlotPMCDashboard,
  EChartsPMCDashboard,
  buildDayLoadSegments,
  classifyActivityGarminLoad,
  classifyGarminLoadType,
  GARMIN_LOAD_FOCUS_META,
  type ActivityLoadSegment,
  type GarminClassifyOptions,
  type GarminLoadFocus,
  type GarminLoadFocusMeta,
  type PMCDayPoint,
  type UPlotPMCDashboardProps,
  type EChartsPMCDashboardProps,
} from './UPlotPMCDashboard';

export { default } from './UPlotPMCDashboard';
