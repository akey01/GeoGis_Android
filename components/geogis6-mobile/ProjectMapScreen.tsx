'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Feature from 'ol/Feature';
import { Circle as OlCircle, LineString, Point, Polygon } from 'ol/geom';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Fill, Stroke, Style, Text, Circle as CircleStyle } from 'ol/style';
import { boundingExtent, createEmpty, extend as extendExtent, isEmpty as isExtentEmpty } from 'ol/extent';
import { getDistance } from 'ol/sphere';
import { defaults as defaultInteractions } from 'ol/interaction';
import {
  ArrowRight,
  Crosshair,
  FolderOpen,
  Layers,
  List,
  Maximize2,
  Minus,
  Navigation,
  Plus,
  Ruler,
  Satellite,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatCoord,
  type BaseMapLayerId,
  type CrsMode,
  type FieldParcel,
  type LiveGnssFix,
  type SyncedProject,
} from './data/fieldData';

interface ProjectMapScreenProps {
  project: SyncedProject;
  parcels: FieldParcel[];
  activeParcel: FieldParcel;
  crsMode: CrsMode;
  isDemoMode: boolean;
  gnssFix: LiveGnssFix;
  fitTrigger: number;
  onToggleCrs: () => void;
  onSelectParcel: (parcelId: string) => void;
  onOpenParcel: () => void;
  onStakeVertex: (vertexId: string) => void;
  onCenterGps: () => void;
  onNotify: (msg: string) => void;
}

const BASE_LAYER_META: Record<BaseMapLayerId, { label: string; short: string }> = {
  esri_sat: { label: 'Ortofoto Satelital Esri', short: 'SAT ESRI' },
  hybrid: { label: 'Satélite Híbrido + Etiquetas', short: 'HÍBRIDO' },
  google_sat: { label: 'Google Satélite HD', short: 'GOOGLE' },
  cad_dark: { label: 'Vector CAD Oscuro (Offline)', short: 'CAD' },
};

const LAYER_ORDER: BaseMapLayerId[] = ['esri_sat', 'hybrid', 'google_sat', 'cad_dark'];

function getParcelRing3857(parcel: FieldParcel): [number, number][] {
  return parcel.vertices
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng))
    .map((v) => fromLonLat([v.lng, v.lat]) as [number, number]);
}

export default function ProjectMapScreen({
  project,
  parcels,
  activeParcel,
  crsMode,
  isDemoMode,
  gnssFix,
  fitTrigger,
  onToggleCrs,
  onSelectParcel,
  onOpenParcel,
  onStakeVertex,
  onCenterGps,
  onNotify,
}: ProjectMapScreenProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  const esriSatLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const hybridLabelsLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const googleSatLayerRef = useRef<TileLayer<XYZ> | null>(null);

  const parcelsSourceRef = useRef<VectorSource>(new VectorSource());
  const verticesSourceRef = useRef<VectorSource>(new VectorSource());
  const gnssSourceRef = useRef<VectorSource>(new VectorSource());
  const measureSourceRef = useRef<VectorSource>(new VectorSource());

  const [baseLayer, setBaseLayer] = useState<BaseMapLayerId>('esri_sat');
  const [showAllParcels, setShowAllParcels] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePts, setMeasurePts] = useState<[number, number][]>([]);
  const [showParcelDrawer, setShowParcelDrawer] = useState(false);
  const [parcelSearch, setParcelSearch] = useState('');
  const [mapZoom, setMapZoom] = useState(18);
  const [scaleInfo, setScaleInfo] = useState({ denom: 1000, meters: 25 });

  // Latest callbacks & state refs for OL click listener
  const measureModeRef = useRef(measureMode);
  measureModeRef.current = measureMode;
  const activeParcelRef = useRef(activeParcel);
  activeParcelRef.current = activeParcel;
  const onSelectParcelRef = useRef(onSelectParcel);
  onSelectParcelRef.current = onSelectParcel;
  const onStakeVertexRef = useRef(onStakeVertex);
  onStakeVertexRef.current = onStakeVertex;
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  // Compute total measured distance in meters
  const measuredDistanceM = useMemo(() => {
    if (measurePts.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < measurePts.length; i++) {
      total += getDistance(toLonLat(measurePts[i - 1]), toLonLat(measurePts[i]));
    }
    return total;
  }, [measurePts]);

  // Fit map view to all parcels in current project
  const fitAllParcels = useCallback(
    (animate = true) => {
      const map = mapRef.current;
      if (!map) return;
      const extent = createEmpty();
      for (const p of parcels) {
        const ring = getParcelRing3857(p);
        if (ring.length > 0) {
          extendExtent(extent, boundingExtent(ring));
        }
      }
      if (!isExtentEmpty(extent)) {
        map.getView().fit(extent, {
          padding: [56, 48, 175, 56],
          maxZoom: 19.5,
          duration: animate ? 380 : 0,
        });
      }
    },
    [parcels]
  );

  // Fit map view to a single parcel
  const flyToParcel = useCallback((parcel: FieldParcel) => {
    const map = mapRef.current;
    if (!map) return;
    const ring = getParcelRing3857(parcel);
    if (ring.length === 0) return;
    const ext = boundingExtent(ring);
    map.getView().fit(ext, {
      padding: [68, 56, 185, 64],
      maxZoom: 20,
      duration: 380,
    });
  }, []);

  // Initialize OpenLayers Map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const esriSatLayer = new TileLayer({
      source: new XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        crossOrigin: 'anonymous',
        maxZoom: 19,
        cacheSize: 512,
      }),
      preload: 1,
      visible: true,
    });

    const hybridLabelsLayer = new TileLayer({
      source: new XYZ({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        crossOrigin: 'anonymous',
        maxZoom: 19,
        cacheSize: 256,
      }),
      preload: 0,
      visible: false,
    });

    const googleSatLayer = new TileLayer({
      source: new XYZ({
        url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        crossOrigin: 'anonymous',
        maxZoom: 21,
        cacheSize: 512,
      }),
      preload: 1,
      visible: false,
    });

    esriSatLayerRef.current = esriSatLayer;
    hybridLabelsLayerRef.current = hybridLabelsLayer;
    googleSatLayerRef.current = googleSatLayer;

    // Parcels vector layer with dynamic zoom-aware styling
    const parcelsLayer = new VectorLayer({
      source: parcelsSourceRef.current,
      declutter: true,
      style: (feature, resolution) => {
        const isActive = Boolean(feature.get('isActive'));
        const code = String(feature.get('code') || '');
        const areaM2 = Number(feature.get('areaM2') || 0);
        const showDetailedLabel = resolution < 2.5; // zoomed in enough to show area

        const labelText =
          showDetailedLabel && areaM2 > 0
            ? `${code}\n${areaM2.toLocaleString('en-US', { maximumFractionDigits: 1 })} m²`
            : code;

        return new Style({
          fill: new Fill({
            color: isActive ? 'rgba(6, 182, 212, 0.24)' : 'rgba(21, 27, 43, 0.44)',
          }),
          stroke: new Stroke({
            color: isActive ? '#06b6d4' : '#4edea3',
            width: isActive ? 2.8 : 1.5,
            lineDash: isActive ? undefined : [5, 4],
          }),
          text:
            resolution < 14
              ? new Text({
                  text: labelText,
                  font: isActive
                    ? '700 12px "Space Grotesk", Inter, sans-serif'
                    : '600 10.5px "JetBrains Mono", monospace',
                  fill: new Fill({ color: isActive ? '#acedff' : '#dde2f8' }),
                  stroke: new Stroke({ color: '#080e1d', width: 3 }),
                  overflow: true,
                })
              : undefined,
        });
      },
    });

    // Vertices & segment distance labels for active parcel
    const verticesLayer = new VectorLayer({
      source: verticesSourceRef.current,
      style: (feature, resolution) => {
        const kind = feature.get('kind');
        if (kind === 'seg_label') {
          if (resolution > 1.8) return undefined; // show side lengths when zoomed in
          return new Style({
            text: new Text({
              text: String(feature.get('label') || ''),
              font: '700 10px "JetBrains Mono", monospace',
              fill: new Fill({ color: '#4cd7f6' }),
              stroke: new Stroke({ color: '#080e1d', width: 3 }),
            }),
          });
        }
        return new Style({
          image: new CircleStyle({
            radius: resolution < 1.2 ? 6.5 : 4.5,
            fill: new Fill({ color: '#06b6d4' }),
            stroke: new Stroke({ color: '#080e1d', width: 2 }),
          }),
          text:
            resolution < 2.2
              ? new Text({
                  text: String(feature.get('shortId') || ''),
                  offsetY: -13,
                  font: '700 10px "JetBrains Mono", monospace',
                  fill: new Fill({ color: '#acedff' }),
                  stroke: new Stroke({ color: '#080e1d', width: 3 }),
                })
              : undefined,
        });
      },
    });

    // Measure tool layer
    const measureLayer = new VectorLayer({
      source: measureSourceRef.current,
      style: (feature) => {
        const kind = feature.get('kind');
        if (kind === 'measure_line') {
          return new Style({
            stroke: new Stroke({ color: '#ffb95f', width: 2.5, lineDash: [6, 4] }),
          });
        }
        return new Style({
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: '#ffb95f' }),
            stroke: new Stroke({ color: '#080e1d', width: 1.5 }),
          }),
          text: feature.get('label')
            ? new Text({
                text: String(feature.get('label')),
                offsetY: -14,
                font: '700 10px "JetBrains Mono", monospace',
                fill: new Fill({ color: '#ffb95f' }),
                stroke: new Stroke({ color: '#080e1d', width: 3 }),
              })
            : undefined,
        });
      },
    });

    // Live GNSS Rover puck + accuracy circle
    const gnssLayer = new VectorLayer({
      source: gnssSourceRef.current,
      style: (feature) => {
        const kind = feature.get('kind');
        if (kind === 'accuracy_ring') {
          return new Style({
            fill: new Fill({ color: 'rgba(78, 222, 163, 0.14)' }),
            stroke: new Stroke({ color: 'rgba(78, 222, 163, 0.55)', width: 1.2 }),
          });
        }
        return new Style({
          image: new CircleStyle({
            radius: 6.5,
            fill: new Fill({ color: '#4edea3' }),
            stroke: new Stroke({ color: '#080e1d', width: 2.2 }),
          }),
        });
      },
    });

    const initialCenter = fromLonLat([
      activeParcel.vertices[0]?.lng ?? -69.8053,
      activeParcel.vertices[0]?.lat ?? 11.945,
    ]);

    const map = new Map({
      target: mapContainerRef.current,
      layers: [
        esriSatLayer,
        googleSatLayer,
        hybridLabelsLayer,
        parcelsLayer,
        verticesLayer,
        measureLayer,
        gnssLayer,
      ],
      view: new View({
        center: initialCenter,
        zoom: 18,
        minZoom: 5,
        maxZoom: 21,
        constrainResolution: false,
      }),
      controls: [],
      interactions: defaultInteractions({
        pinchRotate: false,
        altShiftDragRotate: false,
      }),
    });

    const updateScale = () => {
      const view = map.getView();
      const res = view.getResolution() || 1;
      const zoom = view.getZoom() || 18;
      const center = view.getCenter();
      const latRad = center ? (toLonLat(center)[1] * Math.PI) / 180 : (11.94 * Math.PI) / 180;
      const metersPerPx = res * Math.cos(latRad);
      const barMeters = Math.max(1, Math.round(metersPerPx * 64));
      const denom = Math.max(50, Math.round(metersPerPx * 3780));
      setMapZoom(Math.round(zoom * 10) / 10);
      setScaleInfo({ denom, meters: barMeters });
    };

    map.getView().on('change:resolution', updateScale);
    map.on('moveend', updateScale);
    updateScale();

    // Tap interaction: measure OR select vertex OR select parcel
    map.on('singleclick', (evt) => {
      if (measureModeRef.current) {
        const pt = evt.coordinate as [number, number];
        setMeasurePts((prev) => [...prev, pt]);
        return;
      }

      let hitVertexId: string | null = null;
      let hitParcelId: string | null = null;
      let hitParcelCode: string | null = null;

      map.forEachFeatureAtPixel(
        evt.pixel,
        (feat) => {
          const kind = feat.get('kind');
          if (kind === 'vertex' && !hitVertexId) {
            hitVertexId = String(feat.get('vertexId'));
            return true;
          }
          if (kind === 'parcel' && !hitParcelId) {
            hitParcelId = String(feat.get('parcelId'));
            hitParcelCode = String(feat.get('code'));
          }
          return false;
        },
        { hitTolerance: 10 }
      );

      if (hitVertexId) {
        onStakeVertexRef.current(hitVertexId);
        return;
      }

      if (hitParcelId) {
        if (hitParcelId !== activeParcelRef.current.id) {
          onSelectParcelRef.current(hitParcelId);
          onNotifyRef.current(`Parcela ${hitParcelCode} seleccionada`);
        } else {
          onNotifyRef.current(`Parcela activa: ${hitParcelCode} · Pulsa "Abrir Parcela" para ver vértices`);
        }
      }
    });

    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync base map layer visibility
  useEffect(() => {
    esriSatLayerRef.current?.setVisible(baseLayer === 'esri_sat' || baseLayer === 'hybrid');
    hybridLabelsLayerRef.current?.setVisible(baseLayer === 'hybrid');
    googleSatLayerRef.current?.setVisible(baseLayer === 'google_sat');
  }, [baseLayer]);

  // Sync ALL parcels & active parcel vertices onto OpenLayers VectorSources
  useEffect(() => {
    const pSrc = parcelsSourceRef.current;
    const vSrc = verticesSourceRef.current;
    pSrc.clear();
    vSrc.clear();

    const listToRender = showAllParcels ? parcels : [activeParcel];

    for (const p of listToRender) {
      const ring = getParcelRing3857(p);
      if (ring.length === 0) continue;

      const isActive = p.id === activeParcel.id;
      let geom;
      if (ring.length >= 3 && p.geometryType !== 'abierta' && p.geometryType !== 'puntos') {
        geom = new Polygon([[...ring, ring[0]]]);
      } else if (ring.length >= 2 && p.geometryType !== 'puntos') {
        geom = new LineString(ring);
      } else {
        geom = new Point(ring[0]);
      }

      const feat = new Feature({
        geometry: geom,
        kind: 'parcel',
        parcelId: p.id,
        code: p.code,
        areaM2: p.areaGraficaM2,
        isActive,
      });
      pSrc.addFeature(feat);
    }

    // Active parcel vertices & side-length labels
    const activeRing = getParcelRing3857(activeParcel);
    for (let i = 0; i < activeParcel.vertices.length; i++) {
      const v = activeParcel.vertices[i];
      const coord = activeRing[i];
      if (!coord) continue;

      vSrc.addFeature(
        new Feature({
          geometry: new Point(coord),
          kind: 'vertex',
          vertexId: v.id,
          shortId: v.shortId,
        })
      );

      if (activeRing.length >= 2 && (activeParcel.geometryType !== 'abierta' || i < activeRing.length - 1)) {
        const nextCoord = activeRing[(i + 1) % activeRing.length];
        if (nextCoord && v.segmentLengthToNext > 0) {
          const mid: [number, number] = [(coord[0] + nextCoord[0]) / 2, (coord[1] + nextCoord[1]) / 2];
          vSrc.addFeature(
            new Feature({
              geometry: new Point(mid),
              kind: 'seg_label',
              label: `${v.segmentLengthToNext.toFixed(2)}m`,
            })
          );
        }
      }
    }
  }, [parcels, activeParcel, showAllParcels]);

  // Fit extent whenever project changes or fitTrigger increments
  useEffect(() => {
    const t = setTimeout(() => fitAllParcels(fitTrigger > 0), 80);
    return () => clearTimeout(t);
  }, [fitAllParcels, fitTrigger, project.id]);

  // Update GNSS live marker + accuracy ring
  useEffect(() => {
    const gSrc = gnssSourceRef.current;
    gSrc.clear();
    if (!Number.isFinite(gnssFix.lat) || !Number.isFinite(gnssFix.lng)) return;

    const pos3857 = fromLonLat([gnssFix.lng, gnssFix.lat]);
    const radiusM = Math.max(2, Math.min(80, gnssFix.accuracy || 5));

    gSrc.addFeature(
      new Feature({
        geometry: new OlCircle(pos3857, radiusM),
        kind: 'accuracy_ring',
      })
    );
    gSrc.addFeature(
      new Feature({
        geometry: new Point(pos3857),
        kind: 'gnss_puck',
      })
    );
  }, [gnssFix]);

  // Update interactive measure features
  useEffect(() => {
    const mSrc = measureSourceRef.current;
    mSrc.clear();
    if (measurePts.length === 0) return;

    if (measurePts.length >= 2) {
      mSrc.addFeature(
        new Feature({
          geometry: new LineString(measurePts),
          kind: 'measure_line',
        })
      );
    }

    measurePts.forEach((pt, idx) => {
      let label = idx === 0 ? 'M1' : '';
      if (idx > 0) {
        const segM = getDistance(toLonLat(measurePts[idx - 1]), toLonLat(pt));
        label = `${segM.toFixed(2)} m`;
      }
      mSrc.addFeature(
        new Feature({
          geometry: new Point(pt),
          kind: 'measure_pt',
          label,
        })
      );
    });
  }, [measurePts]);

  const handleZoomBy = (delta: number) => {
    const view = mapRef.current?.getView();
    if (!view) return;
    const z = view.getZoom() ?? 18;
    view.animate({ zoom: Math.max(5, Math.min(21, z + delta)), duration: 220 });
  };

  const handleCycleBaseLayer = () => {
    const idx = LAYER_ORDER.indexOf(baseLayer);
    const next = LAYER_ORDER[(idx + 1) % LAYER_ORDER.length];
    setBaseLayer(next);
    onNotify(`Capa base: ${BASE_LAYER_META[next].label}`);
  };

  const handleCenterOnGps = () => {
    const map = mapRef.current;
    if (map && Number.isFinite(gnssFix.lat) && Number.isFinite(gnssFix.lng)) {
      const targetCoord = gnssFix.isLiveHardware
        ? fromLonLat([gnssFix.lng, gnssFix.lat])
        : fromLonLat([
            activeParcel.vertices[0]?.lng ?? gnssFix.lng,
            activeParcel.vertices[0]?.lat ?? gnssFix.lat,
          ]);
      map.getView().animate({ center: targetCoord, zoom: 19, duration: 380 });
    }
    onCenterGps();
  };

  const filteredParcels = useMemo(() => {
    const q = parcelSearch.trim().toLowerCase();
    if (!q) return parcels;
    return parcels.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.owner.toLowerCase().includes(q) ||
        p.sector.toLowerCase().includes(q)
    );
  }, [parcelSearch, parcels]);

  return (
    <div className="flex flex-col w-full h-full relative select-none bg-[#0d1322]">
      {/* Ultra-Compact Tactical Sub-Bar (40px) */}
      <div className="h-10 shrink-0 px-3 bg-[#151b2b] flex items-center justify-between gap-2 z-20 shadow-md border-b border-[#242a3a]">
        <button
          type="button"
          onClick={() => setShowParcelDrawer(true)}
          className="flex items-center gap-1.5 min-w-0 active:opacity-80"
          title="Ver todas las parcelas del proyecto"
        >
          <FolderOpen className="w-4 h-4 text-[#4cd7f6] shrink-0" />
          <span className="font-stitch-headline text-[12.5px] text-[#dde2f8] font-bold truncate">
            {project.name}
          </span>
          <span className="font-stitch-mono text-[9.5px] bg-[#06b6d4]/20 text-[#4cd7f6] px-1.5 py-0.5 rounded font-bold shrink-0">
            {parcels.length}P
          </span>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleCrs}
            className="flex items-center gap-1 bg-[#191f2f] hover:bg-[#242a3a] px-2 py-0.5 rounded border border-[#2f3445]"
            title="Alternar Datum REGVEN 19N / PSAD56"
          >
            <span className="font-stitch-mono text-[9.5px] text-[#4cd7f6] font-semibold">
              {crsMode === 'regven' ? `REGVEN ${activeParcel.huso}N` : `PSAD56 ${activeParcel.huso}N`}
            </span>
          </button>

          <div className="flex items-center gap-1 bg-[#00a572]/20 text-[#4edea3] px-1.5 py-0.5 rounded">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4edea3] animate-pulse" />
            <span className="font-stitch-mono text-[9.5px] font-semibold tracking-tight">
              {gnssFix.isLiveHardware ? `±${gnssFix.accuracy.toFixed(1)}m` : 'RTK'}
            </span>
          </div>

          <span className="bg-[#242a3a] text-[#bcc9cd] font-stitch-mono text-[9.5px] px-1.5 py-0.5 rounded font-semibold">
            {isDemoMode ? 'DEMO' : 'PRO'}
          </span>
        </div>
      </div>

      {/* Interactive OpenLayers Map Viewport */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-[#080e1d]">
        <div
          ref={mapContainerRef}
          className={`absolute inset-0 w-full h-full ${baseLayer === 'cad_dark' ? 'cad-dark-grid' : ''}`}
        />

        {/* Active Measure Banner */}
        {measureMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-[#151b2b]/95 border border-[#ffb95f]/60 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-xl backdrop-blur-md">
            <Ruler className="w-3.5 h-3.5 text-[#ffb95f] shrink-0" />
            <span className="font-stitch-mono text-[10.5px] text-[#ffb95f] font-bold whitespace-nowrap">
              {measurePts.length < 2
                ? 'Toca 2+ puntos en el mapa'
                : `Dist: ${measuredDistanceM.toFixed(2)} m (${measurePts.length} pts)`}
            </span>
            {measurePts.length > 0 && (
              <button
                type="button"
                onClick={() => setMeasurePts([])}
                className="p-1 rounded bg-[#242a3a] text-[#dde2f8]"
                title="Limpiar medición"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Top-Right Compass, Zoom & Scale */}
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5 z-10 pointer-events-auto">
          <button
            type="button"
            onClick={() => {
              mapRef.current?.getView().animate({ rotation: 0, duration: 250 });
              onNotify('Norte Geodésico restablecido (Az 0°)');
            }}
            className="w-10 h-10 rounded-full bg-[#191f2f]/90 backdrop-blur-md flex flex-col items-center justify-center shadow-lg active:scale-95 transition-transform border border-[#2f3445]"
          >
            <span className="font-stitch-mono text-[9px] font-bold text-[#ffb4ab] leading-none">N</span>
            <Navigation className="w-4 h-4 text-[#4cd7f6]" />
          </button>

          <div className="bg-[#191f2f]/88 backdrop-blur-md px-2 py-1 rounded flex flex-col items-end shadow-md border border-[#242a3a]">
            <span className="font-stitch-mono text-[9.5px] text-[#bcc9cd]">
              1:{scaleInfo.denom.toLocaleString('en-US')} · {scaleInfo.meters}m
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="font-stitch-mono text-[8.5px] text-[#4cd7f6] font-bold">
                Z{mapZoom.toFixed(1)} · {BASE_LAYER_META[baseLayer].short}
              </span>
              <div className="w-10 h-1 bg-[#2f3445] flex">
                <div className="w-1/2 h-full bg-[#dde2f8]" />
                <div className="w-1/2 h-full bg-[#242a3a]" />
              </div>
            </div>
          </div>
        </div>

        {/* Left Floating GIS Tool Rail */}
        <div className="absolute top-3 left-3 w-10 bg-[#151b2b]/92 backdrop-blur-xl rounded-xl flex flex-col items-center py-1 gap-1 z-10 shadow-xl border border-[#242a3a]">
          <button
            type="button"
            aria-label="Lista de Parcelas"
            onClick={() => setShowParcelDrawer(true)}
            className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
              showParcelDrawer ? 'text-[#003640] bg-[#4cd7f6]' : 'text-[#4cd7f6] hover:bg-[#242a3a]'
            }`}
            title={`Todas las parcelas (${parcels.length})`}
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Encuadrar Todas las Parcelas"
            onClick={() => {
              fitAllParcels(true);
              onNotify(`Encuadradas ${parcels.length} parcelas del proyecto`);
            }}
            className="w-8 h-8 rounded flex items-center justify-center text-[#dde2f8] hover:text-[#4cd7f6] active:bg-[#242a3a] transition-colors"
            title="Ver todas las parcelas (Zoom Extensión)"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Mostrar/Ocultar Colindantes"
            onClick={() => {
              setShowAllParcels((prev) => {
                const next = !prev;
                onNotify(next ? `Mostrando todas (${parcels.length} parcelas)` : 'Solo parcela activa visible');
                return next;
              });
            }}
            className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
              showAllParcels ? 'text-[#4edea3] bg-[#242a3a]/70' : 'text-[#bcc9cd] hover:text-[#dde2f8]'
            }`}
            title="Mostrar todas las parcelas o solo la activa"
          >
            <Layers className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Medir Distancia"
            onClick={() => {
              setMeasureMode((prev) => {
                const next = !prev;
                if (!next) setMeasurePts([]);
                onNotify(next ? 'Regla activa: toca puntos sobre el mapa satelital' : 'Regla desactivada');
                return next;
              });
            }}
            className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
              measureMode ? 'text-[#ffb95f] bg-[#242a3a]' : 'text-[#bcc9cd] hover:text-[#dde2f8]'
            }`}
            title="Medir distancia libre sobre el mapa"
          >
            <Ruler className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Centrar GPS"
            onClick={handleCenterOnGps}
            className="w-8 h-8 rounded flex items-center justify-center text-[#4edea3] hover:text-[#6ffbbe] active:bg-[#242a3a] transition-colors"
            title="Centrar en ubicación GPS"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        </div>

        {/* Right Floating Zoom & Base Layer Controls */}
        <div className="absolute bottom-[168px] right-3 flex flex-col gap-1.5 z-10">
          <button
            type="button"
            onClick={handleCycleBaseLayer}
            className={`w-10 h-10 rounded-xl backdrop-blur-xl flex items-center justify-center shadow-lg active:scale-95 transition-transform border border-[#242a3a] ${
              baseLayer === 'cad_dark'
                ? 'bg-[#242a3a] text-[#ffb95f]'
                : 'bg-[#151b2b]/90 text-[#4cd7f6]'
            }`}
            title="Cambiar Mapa Base (Esri / Híbrido / Google / CAD)"
          >
            <Satellite className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleZoomBy(1.2)}
            className="w-10 h-10 rounded-xl bg-[#151b2b]/90 backdrop-blur-xl flex items-center justify-center text-[#dde2f8] hover:text-[#4cd7f6] shadow-lg active:scale-95 transition-transform border border-[#242a3a]"
            title="Acercar Zoom"
          >
            <Plus className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => handleZoomBy(-1.2)}
            className="w-10 h-10 rounded-xl bg-[#151b2b]/90 backdrop-blur-xl flex items-center justify-center text-[#dde2f8] hover:text-[#4cd7f6] shadow-lg active:scale-95 transition-transform border border-[#242a3a]"
            title="Alejar Zoom"
          >
            <Minus className="w-5 h-5" />
          </button>
        </div>

        {/* Bottom Selected Parcel Telemetry Card */}
        <div className="absolute bottom-3 inset-x-3 z-20">
          <div className="bg-[#191f2f]/95 backdrop-blur-xl rounded-xl p-3 shadow-2xl flex flex-col gap-2 border border-[#2f3445]/80">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => flyToParcel(activeParcel)}
                className="flex items-center gap-1.5 min-w-0 text-left"
                title="Hacer zoom a esta parcela"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-[#06b6d4] animate-pulse shrink-0" />
                <span className="font-stitch-headline text-[17px] font-semibold text-[#dde2f8] truncate">
                  {activeParcel.code}
                </span>
                <span className="bg-[#242a3a] text-[#4cd7f6] font-stitch-mono text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                  {activeParcel.zoneTag}
                </span>
              </button>
              <span className="font-stitch-mono text-[10px] text-[#bcc9cd] shrink-0">
                {activeParcel.geoCenterText}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 bg-[#080e1d]/85 p-2 rounded">
              <div className="flex flex-col">
                <span className="text-[9.5px] text-[#869397] uppercase tracking-wider">Superficie</span>
                <span className="font-stitch-mono text-[13px] text-[#dde2f8] font-semibold">
                  {activeParcel.areaGraficaM2.toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
                  <span className="text-[10px] text-[#869397]">m²</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9.5px] text-[#869397] uppercase tracking-wider">Perímetro</span>
                <span className="font-stitch-mono text-[13px] text-[#dde2f8] font-semibold">
                  {activeParcel.perimeterM.toFixed(2)} <span className="text-[10px] text-[#869397]">m</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9.5px] text-[#869397] uppercase tracking-wider">Linderos</span>
                <span className="font-stitch-mono text-[13px] text-[#4edea3] font-semibold">
                  {activeParcel.vertices.length} Vértices
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => onStakeVertex(activeParcel.vertices[0]?.id || 'V-01')}
                className="h-11 px-3 rounded bg-[#242a3a] text-[#dde2f8] hover:bg-[#33394a] flex items-center justify-center transition-colors"
                title="Ir directo a Replanteo RTK"
              >
                <Share2 className="w-4 h-4 text-[#4cd7f6]" />
              </button>
              <button
                type="button"
                onClick={onOpenParcel}
                className="flex-1 h-11 bg-[#06b6d4] hover:bg-[#4cd7f6] text-[#003640] font-stitch-headline text-[12.5px] uppercase tracking-wider rounded font-bold flex items-center justify-center gap-1.5 transition-colors shadow-md"
              >
                <span>Abrir Parcela</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Multi-Parcel Project Explorer Drawer (like Desktop ParcelList) */}
        {showParcelDrawer && (
          <div className="absolute inset-0 z-30 bg-[#080e1d]/80 backdrop-blur-sm flex flex-col justify-end">
            <div className="bg-[#151b2b] border-t border-[#2f3445] rounded-t-2xl max-h-[75%] flex flex-col shadow-2xl">
              <div className="px-4 py-3 border-b border-[#242a3a] flex items-center justify-between">
                <div>
                  <h3 className="font-stitch-headline text-[15px] font-bold text-[#dde2f8]">
                    Parcelas del Proyecto ({parcels.length})
                  </h3>
                  <span className="font-stitch-mono text-[10px] text-[#869397]">{project.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowParcelDrawer(false)}
                  className="w-8 h-8 rounded-lg bg-[#242a3a] text-[#bcc9cd] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-3 pt-2.5 pb-1.5">
                <div className="relative flex items-center">
                  <Search className="w-4 h-4 absolute left-3 text-[#869397]" />
                  <input
                    type="text"
                    value={parcelSearch}
                    onChange={(e) => setParcelSearch(e.target.value)}
                    placeholder="Buscar código, sector o propietario..."
                    className="w-full h-9 bg-[#080e1d] border border-[#242a3a] rounded-lg pl-9 pr-3 font-stitch-mono text-[11.5px] text-[#dde2f8] placeholder:text-[#869397] outline-none focus:border-[#4cd7f6]/60"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2">
                {filteredParcels.map((p) => {
                  const isSel = p.id === activeParcel.id;
                  const v0 = p.vertices[0];
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onSelectParcel(p.id);
                        flyToParcel(p);
                        setShowParcelDrawer(false);
                        onNotify(`Enfocando Parcela ${p.code}`);
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition-colors ${
                        isSel
                          ? 'bg-[#242a3a] border-[#4cd7f6]/60'
                          : 'bg-[#0d1322] border-[#242a3a] hover:bg-[#191f2f]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isSel ? 'bg-[#4cd7f6]' : 'bg-[#4edea3]'
                            }`}
                          />
                          <span className="font-stitch-headline text-[14px] font-bold text-[#dde2f8] truncate">
                            {p.code}
                          </span>
                          <span className="font-stitch-mono text-[9px] px-1.5 py-0.5 rounded bg-[#151b2b] text-[#4cd7f6]">
                            {p.vertices.length}V
                          </span>
                        </div>
                        <span className="font-stitch-mono text-[11px] font-bold text-[#4edea3] shrink-0">
                          {p.areaGraficaM2.toLocaleString('en-US', { minimumFractionDigits: 2 })} m²
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 font-stitch-mono text-[10px] text-[#869397]">
                        <span className="truncate">{p.owner}</span>
                        {v0 && (
                          <span className="shrink-0 ml-2">
                            E:{formatCoord(crsMode === 'regven' ? v0.esteRegven : v0.estePsad56)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {filteredParcels.length === 0 && (
                  <p className="text-center font-stitch-mono text-[11px] text-[#869397] py-6">
                    No se encontraron parcelas con &quot;{parcelSearch}&quot;
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
