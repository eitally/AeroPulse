import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Compass, KeyRound, Layers, Maximize2, Navigation, Sparkles } from "./icons/PhosphorIcons";
import { DistanceUnit, MapTileProvider, StravaSegmentEffort, UnifiedActivity } from '../types';
import { formatDistance, formatPace, formatStopwatch } from '../utils/formatters';

export type MapTileStyle = 'DARK' | 'STREET' | 'TOPO' | 'SATELLITE';
export type RouteColorMode = 'STRAVA' | 'POWER' | 'HR' | 'ALTITUDE';

interface ResolvedTileConfig {
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  tileSize?: number;
  zoomOffset?: number;
  providerBadge: string;
}

function getStoredMapTileSettings(): {
  apiKey: string;
  provider: MapTileProvider;
} {
  try {
    const savedKey =
      localStorage.getItem('aeropulse_map_tile_api_key') ||
      (import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN ||
      '';
    const savedProvider =
      (localStorage.getItem('aeropulse_map_tile_provider') as MapTileProvider | null) ||
      (savedKey.trim().startsWith('pk.')
        ? 'MAPBOX'
        : savedKey.trim()
          ? 'THUNDERFOREST'
          : 'OSM_KEYLESS');
    return {
      apiKey: savedKey.trim(),
      provider: savedProvider,
    };
  } catch {
    return { apiKey: '', provider: 'OSM_KEYLESS' };
  }
}

function buildTileConfigs(
  provider: MapTileProvider,
  rawApiKey: string
): Record<MapTileStyle, ResolvedTileConfig> {
  const key = rawApiKey.trim();
  const isMapbox =
    key.length > 0 && (provider === 'MAPBOX' || key.startsWith('pk.') || key.startsWith('sk.'));
  const isThunderforest = key.length > 0 && !isMapbox && provider === 'THUNDERFOREST';

  if (isMapbox) {
    const encKey = encodeURIComponent(key);
    return {
      DARK: {
        label: 'Mapbox Dark',
        url: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/512/{z}/{x}/{y}@2x?access_token=${encKey}`,
        attribution: '&copy; Mapbox &copy; OpenStreetMap',
        maxZoom: 20,
        tileSize: 512,
        zoomOffset: -1,
        providerBadge: 'Mapbox API Key Active',
      },
      STREET: {
        label: 'Mapbox Streets',
        url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${encKey}`,
        attribution: '&copy; Mapbox &copy; OpenStreetMap',
        maxZoom: 20,
        tileSize: 512,
        zoomOffset: -1,
        providerBadge: 'Mapbox API Key Active',
      },
      TOPO: {
        label: 'Mapbox Outdoors',
        url: `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${encKey}`,
        attribution: '&copy; Mapbox &copy; OpenStreetMap',
        maxZoom: 20,
        tileSize: 512,
        zoomOffset: -1,
        providerBadge: 'Mapbox API Key Active',
      },
      SATELLITE: {
        label: 'Mapbox Satellite',
        url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${encKey}`,
        attribution: '&copy; Mapbox &copy; Maxar',
        maxZoom: 20,
        tileSize: 512,
        zoomOffset: -1,
        providerBadge: 'Mapbox API Key Active',
      },
    };
  }

  if (isThunderforest) {
    const encKey = encodeURIComponent(key);
    return {
      DARK: {
        label: 'Dark Transport',
        url: `https://tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png?apikey=${encKey}`,
        attribution: '&copy; Thunderforest &copy; OpenStreetMap',
        maxZoom: 19,
        providerBadge: 'OpenCycleMap / Thunderforest Key Active',
      },
      STREET: {
        label: 'OpenCycleMap',
        url: `https://tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=${encKey}`,
        attribution: '&copy; Thunderforest &copy; OpenStreetMap',
        maxZoom: 19,
        providerBadge: 'OpenCycleMap / Thunderforest Key Active',
      },
      TOPO: {
        label: 'Outdoors Topo',
        url: `https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=${encKey}`,
        attribution: '&copy; Thunderforest &copy; OpenStreetMap',
        maxZoom: 19,
        providerBadge: 'OpenCycleMap / Thunderforest Key Active',
      },
      SATELLITE: {
        label: 'Landscape',
        url: `https://tile.thunderforest.com/landscape/{z}/{x}/{y}.png?apikey=${encKey}`,
        attribution: '&copy; Thunderforest &copy; OpenStreetMap',
        maxZoom: 19,
        providerBadge: 'OpenCycleMap / Thunderforest Key Active',
      },
    };
  }

  return {
    DARK: {
      label: 'Dark Telemetry',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
      providerBadge: 'OpenStreetMap Keyless',
    },
    STREET: {
      label: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
      providerBadge: 'OpenStreetMap Keyless',
    },
    TOPO: {
      label: 'Topo Terrain',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri &copy; OpenStreetMap',
      maxZoom: 18,
      providerBadge: 'OpenStreetMap Keyless',
    },
    SATELLITE: {
      label: 'Satellite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri World Imagery',
      maxZoom: 18,
      providerBadge: 'OpenStreetMap Keyless',
    },
  };
}

function colorForMetricFraction(frac: number): string {
  const clamped = Math.max(0, Math.min(1, frac));
  if (clamped < 0.25) return '#3B82F6'; // Blue (Z1/Z2)
  if (clamped < 0.5) return '#10B981'; // Emerald (Z3)
  if (clamped < 0.72) return '#F59E0B'; // Amber (Z4)
  if (clamped < 0.88) return '#F97316'; // Orange (Z5)
  return '#EF4444'; // Red (Z6 Peak)
}

interface SingleActivityMapProps {
  mode: 'SINGLE';
  activity: UnifiedActivity;
  distanceUnit: DistanceUnit;
  activeStreamIndex?: number | null;
  onHoverStreamIndex?: (index: number | null) => void;
  zoomStreamRange?: [number, number] | null;
  selectedSegmentId?: string | null;
  onSelectSegmentId?: (segmentId: string) => void;
  onOpenMapSettings?: () => void;
  heightClass?: string;
}

interface MultiActivityMapProps {
  mode: 'MULTI';
  activities: UnifiedActivity[];
  highlightedActivityId?: string | null;
  onSelectActivity: (activity: UnifiedActivity) => void;
  onHoverActivity?: (activityId: string | null) => void;
  onOpenMapSettings?: () => void;
  distanceUnit: DistanceUnit;
  heightClass?: string;
}

export type InteractiveRouteMapProps = SingleActivityMapProps | MultiActivityMapProps;

export const InteractiveRouteMap: React.FC<InteractiveRouteMapProps> = (props) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const routeLayersRef = useRef<L.LayerGroup | null>(null);
  const cursorLayerRef = useRef<L.LayerGroup | null>(null);

  const [tileStyle, setTileStyle] = useState<MapTileStyle>('DARK');
  const [colorMode, setColorMode] = useState<RouteColorMode>('STRAVA');
  const [autoFitZoomWindow, setAutoFitZoomWindow] = useState<boolean>(true);
  const [mapSettings, setMapSettings] = useState<{ apiKey: string; provider: MapTileProvider }>(
    () => getStoredMapTileSettings()
  );

  // Sync when user updates Mapbox / OpenStreetMap API key in DataSourcesModal
  useEffect(() => {
    const handleConfigUpdate = () => {
      setMapSettings(getStoredMapTileSettings());
    };
    window.addEventListener('aeropulse-map-config-updated', handleConfigUpdate);
    window.addEventListener('storage', handleConfigUpdate);
    return () => {
      window.removeEventListener('aeropulse-map-config-updated', handleConfigUpdate);
      window.removeEventListener('storage', handleConfigUpdate);
    };
  }, []);

  const tileConfigs = useMemo(
    () => buildTileConfigs(mapSettings.provider, mapSettings.apiKey),
    [mapSettings.provider, mapSettings.apiKey]
  );

  // Extract coordinates for SINGLE mode
  const singleCoords = useMemo((): [number, number][] => {
    if (props.mode !== 'SINGLE') return [];
    const stLatLng = props.activity.streams?.latlng;
    if (Array.isArray(stLatLng) && stLatLng.length >= 2) {
      return stLatLng;
    }
    if (Array.isArray(props.activity.routeLatLngs) && props.activity.routeLatLngs.length >= 2) {
      return props.activity.routeLatLngs;
    }
    return [];
  }, [props]);

  // Initialize Leaflet Map instance once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [37.3382, -121.8863],
      zoom: 12,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const cfg = tileConfigs[tileStyle];
    const tl = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
      tileSize: cfg.tileSize || 256,
      zoomOffset: cfg.zoomOffset || 0,
    });
    tl.on('tileerror', (errEvt: any) => {
      const img = errEvt?.tile as HTMLImageElement | undefined;
      const coords = errEvt?.coords;
      if (img && coords && !img.dataset.fallbackApplied) {
        img.dataset.fallbackApplied = '1';
        img.src = `https://tile.openstreetmap.org/${coords.z}/${coords.x}/${coords.y}.png`;
      }
    });
    tl.addTo(map);

    const routeGroup = L.layerGroup().addTo(map);
    const cursorGroup = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    tileLayerRef.current = tl;
    routeLayersRef.current = routeGroup;
    cursorLayerRef.current = cursorGroup;

    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      routeLayersRef.current = null;
      cursorLayerRef.current = null;
    };
  }, []);

  // Update tile layer when tileStyle or API key / provider changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const cfg = tileConfigs[tileStyle];
    const tl = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
      tileSize: cfg.tileSize || 256,
      zoomOffset: cfg.zoomOffset || 0,
    });
    tl.on('tileerror', (errEvt: any) => {
      const img = errEvt?.tile as HTMLImageElement | undefined;
      const coords = errEvt?.coords;
      if (img && coords && !img.dataset.fallbackApplied) {
        img.dataset.fallbackApplied = '1';
        img.src = `https://tile.openstreetmap.org/${coords.z}/${coords.x}/${coords.y}.png`;
      }
    });
    tileLayerRef.current = tl.addTo(map);
  }, [tileStyle, tileConfigs]);

  // Render Route Polylines, Segment Highlights & Split Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    const routeGroup = routeLayersRef.current;
    if (!map || !routeGroup) return;

    routeGroup.clearLayers();
    map.invalidateSize();

    if (props.mode === 'SINGLE') {
      const coords = singleCoords;
      if (coords.length < 2) return;

      const streams = props.activity.streams;
      const wattsArr = streams?.watts;
      const hrArr = streams?.heartrate;
      const altArr = streams?.altitude;
      const timeArr = streams?.time;
      const distArr = streams?.distance;

      const isStreamAligned =
        streams?.latlng &&
        streams.latlng.length === coords.length &&
        timeArr &&
        timeArr.length === coords.length;

      // 1. Base / Colored Polyline Rendering
      if (colorMode === 'STRAVA' || !isStreamAligned) {
        // Subtle outer glow + crisp Strava Orange core line
        L.polyline(coords, {
          color: '#FC4C02',
          weight: 7,
          opacity: 0.25,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(routeGroup);

        const mainPoly = L.polyline(coords, {
          color: '#FC4C02',
          weight: 4,
          opacity: props.zoomStreamRange ? 0.45 : 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(routeGroup);

        if (props.onHoverStreamIndex && isStreamAligned) {
          mainPoly.on('mousemove', (ev: L.LeafletMouseEvent) => {
            const latlng = ev.latlng;
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < coords.length; i++) {
              const dLat = coords[i][0] - latlng.lat;
              const dLng = coords[i][1] - latlng.lng;
              const d = dLat * dLat + dLng * dLng;
              if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
              }
            }
            props.onHoverStreamIndex!(bestIdx);
          });
        }
      } else {
        // Color-graded segments by Power, HR, or Altitude
        const metricArr =
          colorMode === 'POWER'
            ? wattsArr || (streams?.velocitySmooth || []).map((v) => v * 80)
            : colorMode === 'HR'
              ? hrArr || []
              : altArr || [];

        const validVals = metricArr.filter((v) => v != null && !Number.isNaN(v) && v > 0);
        const minVal = validVals.length > 0 ? Math.min(...validVals) : 0;
        const maxVal = validVals.length > 0 ? Math.max(minVal + 10, Math.max(...validVals)) : 300;
        const chunkLen = Math.max(2, Math.floor(coords.length / 85));

        for (let i = 0; i < coords.length - 1; i += chunkLen) {
          const endIdx = Math.min(coords.length - 1, i + chunkLen);
          const slicePts = coords.slice(i, endIdx + 1);
          const val = metricArr[Math.min(metricArr.length - 1, Math.floor((i + endIdx) / 2))] || minVal;
          const frac = (val - minVal) / Math.max(1, maxVal - minVal);
          const segColor = colorForMetricFraction(frac);

          const segPoly = L.polyline(slicePts, {
            color: segColor,
            weight: 4.5,
            opacity: props.zoomStreamRange ? 0.45 : 0.95,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(routeGroup);

          if (props.onHoverStreamIndex) {
            segPoly.on('mousemove', () => {
              props.onHoverStreamIndex!(Math.floor((i + endIdx) / 2));
            });
          }
        }
      }

      // 2. Highlighted Zoomed Section on Map (when user drags/zooms on Power & HR chart)
      let boundsTargetCoords = coords;
      if (props.zoomStreamRange && isStreamAligned) {
        const [zStart, zEnd] = props.zoomStreamRange;
        const clampedStart = Math.max(0, Math.min(coords.length - 2, zStart));
        const clampedEnd = Math.max(clampedStart + 1, Math.min(coords.length - 1, zEnd));
        const zoomSlice = coords.slice(clampedStart, clampedEnd + 1);
        if (zoomSlice.length >= 2) {
          L.polyline(zoomSlice, {
            color: '#38BDF8',
            weight: 9,
            opacity: 0.35,
            lineCap: 'round',
          }).addTo(routeGroup);

          L.polyline(zoomSlice, {
            color: '#0284C7',
            weight: 5,
            opacity: 1,
            lineCap: 'round',
          })
            .bindTooltip('Zoomed Chart Window', { sticky: true })
            .addTo(routeGroup);

          if (autoFitZoomWindow) {
            boundsTargetCoords = zoomSlice;
          }
        }
      }

      // 3. Strava Segment Overlays on the Map
      const efforts = props.activity.segmentEfforts || [];
      efforts.forEach((eff: StravaSegmentEffort) => {
        const isSelectedSeg =
          props.selectedSegmentId &&
          (String(eff.segmentId) === props.selectedSegmentId || eff.name === props.selectedSegmentId);

        let segPath = eff.pathLatLngs;
        if (
          (!segPath || segPath.length < 2) &&
          isStreamAligned &&
          eff.startTimeSecs !== undefined &&
          eff.endTimeSecs !== undefined &&
          timeArr
        ) {
          const pts: [number, number][] = [];
          for (let i = 0; i < timeArr.length; i++) {
            if (timeArr[i] >= eff.startTimeSecs && timeArr[i] <= eff.endTimeSecs) {
              pts.push(coords[i]);
            }
          }
          if (pts.length >= 2) segPath = pts;
        }

        if (segPath && segPath.length >= 2) {
          const segLine = L.polyline(segPath, {
            color: isSelectedSeg ? '#FACC15' : eff.prRank === 1 ? '#F59E0B' : '#3B82F6',
            weight: isSelectedSeg ? 6.5 : 3.5,
            opacity: isSelectedSeg ? 1 : 0.7,
            dashArray: isSelectedSeg ? undefined : '5 4',
          }).addTo(routeGroup);

          segLine.bindTooltip(
            `<strong>${eff.name}</strong><br/>${formatStopwatch(eff.elapsedTimeSecs)}${
              eff.avgWatts ? ` · ${eff.avgWatts}W` : ''
            }${eff.prRank === 1 ? ' · 🏆 PR #1' : ''}`,
            { sticky: true }
          );

          if (props.onSelectSegmentId) {
            segLine.on('click', () => {
              props.onSelectSegmentId!(String(eff.segmentId || eff.name));
            });
          }

          if (isSelectedSeg && autoFitZoomWindow && !props.zoomStreamRange) {
            boundsTargetCoords = segPath;
          }
        }
      });

      // 4. Distance Split Markers (every 5 mi / 5 km or 1 mi / 1 km)
      if (isStreamAligned && distArr && distArr.length === coords.length) {
        const unitMeters = props.distanceUnit === 'mi' ? 1609.344 : 1000;
        const totalUnits = (props.activity.distanceMeters || distArr[distArr.length - 1] || 0) / unitMeters;
        const splitStepUnits = totalUnits > 25 ? 10 : totalUnits > 10 ? 5 : totalUnits > 3 ? 1 : 0;

        if (splitStepUnits > 0) {
          let nextSplit = splitStepUnits;
          for (let i = 1; i < distArr.length; i++) {
            const u = (distArr[i] || 0) / unitMeters;
            if (u >= nextSplit) {
              const splitMarker = L.circleMarker(coords[i], {
                radius: 4.5,
                fillColor: '#0F172A',
                color: '#F8FAFC',
                weight: 1.5,
                fillOpacity: 0.9,
              }).addTo(routeGroup);
              splitMarker.bindTooltip(
                `${nextSplit} ${props.distanceUnit} · ${formatStopwatch(timeArr?.[i] || 0)}`,
                { direction: 'top' }
              );
              nextSplit += splitStepUnits;
            }
          }
        }
      }

      // 5. Start (Green) and Finish (Checkered Red) Markers
      const startPt = coords[0];
      const endPt = coords[coords.length - 1];

      L.circleMarker(startPt, {
        radius: 7,
        fillColor: '#10B981',
        color: '#FFFFFF',
        weight: 2.5,
        fillOpacity: 1,
      })
        .bindTooltip(`Start · ${props.activity.name}`, { direction: 'top' })
        .addTo(routeGroup);

      L.circleMarker(endPt, {
        radius: 7,
        fillColor: '#EF4444',
        color: '#FFFFFF',
        weight: 2.5,
        fillOpacity: 1,
      })
        .bindTooltip(
          `Finish · ${formatDistance(props.activity.distanceMeters, props.distanceUnit, 2)} in ${formatStopwatch(
            props.activity.movingTimeSecs
          )}`,
          { direction: 'top' }
        )
        .addTo(routeGroup);

      const bounds = L.latLngBounds(boundsTargetCoords);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
      }
    } else {
      // MULTI-ACTIVITY ROUTE EXPLORER MODE
      const allPoints: [number, number][] = [];
      const activitiesWithRoutes = props.activities.filter(
        (a) =>
          (Array.isArray(a.routeLatLngs) && a.routeLatLngs.length >= 2) ||
          (Array.isArray(a.streams?.latlng) && a.streams!.latlng!.length >= 2)
      );

      activitiesWithRoutes.forEach((act) => {
        const pts =
          act.streams?.latlng && act.streams.latlng.length >= 2
            ? act.streams.latlng
            : act.routeLatLngs || [];
        if (pts.length < 2) return;

        const isHighlighted = props.highlightedActivityId === act.id;
        const baseColor =
          act.sportCategory === 'Running'
            ? '#10B981'
            : act.sportCategory === 'Cycling'
              ? '#FC4C02'
              : '#3B82F6';

        if (isHighlighted) {
          L.polyline(pts, {
            color: '#FACC15',
            weight: 8,
            opacity: 0.4,
            lineCap: 'round',
          }).addTo(routeGroup);
        }

        const poly = L.polyline(pts, {
          color: isHighlighted ? '#FACC15' : baseColor,
          weight: isHighlighted ? 4.5 : 3,
          opacity: isHighlighted ? 1 : props.highlightedActivityId ? 0.45 : 0.8,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(routeGroup);

        poly.bindTooltip(
          `<div><strong>${act.name}</strong><br/>${act.startDateLocal.slice(0, 10)} · ${
            act.sportCategory
          } · ${formatDistance(act.distanceMeters, props.distanceUnit, 1)}${
            act.stravaPrCount > 0 ? ` · 🏆 ${act.stravaPrCount} PRs` : ''
          }${act.kudosCount ? ` · 👍 ${act.kudosCount} Kudos` : ''}</div>`,
          { sticky: true }
        );

        poly.on('click', () => {
          props.onSelectActivity(act);
        });
        if (props.onHoverActivity) {
          poly.on('mouseover', () => props.onHoverActivity!(act.id));
          poly.on('mouseout', () => props.onHoverActivity!(null));
        }

        // Start pin for each workout
        const startPin = L.circleMarker(pts[0], {
          radius: isHighlighted ? 6.5 : 4.5,
          fillColor: isHighlighted ? '#FACC15' : baseColor,
          color: '#FFFFFF',
          weight: 1.5,
          fillOpacity: 0.95,
        }).addTo(routeGroup);

        startPin.on('click', () => props.onSelectActivity(act));

        if (isHighlighted || !props.highlightedActivityId) {
          allPoints.push(...pts);
        }
      });

      if (allPoints.length >= 2) {
        const bounds = L.latLngBounds(allPoints);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
        }
      }
    }
  }, [
    props.mode,
    singleCoords,
    colorMode,
    autoFitZoomWindow,
    props.mode === 'SINGLE' ? props.zoomStreamRange : null,
    props.mode === 'SINGLE' ? props.selectedSegmentId : null,
    props.mode === 'MULTI' ? props.activities : null,
    props.mode === 'MULTI' ? props.highlightedActivityId : null,
    props.distanceUnit,
  ]);

  // Synchronized Live Hover Cursor Marker in SINGLE mode
  useEffect(() => {
    const cursorGroup = cursorLayerRef.current;
    if (!cursorGroup) return;
    cursorGroup.clearLayers();

    if (props.mode !== 'SINGLE') return;
    const idx = props.activeStreamIndex;
    if (idx === null || idx === undefined || singleCoords.length < 2) return;

    const streams = props.activity.streams;
    const coordIdx =
      streams?.latlng && streams.latlng.length === singleCoords.length
        ? Math.max(0, Math.min(singleCoords.length - 1, idx))
        : Math.max(
            0,
            Math.min(
              singleCoords.length - 1,
              Math.round((idx / Math.max(1, (streams?.time?.length || 100) - 1)) * (singleCoords.length - 1))
            )
          );

    const pt = singleCoords[coordIdx];
    if (!pt) return;

    // Outer pulse ring + bright telemetry cursor dot
    L.circleMarker(pt, {
      radius: 13,
      fillColor: '#3B82F6',
      color: '#3B82F6',
      weight: 2,
      fillOpacity: 0.25,
    }).addTo(cursorGroup);

    const timeSecs = streams?.time?.[idx] || 0;
    const watts = streams?.watts?.[idx];
    const hr = streams?.heartrate?.[idx];
    const vel = streams?.velocitySmooth?.[idx];
    const alt = streams?.altitude?.[idx];

    const dot = L.circleMarker(pt, {
      radius: 6.5,
      fillColor: '#38BDF8',
      color: '#FFFFFF',
      weight: 2.5,
      fillOpacity: 1,
    }).addTo(cursorGroup);

    const metricParts = [
      `<strong>${formatStopwatch(timeSecs)}</strong>`,
      watts !== undefined ? `${watts}W` : vel && vel > 0.4 ? formatPace(1000 / vel, props.distanceUnit) : null,
      hr !== undefined ? `${hr} bpm` : null,
      alt !== undefined ? `${Math.round(alt)}m elev` : null,
    ].filter(Boolean);

    dot.bindTooltip(metricParts.join(' · '), {
      permanent: true,
      direction: 'top',
      offset: [0, -8],
    });
  }, [props.mode, props.mode === 'SINGLE' ? props.activeStreamIndex : null, singleCoords]);

  const handleRecenter = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (props.mode === 'SINGLE' && singleCoords.length >= 2) {
      const bounds = L.latLngBounds(singleCoords);
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    } else if (props.mode === 'MULTI') {
      const pts = props.activities.flatMap((a) => a.routeLatLngs || a.streams?.latlng || []);
      if (pts.length >= 2) {
        const bounds = L.latLngBounds(pts);
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
      }
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 overflow-hidden">
      {/* Top Map Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-[#FC4C02]" />
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
              {props.mode === 'SINGLE'
                ? `Interactive GPS Route & Telemetry Map — ${props.activity.name}`
                : 'Interactive Multi-Activity GPS Route Explorer'}
            </h3>
            <p className="text-[11px] text-slate-500">
              {props.mode === 'SINGLE'
                ? 'Synchronized with Power/Pace & Heart Rate chart cursor, zoomed intervals, and Strava segments'
                : 'Click any GPS route or start pin on the map to inspect workout streams, segments, and Strava kudos'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Route Color-Coding Mode (SINGLE mode) */}
          {props.mode === 'SINGLE' && (
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]">
              {(
                [
                  { id: 'STRAVA', label: 'Strava Orange' },
                  { id: 'POWER', label: 'Power Gradient' },
                  { id: 'HR', label: 'HR Zones' },
                  { id: 'ALTITUDE', label: 'Elevation' },
                ] as const
              ).map((cm) => (
                <button
                  key={cm.id}
                  type="button"
                  onClick={() => setColorMode(cm.id)}
                  className={`min-h-[24px] px-2 py-0.5 rounded font-semibold transition-colors ${
                    colorMode === cm.id
                      ? 'bg-[#FC4C02] text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {cm.label}
                </button>
              ))}
            </div>
          )}

          {/* Auto-Fit Zoom Window Toggle (SINGLE mode) */}
          {props.mode === 'SINGLE' && props.zoomStreamRange && (
            <button
              type="button"
              onClick={() => setAutoFitZoomWindow((prev) => !prev)}
              className={`min-h-[26px] inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                autoFitZoomWindow
                  ? 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                  : 'border-slate-300 dark:border-slate-700 text-slate-500'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>{autoFitZoomWindow ? 'Fitted to Zoomed Section' : 'Fit Full Route'}</span>
            </button>
          )}

          {/* Map Tile Switcher */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]">
            <Layers className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5" />
            {(Object.keys(tileConfigs) as MapTileStyle[]).map((styleKey) => (
              <button
                key={styleKey}
                type="button"
                onClick={() => setTileStyle(styleKey)}
                className={`min-h-[24px] px-2 py-0.5 rounded font-medium transition-colors ${
                  tileStyle === styleKey
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tileConfigs[styleKey].label}
              </button>
            ))}
            <span
              title="Active Map Tile Provider (Configure Mapbox or OpenStreetMap API key in Data Sources)"
              className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] font-semibold mr-1"
            >
              {tileConfigs[tileStyle].providerBadge}
            </span>
          </div>

          <button
            type="button"
            onClick={handleRecenter}
            title="Recenter GPS Route Bounds"
            className="min-h-[26px] inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Fit Route</span>
          </button>
        </div>
      </div>

      {/* Map Canvas Container */}
      <div className="relative w-full">
        <div
          ref={mapContainerRef}
          className={`w-full ${props.heightClass || 'h-80 sm:h-96'} z-10 bg-slate-900`}
        />

        {/* Legend Overlay Pill in Bottom-Left */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[15] flex flex-wrap items-center gap-2.5 rounded-lg bg-slate-950/85 backdrop-blur-xs border border-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-200 shadow-lg">
          {props.mode === 'SINGLE' ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                Start ({singleCoords[0]?.[0]?.toFixed(3)}, {singleCoords[0]?.[1]?.toFixed(3)})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                Finish
              </span>
              {colorMode !== 'STRAVA' && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-slate-400">Low</span>
                  <span className="w-2 h-2 rounded-xs bg-blue-500 inline-block" />
                  <span className="w-2 h-2 rounded-xs bg-emerald-500 inline-block" />
                  <span className="w-2 h-2 rounded-xs bg-amber-500 inline-block" />
                  <span className="w-2 h-2 rounded-xs bg-red-500 inline-block" />
                  <span className="text-slate-400">Peak</span>
                </span>
              )}
              {props.activity.segmentEfforts?.length > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-400">
                  <Navigation className="w-3 h-3" />
                  {props.activity.segmentEfforts.length} Strava Segments Plotted
                </span>
              )}
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-1 rounded bg-[#FC4C02] inline-block" />
                Cycling Routes
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-1 rounded bg-emerald-500 inline-block" />
                Running Routes
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-1 rounded bg-yellow-400 inline-block" />
                Selected Workout
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
