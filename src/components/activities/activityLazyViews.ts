import { lazyWithRetry } from '../../utils/lazyWithRetry';

export const InteractiveRouteMap = lazyWithRetry(
  () => import('../InteractiveRouteMap').then((m) => ({ default: m.InteractiveRouteMap })),
  { chunkKey: 'InteractiveRouteMap', restoreTab: 'activities' }
);

export const UPlotStreamChart = lazyWithRetry(
  () => import('../charts/UPlotStreamChart').then((m) => ({ default: m.UPlotStreamChart })),
  { chunkKey: 'UPlotStreamChart', restoreTab: 'activities' }
);
