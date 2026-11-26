'use client';

/**
 * MapViewer.tsx — Visor de Mapa Interactivo de Alto Rendimiento con OpenLayers
 * GeoGIS6
 *
 * Optimizaciones de arquitectura gráfica aplicadas:
 *  1. Ciclo de vida React estricto: Mapa y VectorSources persistentes en useRef (0 recreaciones).
 *  2. Control de VRAM/Red en TileLayers: preload: 1 y cacheSize: 512 (elimina congelamientos por preload: Infinity).
 *  3. Banderas de rendimiento activas: updateWhileAnimating: false y updateWhileInteracting: false en capas masivas.
 *  4. Geometría MultiPoint por parcela para vértices y eliminación total de etiquetas de texto en puntos (P1..Pn).
 *  5. Etiquetas limpias solo en polígonos: únicamente Nombre de Parcela y Área en m² con declutter: true.
 *  6. Estilos globales de capa reutilizados en caché y un único listener pointermove con throttling.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

// ── OpenLayers ───────────────────────────────────────────────────────────────
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Draw from 'ol/interaction/Draw';
import Translate from 'ol/interaction/Translate';
import { defaults as defaultInteractions, MouseWheelZoom } from 'ol/interaction';
import Feature from 'ol/Feature';
import { Polygon, LineString, MultiPoint } from 'ol/geom';
import { transform, get as getProjection } from 'ol/proj';
import { Style, Fill, Stroke, Text, Circle as CircleStyle } from 'ol/style';
import type { Coordinate } from 'ol/coordinate';
import type { DrawEvent } from 'ol/interaction/Draw';
import type { TranslateEvent } from 'ol/interaction/Translate';
import { normalizeRingClockwiseFromNorth } from '@/lib/polygon-union';
import type RenderEvent from 'ol/render/Event';
import type { FeatureLike } from 'ol/Feature';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { Move, Crosshair, X, MousePointer, Maximize2, SlidersHorizontal, RotateCcw, Mountain } from 'lucide-react';
import LayerBand from '@/src/components/map/LayerBand';
import MeasureToolbar from '@/src/components/map/measure/MeasureToolbar';
import { useMeasureTool } from '@/src/components/map/measure/useMeasureTool';
import { useMeasureStore } from '@/src/components/map/measure/useMeasureStore';
import { useContourLayer } from '@/src/components/map/contours/useContourLayer';
import { useContourStore } from '@/src/components/map/contours/useContourStore';
import ContourMapHUD from '@/src/components/map/contours/ContourMapHUD';
import ContourPrintModal from '@/src/components/map/contours/ContourPrintModal';

// ── Proj4 + Registro Oficial IGVSB (REGVEN GRS80 y PSAD56 La Canoa) ──────────
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';

// ── Stores ───────────────────────────────────────────────────────────────────
import { useAppStore, type Parcel, type TransformationResult } from '@/lib/store';
import { useMapStore, type BaseLayerType } from '@/src/store/useMapStore';
import { isDemoRole, hasPermission } from '@/src/types/auth';

// ── Registrar proyecciones oficiales IGVSB Venezuela (Zonas 18N a 21N) ───────
// REGVEN Geográfico (GRS80)
proj4.defs('EPSG:4161', '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs');

// REGVEN UTM Oficial IGVSB (Elipsoide GRS80, Husos 18N a 21N)
proj4.defs('EPSG:2201', '+proj=utm +zone=18 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:2202', '+proj=utm +zone=19 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:2203', '+proj=utm +zone=20 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:2204', '+proj=utm +zone=21 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// WGS84 UTM (Husos 18N a 21N)
proj4.defs('EPSG:32618', '+proj=utm +zone=18 +ellps=WGS84 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32619', '+proj=utm +zone=19 +ellps=WGS84 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32620', '+proj=utm +zone=20 +ellps=WGS84 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32621', '+proj=utm +zone=21 +ellps=WGS84 +datum=WGS84 +units=m +no_defs');

// PSAD56 / La Canoa UTM por zona (24818..24821 y alias estándar 24878..24881)
proj4.defs('EPSG:24818', '+proj=utm +zone=18 +ellps=intl +towgs84=-270.933,115.599,-360.226,-5.266,-1.238,2.381,-5.109 +units=m +no_defs');
proj4.defs('EPSG:24819', '+proj=utm +zone=19 +ellps=intl +towgs84=-270.933,115.599,-360.226,-5.266,-1.238,2.381,-5.109 +units=m +no_defs');
proj4.defs('EPSG:24820', '+proj=utm +zone=20 +ellps=intl +towgs84=-270.933,115.599,-360.226,-5.266,-1.238,2.381,-5.109 +units=m +no_defs');
proj4.defs('EPSG:24821', '+proj=utm +zone=21 +ellps=intl +towgs84=-270.933,115.599,-360.226,-5.266,-1.238,2.381,-5.109 +units=m +no_defs');
proj4.defs('EPSG:24878', '+proj=utm +zone=18 +ellps=intl +towgs84=-270.933,115.599,-360.226,-5.266,-1.238,2.381,-5.109 +units=m +no_defs');
proj4.defs('EPSG:24879', '+proj=utm +zone=19 +ellps=intl +towgs84=-270.933,115.599,-360.226,-5.266,-1.238,2.381,-5.109 +units=m +no_defs');
proj4.defs('EPSG:24880', '+proj=utm +zone=20 +ellps=intl +towgs84=-270.933,115.599,-360.226,-5.266,-1.238,2.381,-5.109 +units=m +no_defs');
proj4.defs('EPSG:24881', '+proj=utm +zone=21 +ellps=intl +towgs84=-270.933,115.599,-360.226,-5.266,-1.238,2.381,-5.109 +units=m +no_defs');

register(proj4);

// Asignar extent métrico válido para husos UTM de Venezuela
const VENEZUELA_UTM_CODES = [
  'EPSG:2201', 'EPSG:2202', 'EPSG:2203', 'EPSG:2204',
  'EPSG:32618', 'EPSG:32619', 'EPSG:32620', 'EPSG:32621',
  'EPSG:24818', 'EPSG:24819', 'EPSG:24820', 'EPSG:24821',
  'EPSG:24878', 'EPSG:24879', 'EPSG:24880', 'EPSG:24881',
];
VENEZUELA_UTM_CODES.forEach((code) => {
  getProjection(code)?.setExtent([160000, 0, 840000, 1800000]);
});

// Centro por defecto: Venezuela central (~Caracas)
const CENTRO_VENEZUELA_UTM: Coordinate = [625000, 1160000];

// ── Cache Acotada de Estilos Globales de Capa ────────────────────────────────
const MAX_STYLE_CACHE_SIZE = 200;
const styleCache: Record<string, Style> = {};
let styleCacheCount = 0;

function getCachedStyle(key: string, createFn: () => Style): Style {
  const existing = styleCache[key];
  if (existing) return existing;
  if (styleCacheCount >= MAX_STYLE_CACHE_SIZE) {
    const keys = Object.keys(styleCache);
    for (let i = 0; i < 40; i++) {
      if (keys[i]) delete styleCache[keys[i]];
    }
    styleCacheCount = Object.keys(styleCache).length;
  }
  const created = createFn();
  styleCache[key] = created;
  styleCacheCount++;
  return created;
}

// ── Estilos Globales Pre-Instanciados para Vértices (SIN Etiquetas de Texto) ─
const VERTEX_STYLE_NORMAL = new Style({
  image: new CircleStyle({
    radius: 3.5,
    fill: new Fill({ color: '#ffffff' }),
    stroke: new Stroke({ color: '#0f172a', width: 1.5 }),
  }),
});

const VERTEX_STYLE_SELECTED = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: '#38bdf8' }),
    stroke: new Stroke({ color: '#ffffff', width: 2.0 }),
  }),
});

const VERTEX_STYLE_MOVABLE = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: '#f59e0b' }),
    stroke: new Stroke({ color: '#ffffff', width: 2.0 }),
  }),
});

interface MapViewerProps {
  className?: string;
}

// ─── Utilidad: Calcular Área Plana (Shoelace) en m² desde resultados UTM ────
function calculatePlanarAreaM2(pts: TransformationResult[]): number {
  const validCoords: [number, number][] = [];
  for (const p of pts) {
    const e = p.result?.este ?? p.input?.este;
    const n = p.result?.norte ?? p.input?.norte;
    if (typeof e === 'number' && typeof n === 'number' && !isNaN(e) && !isNaN(n)) {
      validCoords.push([e, n]);
    }
  }
  if (validCoords.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < validCoords.length; i++) {
    const [x1, y1] = validCoords[i];
    const [x2, y2] = validCoords[(i + 1) % validCoords.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// ─── Utilidad: Extraer coordenadas re-proyectadas a EPSG:3857 ────────────────
function extractCoord3857(
  r: TransformationResult,
  defaultHuso: number = 19,
  defaultDirection?: string
): Coordinate | null {
  if (!r) return null;

  // Resolver huso de forma segura: result.huso -> input.huso -> deducción por longitud -> defaultHuso
  const candidateHuso =
    r.result?.huso ??
    r.input?.huso ??
    (typeof r.result?.lng === 'number' && !isNaN(r.result.lng) && r.result.lng !== 0
      ? Math.floor((r.result.lng + 180) / 6) + 1
      : defaultHuso);
  const ptHuso = [18, 19, 20, 21].includes(Number(candidateHuso)) ? Number(candidateHuso) : 19;

  // Determinar si la coordenada de salida o entrada pertenece a La Canoa (PSAD56)
  const dir = r.direction ?? r.result?.direction ?? defaultDirection;
  const isResultCanoa = dir === 'regven_canoa';
  const isInputCanoa = dir === 'canoa_regven';

  const epsgResultUtm = isResultCanoa ? `EPSG:248${ptHuso}` : `EPSG:220${ptHuso - 17}`;
  const epsgInputUtm = isInputCanoa ? `EPSG:248${ptHuso}` : `EPSG:220${ptHuso - 17}`;

  // 1. Priorizar coordenadas métricas planas UTM [este, norte] de salida (precisión sub-milimétrica)
  if (
    r.result &&
    typeof r.result.este === 'number' && !isNaN(r.result.este) &&
    typeof r.result.norte === 'number' && !isNaN(r.result.norte) &&
    (r.result.este > 1000 || r.result.norte > 1000)
  ) {
    try {
      return transform([r.result.este, r.result.norte], epsgResultUtm, 'EPSG:3857');
    } catch {
      // Fallback
    }
  }

  // 2. Coordenadas métricas planas UTM [este, norte] de entrada
  if (
    r.input &&
    typeof r.input.este === 'number' && !isNaN(r.input.este) &&
    typeof r.input.norte === 'number' && !isNaN(r.input.norte) &&
    (r.input.este > 1000 || r.input.norte > 1000)
  ) {
    try {
      return transform([r.input.este, r.input.norte], epsgInputUtm, 'EPSG:3857');
    } catch {
      // Fallback
    }
  }

  // 3. Fallback a geográficas [lng, lat] de salida
  if (
    r.result &&
    typeof r.result.lat === 'number' && !isNaN(r.result.lat) &&
    typeof r.result.lng === 'number' && !isNaN(r.result.lng) &&
    Math.abs(r.result.lat) <= 90 && Math.abs(r.result.lng) <= 180 &&
    (r.result.lat !== 0 || r.result.lng !== 0)
  ) {
    try {
      return transform([r.result.lng, r.result.lat], 'EPSG:4326', 'EPSG:3857');
    } catch {
      // Fallback
    }
  }

  // 4. Fallback a geográficas [lng, lat] de entrada
  if (
    r.input &&
    typeof r.input.lat === 'number' && !isNaN(r.input.lat) &&
    typeof r.input.lng === 'number' && !isNaN(r.input.lng) &&
    Math.abs(r.input.lat) <= 90 && Math.abs(r.input.lng) <= 180 &&
    (r.input.lat !== 0 || r.input.lng !== 0)
  ) {
    try {
      return transform([r.input.lng, r.input.lat], 'EPSG:4326', 'EPSG:3857');
    } catch {
      // Fallback
    }
  }

  return null;
}

export default function MapViewer({ className }: MapViewerProps) {
  // ── Referencias DOM ────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // ── Referencias OpenLayers ─────────────────────────────────────────────────
  const mapRef = useRef<Map | null>(null);

  // Fuentes vectoriales independientes
  const parcelsSourceRef = useRef<VectorSource>(new VectorSource());
  const activeSourceRef = useRef<VectorSource>(new VectorSource());
  const verticesSourceRef = useRef<VectorSource>(new VectorSource());
  const drawSourceRef = useRef<VectorSource>(new VectorSource());

  // Referencia al feature MultiPoint activo para no reconstruir vértices guardados
  const activeVtxFeatureRef = useRef<Feature | null>(null);

  // Capas vectoriales
  const parcelsLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const activeLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const verticesLayerRef = useRef<VectorLayer<VectorSource> | null>(null);

  // Capas de teselas
  const streetsLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const satelliteLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const esriLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const roadsLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const placesLayerRef = useRef<TileLayer<XYZ> | null>(null);

  // Interacciones
  const drawInteractionRef = useRef<Draw | null>(null);
  const translateInteractionRef = useRef<Translate | null>(null);

  const hasInitialFitRef = useRef<boolean>(false);
  const prevParcelsCountRef = useRef<number>(0);

  // ── HUD de Coordenadas (0 Re-renders de React en mousemove) ─────────────────
  const esteRef = useRef<HTMLSpanElement>(null);
  const norteRef = useRef<HTMLSpanElement>(null);
  const pointerRafRef = useRef<number | null>(null);
  const lastHitTestTimeRef = useRef<number>(0);

  // ── Estados locales de UI ──────────────────────────────────────────────────
  const [isDrawing, setIsDrawing] = useState(false);
  const [mapTool, setMapTool] = useState<'select' | 'move'>('select');
  const [lastDrawnUTM, setLastDrawnUTM] = useState<[number, number][] | null>(null);
  const [showRoads, setShowRoads] = useState<boolean>(true);
  const [showPlaces, setShowPlaces] = useState<boolean>(false);
  const [labelSizeOffset, setLabelSizeOffset] = useState<number>(0);
  const [showMovePanel, setShowMovePanel] = useState<boolean>(false);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [satOffset, setSatOffset] = useState<{ dE: number; dN: number }>({ dE: 0, dN: 0 });
  const [showSatCalib, setShowSatCalib] = useState<boolean>(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState<boolean>(false);
  const [calibStep, setCalibStep] = useState<'off' | 'vertex' | 'photo'>('off');
  const [calibRealUTM, setCalibRealUTM] = useState<{ e: number; n: number } | null>(null);

  // ── Subscripción a useAppStore ─────────────────────────────────────────────
  const savedParcels = useAppStore((s) => s.savedParcels);
  const results = useAppStore((s) => s.results);
  const direction = useAppStore((s) => s.direction);
  const routine = useAppStore((s) => s.routine);
  const method = useAppStore((s) => s.method);
  const geometryType = useAppStore((s) => s.geometryType);
  const hatchColor = useAppStore((s) => s.hatchColor);
  const hatchOpacity = useAppStore((s) => s.hatchOpacity);
  const viewTarget = useAppStore((s) => s.viewTarget);
  const dxfPreview = useAppStore((s) => s.dxfPreview);
  const projectMeta = useAppStore((s) => s.projectMeta);
  const mapType = useAppStore((s) => s.mapType);
  const setMapType = useAppStore((s) => s.setMapType);
  const huso = useAppStore((s) => s.huso);
  const user = useAppStore((s) => s.user);
  const isDemo = Boolean(user?.rol) && isDemoRole(user?.rol);
  const canUseSatellite = user
    ? hasPermission(user.rol, 'satellite_imagery', (user as any)?.roleConfig?.capabilities)
    : true;

  const activeParcelId = useAppStore((s) => s.activeParcelId);
  const movableParcelIds = useAppStore((s) => s.movableParcelIds);
  const toggleParcelMovement = useAppStore((s) => s.toggleParcelMovement);
  const clearAllParcelMovement = useAppStore((s) => s.clearAllParcelMovement);
  const moveParcel = useAppStore((s) => s.moveParcel);
  const viewParcelResults = useAppStore((s) => s.viewParcelResults);
  const centerOnParcel = useAppStore((s) => s.centerOnParcel);

  // Capa base de Zustand
  const baseLayer = useMapStore((s) => s.baseLayer);
  const toggleBaseLayer = useMapStore((s) => s.toggleBaseLayer);

  const effectiveDirection: string =
    routine === 'ploteo' || method === 'rigida02' ? 'canoa_regven' : direction;

  // ── Refs reactivas para evitar recrear listeners o interacciones ────────────
  const husoRef = useRef<number>(huso);
  useEffect(() => { husoRef.current = huso; }, [huso]);

  const effectiveDirectionRef = useRef(effectiveDirection);
  useEffect(() => { effectiveDirectionRef.current = effectiveDirection; }, [effectiveDirection]);

  const mapToolRef = useRef(mapTool);
  useEffect(() => { mapToolRef.current = mapTool; }, [mapTool]);

  const movableParcelIdsRef = useRef(movableParcelIds);
  useEffect(() => { movableParcelIdsRef.current = movableParcelIds; }, [movableParcelIds]);

  const selectedParcelIdRef = useRef(selectedParcelId);
  useEffect(() => { selectedParcelIdRef.current = selectedParcelId; }, [selectedParcelId]);

  const activeParcelIdRef = useRef(activeParcelId);
  useEffect(() => { activeParcelIdRef.current = activeParcelId; }, [activeParcelId]);

  const labelSizeOffsetRef = useRef(labelSizeOffset);
  useEffect(() => { labelSizeOffsetRef.current = labelSizeOffset; }, [labelSizeOffset]);

  const hatchColorRef = useRef(hatchColor);
  useEffect(() => { hatchColorRef.current = hatchColor; }, [hatchColor]);

  const hatchOpacityRef = useRef(hatchOpacity);
  useEffect(() => { hatchOpacityRef.current = hatchOpacity; }, [hatchOpacity]);

  const isDrawingRef = useRef(isDrawing);
  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);

  const savedParcelsRef = useRef(savedParcels);
  useEffect(() => { savedParcelsRef.current = savedParcels; }, [savedParcels]);

  const resultsRef = useRef(results);
  useEffect(() => { resultsRef.current = results; }, [results]);

  const resultsLengthRef = useRef(results.length);
  useEffect(() => { resultsLengthRef.current = results.length; }, [results.length]);

  const moveParcelRef = useRef(moveParcel);
  useEffect(() => { moveParcelRef.current = moveParcel; }, [moveParcel]);

  const viewParcelResultsRef = useRef(viewParcelResults);
  useEffect(() => { viewParcelResultsRef.current = viewParcelResults; }, [viewParcelResults]);

  const calibStepRef = useRef(calibStep);
  useEffect(() => { calibStepRef.current = calibStep; }, [calibStep]);

  const calibRealUTMRef = useRef(calibRealUTM);
  useEffect(() => { calibRealUTMRef.current = calibRealUTM; }, [calibRealUTM]);

  const satOffsetRef = useRef(satOffset);
  useEffect(() => {
    satOffsetRef.current = satOffset;
    useContourStore.getState().setSatOffset(satOffset);
    satelliteLayerRef.current?.changed();
    esriLayerRef.current?.changed();
    roadsLayerRef.current?.changed();
    placesLayerRef.current?.changed();
    mapRef.current?.render();
  }, [satOffset]);

  // ───────────────────────────────────────────────────────────────────────────
  // Funciones Globales de Estilo a Nivel de Capa (Reutilización de Estilos & 60 FPS)
  // ───────────────────────────────────────────────────────────────────────────

  const parcelsLayerStyle = useCallback((feature: FeatureLike, resolution: number): Style => {
    const isDxf = feature.get('isDxf') === true;
    if (isDxf) {
      const dxfColor = String(feature.get('dxfColor') || '#f43f5e');
      const dxfLayer = String(feature.get('dxfLayer') || '');
      const dxfGeomType = feature.get('geometryType') || 'cerrada';
      const showDxfLbl = resolution <= 25.0 && dxfLayer.length > 0 && dxfLayer !== '0';
      const hexD = dxfColor.replace('#', '');
      const dr = parseInt(hexD.substring(0, 2), 16) || 244;
      const dg = parseInt(hexD.substring(2, 4), 16) || 63;
      const db = parseInt(hexD.substring(4, 6), 16) || 94;
      return getCachedStyle(`dxf-${dxfColor}-${dxfGeomType}-${showDxfLbl ? dxfLayer : 'nolbl'}`, () => new Style({
        stroke: new Stroke({ color: dxfColor, width: 2.2, lineDash: [6, 4] }),
        fill: dxfGeomType === 'cerrada' ? new Fill({ color: `rgba(${dr}, ${dg}, ${db}, 0.16)` }) : undefined,
        text: showDxfLbl
          ? new Text({
              text: dxfLayer,
              font: '600 10px Inter, sans-serif',
              fill: new Fill({ color: dxfColor }),
              stroke: new Stroke({ color: '#020617', width: 3 }),
              overflow: true,
            })
          : undefined,
      }));
    }

    const parcel = feature.get('parcelData') as Parcel | undefined;
    const pid = feature.get('parcelId') as string;
    const geomType = feature.get('geometryType') || 'cerrada';

    const isSelected = selectedParcelIdRef.current === pid || activeParcelIdRef.current === pid;
    const isMovable = mapToolRef.current === 'move' || movableParcelIdsRef.current.includes(pid);

    const baseColor = parcel?.hatchColor || hatchColorRef.current || '#ffff00';
    const baseOpacity = parcel?.hatchOpacity ?? hatchOpacityRef.current ?? 0.22;
    const effectiveOpacity = isSelected ? Math.min(0.65, baseOpacity + 0.18) : baseOpacity;

    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) || 255;
    const g = parseInt(hex.substring(2, 4), 16) || 255;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    const rgbaFill = `rgba(${r}, ${g}, ${b}, ${effectiveOpacity})`;

    let strokeColor = '#ffffff';
    let strokeWidth = 2.2;
    let strokeDash: number[] | undefined = undefined;

    if (isMovable) {
      strokeColor = '#f59e0b';
      strokeWidth = isSelected ? 4 : 3;
      strokeDash = [8, 4];
    } else if (isSelected) {
      strokeColor = '#38bdf8';
      strokeWidth = 3.5;
    }

    if (geomType === 'abierta') {
      const lineKey = `line-${strokeColor}-${strokeWidth}-${isMovable ? 'mov' : '0'}`;
      return getCachedStyle(lineKey, () => new Style({
        stroke: new Stroke({ color: strokeColor, width: strokeWidth + 0.5, lineDash: strokeDash }),
      }));
    }

    // Solo mostrar etiqueta de Parcela (Nombre y Área en m²) en escalas apropiadas
    const showLabel = resolution <= 35.0 || isSelected;
    const baseFontSize = resolution <= 15.0 ? 11 : 10;
    const computedFontSize = Math.max(7, Math.min(22, baseFontSize + labelSizeOffsetRef.current));

    // Cache global por apariencia visual (reutilizado entre parcelas)
    const styleKey = `poly-style-${rgbaFill}-${strokeColor}-${strokeWidth}-${isMovable ? 'mov' : '0'}-${showLabel ? computedFontSize : 'nolbl'}`;
    const style = getCachedStyle(styleKey, () => new Style({
      fill: new Fill({ color: rgbaFill }),
      stroke: new Stroke({
        color: strokeColor,
        width: strokeWidth,
        lineDash: strokeDash,
        lineCap: 'round',
        lineJoin: 'round',
      }),
      text: showLabel
        ? new Text({
            text: '',
            font: `bold ${computedFontSize}px system-ui, -apple-system, sans-serif`,
            fill: new Fill({ color: '#ffffff' }),
            stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.92)', width: computedFontSize > 12 ? 3.2 : 2.5 }),
            textAlign: 'center',
            overflow: false,
          })
        : undefined,
    }));

    // Asignar únicamente Nombre de Parcela y Área en m²
    if (showLabel) {
      const textObj = style.getText();
      if (textObj) {
        const nombre = parcel?.nombre || 'Parcela';
        const areaStr = parcel?.area != null && parcel.area > 0 ? `${parcel.area.toFixed(2)} m²` : '';
        textObj.setText(areaStr ? `${nombre}\n${areaStr}` : nombre);
      }
    }

    return style;
  }, []);

  const activeLayerStyle = useCallback((feature: FeatureLike): Style => {
    const pid = feature.get('parcelId') as string;
    const isMovable = mapToolRef.current === 'move' || movableParcelIdsRef.current.includes(pid);
    const geomType = feature.get('geometryType') || 'cerrada';
    const computedActiveSize = Math.max(7, Math.min(22, 11 + labelSizeOffsetRef.current));

    if (geomType === 'abierta') {
      const lineKey = `active-line-${isMovable ? 'mov' : 'std'}`;
      return getCachedStyle(lineKey, () => new Style({
        stroke: new Stroke({ color: isMovable ? '#f59e0b' : '#38bdf8', width: 3.2, lineDash: [8, 4] }),
      }));
    }

    const polyKey = `active-poly-${isMovable ? 'mov' : 'std'}-${computedActiveSize}`;
    const style = getCachedStyle(polyKey, () => new Style({
      fill: new Fill({ color: isMovable ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.28)' }),
      stroke: new Stroke({
        color: isMovable ? '#f59e0b' : '#38bdf8',
        width: 3.5,
        lineDash: [8, 4],
      }),
      text: new Text({
        text: '',
        font: `bold ${computedActiveSize}px system-ui, sans-serif`,
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: '#000000', width: 3.0 }),
        textAlign: 'center',
        overflow: false,
      }),
    }));

    // Solo mostrar Nombre de Parcela y Área en m²
    const textObj = style.getText();
    if (textObj) {
      const parcelName = (feature.get('parcelName') as string) || 'Parcela Activa';
      const areaM2 = feature.get('areaM2') as number | undefined;
      const areaStr = typeof areaM2 === 'number' && areaM2 > 0 ? `${areaM2.toFixed(2)} m²` : '';
      textObj.setText(areaStr ? `${parcelName}\n${areaStr}` : parcelName);
    }

    return style;
  }, []);

  // Estilo de Vértices: 100% libre de etiquetas de texto (P1..Pn eliminados para máximos FPS)
  const verticesLayerStyle = useCallback((feature: FeatureLike, resolution: number): Style | undefined => {
    const pid = feature.get('parcelId') as string;
    const isSelected = selectedParcelIdRef.current === pid || activeParcelIdRef.current === pid;
    const isMovable = mapToolRef.current === 'move' || movableParcelIdsRef.current.includes(pid);

    // Ocultar puntos de vértices en escalas muy lejanas si la parcela no está seleccionada
    if (resolution > 30.0 && !isSelected && !isMovable) {
      return undefined;
    }

    if (isMovable) return VERTEX_STYLE_MOVABLE;
    if (isSelected) return VERTEX_STYLE_SELECTED;
    return VERTEX_STYLE_NORMAL;
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // Inicialización Única del Mapa (Ciclo de Vida en useRef)
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const centroMercator = transform(CENTRO_VENEZUELA_UTM, 'EPSG:32619', 'EPSG:3857');

    // Capa base Callejero Google optimizada (preload: 1, cacheSize: 512)
    const streetsLayer = new TileLayer({
      source: new XYZ({
        urls: [
          'https://mt0.google.com/vt/lyrs=m&hl=es&x={x}&y={y}&z={z}',
          'https://mt1.google.com/vt/lyrs=m&hl=es&x={x}&y={y}&z={z}',
          'https://mt2.google.com/vt/lyrs=m&hl=es&x={x}&y={y}&z={z}',
          'https://mt3.google.com/vt/lyrs=m&hl=es&x={x}&y={y}&z={z}',
        ],
        maxZoom: 21,
        crossOrigin: 'anonymous',
        cacheSize: 512,
        transition: 0,
      }),
      preload: 1,
      visible: baseLayer === 'streets',
      properties: { name: 'streets' },
    });

    // Capa base Satelital Pura Google optimizada (maxZoom: 20 nativo + interpolate: true + transition: 0 para super-zoom hasta z24)
    const satelliteLayer = new TileLayer({
      source: new XYZ({
        urls: [
          'https://mt0.google.com/vt/lyrs=s&hl=es&x={x}&y={y}&z={z}',
          'https://mt1.google.com/vt/lyrs=s&hl=es&x={x}&y={y}&z={z}',
          'https://mt2.google.com/vt/lyrs=s&hl=es&x={x}&y={y}&z={z}',
          'https://mt3.google.com/vt/lyrs=s&hl=es&x={x}&y={y}&z={z}',
        ],
        maxZoom: 20,
        interpolate: true,
        crossOrigin: 'anonymous',
        cacheSize: 512,
        transition: 0,
      }),
      preload: 1,
      visible: baseLayer === 'satellite' || baseLayer === 'hybrid',
      properties: { name: 'satellite' },
    });

    // Capa base Satelital Alternativa Esri World Imagery (maxZoom: 18 + interpolate: true para super-zoom hasta z24 sin teselas grises en Venezuela)
    const esriSatelliteLayer = new TileLayer({
      source: new XYZ({
        urls: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        maxZoom: 18,
        interpolate: true,
        crossOrigin: 'anonymous',
        cacheSize: 512,
        transition: 0,
      }),
      preload: 1,
      visible: baseLayer === 'esri',
      properties: { name: 'esri' },
    });

    // Capa overlay de Calles Google
    const roadsLayer = new TileLayer({
      source: new XYZ({
        urls: [
          'https://mt0.google.com/vt/lyrs=h&hl=es&apistyle=s.t:2%7Cp.v:off&x={x}&y={y}&z={z}',
          'https://mt1.google.com/vt/lyrs=h&hl=es&apistyle=s.t:2%7Cp.v:off&x={x}&y={y}&z={z}',
          'https://mt2.google.com/vt/lyrs=h&hl=es&apistyle=s.t:2%7Cp.v:off&x={x}&y={y}&z={z}',
          'https://mt3.google.com/vt/lyrs=h&hl=es&apistyle=s.t:2%7Cp.v:off&x={x}&y={y}&z={z}',
        ],
        maxZoom: 20,
        interpolate: true,
        crossOrigin: 'anonymous',
        cacheSize: 256,
        transition: 0,
      }),
      preload: 0,
      visible: baseLayer === 'hybrid' || (baseLayer !== 'streets' && showRoads),
      properties: { name: 'roads' },
    });

    // Capa overlay de Sitios de Interés Google
    const placesLayer = new TileLayer({
      source: new XYZ({
        urls: [
          'https://mt0.google.com/vt/lyrs=h&hl=es&apistyle=s.t:3%7Cp.v:off&x={x}&y={y}&z={z}',
          'https://mt1.google.com/vt/lyrs=h&hl=es&apistyle=s.t:3%7Cp.v:off&x={x}&y={y}&z={z}',
          'https://mt2.google.com/vt/lyrs=h&hl=es&apistyle=s.t:3%7Cp.v:off&x={x}&y={y}&z={z}',
          'https://mt3.google.com/vt/lyrs=h&hl=es&apistyle=s.t:3%7Cp.v:off&x={x}&y={y}&z={z}',
        ],
        maxZoom: 20,
        interpolate: true,
        crossOrigin: 'anonymous',
        cacheSize: 256,
        transition: 0,
      }),
      preload: 0,
      visible: baseLayer !== 'streets' && showPlaces,
      properties: { name: 'places' },
    });

    // ── Capas Vectoriales Optimizadas (60 FPS durante Pan/Zoom) ──────────────
    const parcelsLayer = new VectorLayer({
      source: parcelsSourceRef.current,
      renderBuffer: 128,
      declutter: true,
      updateWhileAnimating: false,
      updateWhileInteracting: false,
      style: parcelsLayerStyle,
    });

    const activeLayer = new VectorLayer({
      source: activeSourceRef.current,
      renderBuffer: 128,
      declutter: true,
      updateWhileAnimating: false,
      updateWhileInteracting: false,
      style: activeLayerStyle,
    });

    const verticesLayer = new VectorLayer({
      source: verticesSourceRef.current,
      renderBuffer: 128,
      updateWhileAnimating: false,
      updateWhileInteracting: false,
      style: verticesLayerStyle,
    });

    const drawLayer = new VectorLayer({
      source: drawSourceRef.current,
      updateWhileAnimating: false,
      updateWhileInteracting: true,
      style: new Style({
        fill: new Fill({ color: 'rgba(255, 165, 0, 0.25)' }),
        stroke: new Stroke({ color: '#ff6600', width: 2.5, lineDash: [6, 4] }),
      }),
    });

    const view = new View({
      center: centroMercator,
      zoom: 7,
      minZoom: 3,
      maxZoom: 24,
      projection: 'EPSG:3857',
      enableRotation: false,
      smoothResolutionConstraint: true,
      constrainResolution: false,
      smoothExtentConstraint: true,
    });

    // ── Calibración Visual de Imagen Satelital Blindada (WeakMap simétrico save/restore) ──
    const savedLayerState = new WeakMap<object, boolean>();

    const handleSatPrerender = (evt: RenderEvent) => {
      const targetKey = (evt.target as object) || evt;
      const { dE, dN } = satOffsetRef.current;
      if (dE === 0 && dN === 0) {
        savedLayerState.set(targetKey, false);
        return;
      }
      const ctx = evt.context as CanvasRenderingContext2D | undefined;
      if (!ctx) {
        savedLayerState.set(targetKey, false);
        return;
      }
      const resolution = evt.frameState?.viewState.resolution ?? view.getResolution() ?? 1;
      const pixelRatio = evt.frameState?.pixelRatio ?? 1;
      const dxPx = (dE / resolution) * pixelRatio;
      const dyPx = (-dN / resolution) * pixelRatio;
      ctx.save();
      ctx.translate(dxPx, dyPx);
      savedLayerState.set(targetKey, true);
    };

    const handleSatPostrender = (evt: RenderEvent) => {
      const targetKey = (evt.target as object) || evt;
      if (!savedLayerState.get(targetKey)) return;
      savedLayerState.set(targetKey, false);
      const ctx = evt.context as CanvasRenderingContext2D | undefined;
      if (!ctx) return;
      ctx.restore();
    };

    [satelliteLayer, esriSatelliteLayer, roadsLayer, placesLayer].forEach((layer) => {
      layer.on('prerender', handleSatPrerender);
      layer.on('postrender', handleSatPostrender);
    });

    const map = new Map({
      target: mapContainerRef.current,
      layers: [
        streetsLayer,
        satelliteLayer,
        esriSatelliteLayer,
        roadsLayer,
        placesLayer,
        parcelsLayer,
        activeLayer,
        verticesLayer,
        drawLayer,
      ],
      overlays: [],
      view,
      controls: [],
      interactions: defaultInteractions({
        mouseWheelZoom: false,
        altShiftDragRotate: false,
        pinchRotate: false,
      }).extend([
        new MouseWheelZoom({
          duration: 200,
          useAnchor: true,
        }),
      ]),
    });

    // ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      map.updateSize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }
    setTimeout(() => map.updateSize(), 150);

    // ── Único Listener pointermove Unificado (Coordenadas + Hit-Test con Throttle) ──
    map.on('pointermove', (evt) => {
      if (evt.dragging || map.getView().getAnimating() || map.getView().getInteracting()) return;
      if (pointerRafRef.current) cancelAnimationFrame(pointerRafRef.current);

      pointerRafRef.current = requestAnimationFrame((now) => {
        // 1. Actualizar HUD de coordenadas (0 Re-renders React)
        const currentHuso = [18, 19, 20, 21].includes(Number(husoRef.current)) ? Number(husoRef.current) : 19;
        const targetEpsg = `EPSG:220${currentHuso - 17}`;
        try {
          const utmCoord = transform(evt.coordinate, 'EPSG:3857', targetEpsg);
          if (esteRef.current && isFinite(utmCoord[0])) {
            esteRef.current.textContent = `E ${utmCoord[0].toFixed(1)} m`;
          }
          if (norteRef.current && isFinite(utmCoord[1])) {
            norteRef.current.textContent = `N ${utmCoord[1].toFixed(1)} m`;
          }
        } catch {
          // Fallback
        }

        // 2. Hit-test de cursor limitado a ~12 veces por segundo (cada 80ms) para liberar CPU
        if (now - lastHitTestTimeRef.current < 80) return;
        lastHitTestTimeRef.current = now;

        const el = map.getTargetElement() as HTMLElement | null;
        if (!el) return;

        if (calibStepRef.current !== 'off') {
          el.style.cursor = 'crosshair';
          return;
        }

        let hoveredPid: string | null = null;
        map.forEachFeatureAtPixel(
          evt.pixel,
          (feature) => {
            const pid = (feature as Feature).get('parcelId') as string | undefined;
            if (pid && !hoveredPid) hoveredPid = pid;
          },
          {
            hitTolerance: 6,
            layerFilter: (l) => l === parcelsLayer || l === activeLayer,
          }
        );

        if (hoveredPid) {
          const isMovable = mapToolRef.current === 'move' || movableParcelIdsRef.current.includes(hoveredPid);
          el.style.cursor = isMovable ? 'grab' : 'pointer';
        } else {
          el.style.cursor = mapToolRef.current === 'move' ? 'grab' : '';
        }
      });
    });

    // ── Interacción Translate Única y Estable mediante Refs ──────────────────
    const translateInteraction = new Translate({
      layers: [parcelsLayer, activeLayer],
      filter: (feature) => {
        if (calibStepRef.current !== 'off') return false;
        const pid = feature.get('parcelId') as string | undefined;
        if (!pid) return false;
        return mapToolRef.current === 'move' || movableParcelIdsRef.current.includes(pid);
      },
      hitTolerance: 8,
    });

    translateInteraction.on('translatestart', () => {
      const el = map.getTargetElement() as HTMLElement | null;
      if (el) el.style.cursor = 'grabbing';
    });

    translateInteraction.on('translating', () => {
      const el = map.getTargetElement() as HTMLElement | null;
      if (el) el.style.cursor = 'grabbing';
    });

    translateInteraction.on('translateend', (evt: TranslateEvent) => {
      const el = map.getTargetElement() as HTMLElement | null;
      if (el) el.style.cursor = mapToolRef.current === 'move' ? 'grab' : '';

      const startCoord3857 = evt.startCoordinate;
      const endCoord3857 = evt.coordinate;
      if (!startCoord3857 || !endCoord3857) return;

      // Priorizar el huso propio de la parcela antes que husoRef.current
      let parcelHuso: number | undefined;
      evt.features.forEach((f) => {
        if (parcelHuso) return;
        const pData = (f as Feature).get('parcelData') as Parcel | undefined;
        const h = pData?.puntos?.[0]?.result?.huso ?? pData?.puntos?.[0]?.input?.huso;
        if ([18, 19, 20, 21].includes(Number(h))) {
          parcelHuso = Number(h);
        }
      });

      const fallbackHuso = [18, 19, 20, 21].includes(Number(husoRef.current)) ? Number(husoRef.current) : 19;
      const effectiveHuso = parcelHuso ?? fallbackHuso;
      const targetEpsg = `EPSG:220${effectiveHuso - 17}`;

      const startUTM = transform(startCoord3857, 'EPSG:3857', targetEpsg);
      const endUTM = transform(endCoord3857, 'EPSG:3857', targetEpsg);
      const dEste = endUTM[0] - startUTM[0];
      const dNorte = endUTM[1] - startUTM[1];

      const startLonLat = transform(startCoord3857, 'EPSG:3857', 'EPSG:4326');
      const endLonLat = transform(endCoord3857, 'EPSG:3857', 'EPSG:4326');
      const dLat = endLonLat[1] - startLonLat[1];
      const dLng = endLonLat[0] - startLonLat[0];

      const affectedIds = new Set<string>();
      evt.features.forEach((f) => {
        const pid = (f as Feature).get('parcelId') as string | undefined;
        if (pid) affectedIds.add(pid);
      });

      affectedIds.forEach((pid) => {
        moveParcelRef.current(pid, dLat, dLng, dEste, dNorte);
      });

      const signoE = dEste >= 0 ? '+' : '';
      const signoN = dNorte >= 0 ? '+' : '';
      toast.success(
        `Parcela trasladada: ΔE ${signoE}${dEste.toFixed(2)}m  ΔN ${signoN}${dNorte.toFixed(2)}m`,
        { duration: 3500, id: 'parcel-moved' }
      );
    });

    map.addInteraction(translateInteraction);
    translateInteractionRef.current = translateInteraction;

    // ── Selección por Clic Única y Estable + Herramienta "Amarrar con Punto" ─
    map.on('singleclick', (evt) => {
      if (isDrawingRef.current) return;
      // Con una herramienta de medición activa, el clic mide (no selecciona parcelas)
      if (useMeasureStore.getState().mode !== 'off') return;

      // ── Modo Interactivo de 2 Clics: "Amarrar con Punto" ───────────────────
      if (calibStepRef.current !== 'off') {
        const currentHuso = [18, 19, 20, 21].includes(Number(husoRef.current)) ? Number(husoRef.current) : 19;
        const targetEpsg = `EPSG:220${currentHuso - 17}`;

        if (calibStepRef.current === 'vertex') {
          // Intentar enganchar (snap) al vértice más cercano en un radio de 18 píxeles
          let bestDistPx = 18;
          let snappedUTM: { e: number; n: number } | null = null;

          const allPts: TransformationResult[] = [
            ...resultsRef.current,
            ...savedParcelsRef.current.flatMap((p) => p.puntos || []),
          ];

          for (const pt of allPts) {
            const c3857 = extractCoord3857(pt, currentHuso, effectiveDirectionRef.current);
            if (!c3857) continue;
            const px = map.getPixelFromCoordinate(c3857);
            if (!px) continue;
            const dPx = Math.hypot(px[0] - evt.pixel[0], px[1] - evt.pixel[1]);
            if (dPx < bestDistPx) {
              bestDistPx = dPx;
              const utm = transform(c3857, 'EPSG:3857', targetEpsg);
              snappedUTM = { e: utm[0], n: utm[1] };
            }
          }

          if (!snappedUTM) {
            const clickedUTM = transform(evt.coordinate, 'EPSG:3857', targetEpsg);
            snappedUTM = { e: clickedUTM[0], n: clickedUTM[1] };
          }

          setCalibRealUTM(snappedUTM);
          setCalibStep('photo');
          toast('Paso 2/2: Ahora haz clic sobre ese mismo rincón visible en la foto satelital', {
            icon: '🎯',
            id: 'calib-step-toast',
            duration: 4500,
          });
          return;
        }

        if (calibStepRef.current === 'photo' && calibRealUTMRef.current) {
          const fotoUTM = transform(evt.coordinate, 'EPSG:3857', targetEpsg);
          const E_real = calibRealUTMRef.current.e;
          const N_real = calibRealUTMRef.current.n;
          const E_foto = fotoUTM[0];
          const N_foto = fotoUTM[1];

          const nextDE = Number((satOffsetRef.current.dE + (E_real - E_foto)).toFixed(2));
          const nextDN = Number((satOffsetRef.current.dN + (N_real - N_foto)).toFixed(2));

          setSatOffset({ dE: nextDE, dN: nextDN });
          setCalibStep('off');
          setCalibRealUTM(null);

          const sE = nextDE >= 0 ? '+' : '';
          const sN = nextDN >= 0 ? '+' : '';
          toast.success(
            `Foto satelital amarrada al vértice: ΔE ${sE}${nextDE.toFixed(2)}m · ΔN ${sN}${nextDN.toFixed(2)}m`,
            { id: 'calib-step-toast', duration: 4000 }
          );
          return;
        }
      }

      let foundPid: string | null = null;
      map.forEachFeatureAtPixel(
        evt.pixel,
        (feature) => {
          const pid = (feature as Feature).get('parcelId') as string | undefined;
          if (pid && !foundPid) foundPid = pid;
        },
        {
          hitTolerance: 8,
          layerFilter: (l) => l === parcelsLayer || l === activeLayer || l === verticesLayer,
        }
      );

      if (foundPid) {
        setSelectedParcelId(foundPid);
        if (foundPid !== 'active') {
          viewParcelResultsRef.current(foundPid);
        }
        const p = savedParcelsRef.current.find((item) => item.id === foundPid);
        const name = p?.nombre || (foundPid === 'active' ? 'Parcela activa' : 'Parcela');
        toast(`Parcela seleccionada: ${name}`, {
          icon: '📍',
          id: 'select-toast',
          duration: 2500,
        });
      } else {
        setSelectedParcelId(null);
      }
    });

    // ── Herramienta Draw Interactiva ─────────────────────────────────────────
    const drawInteraction = new Draw({ source: drawSourceRef.current, type: 'Polygon' });
    drawInteraction.on('drawend', (evt: DrawEvent) => {
      const geom = evt.feature.getGeometry() as Polygon;
      const coords3857 = geom.getCoordinates()[0];
      const currentHuso = [18, 19, 20, 21].includes(Number(husoRef.current)) ? Number(husoRef.current) : 19;
      const targetEpsg = `EPSG:220${currentHuso - 17}`;
      const rawRingUTM = coords3857.map((coord) => {
        const utm = transform(coord, 'EPSG:3857', targetEpsg);
        return { x: utm[0], y: utm[1] };
      });
      const ringNoRepeat =
        rawRingUTM.length > 1 &&
        Math.hypot(rawRingUTM[0].x - rawRingUTM[rawRingUTM.length - 1].x, rawRingUTM[0].y - rawRingUTM[rawRingUTM.length - 1].y) < 1e-3
          ? rawRingUTM.slice(0, -1)
          : rawRingUTM;
      const normalizedRing = ringNoRepeat.length >= 3 ? normalizeRingClockwiseFromNorth(ringNoRepeat) : ringNoRepeat;
      const coordsUTM: [number, number][] = normalizedRing.map((pt) => [pt.x, pt.y]);
      setLastDrawnUTM(coordsUTM);
    });

    drawInteraction.setActive(false);
    map.addInteraction(drawInteraction);
    drawInteractionRef.current = drawInteraction;

    // Guardar referencias
    mapRef.current = map;
    parcelsLayerRef.current = parcelsLayer;
    activeLayerRef.current = activeLayer;
    verticesLayerRef.current = verticesLayer;
    streetsLayerRef.current = streetsLayer;
    satelliteLayerRef.current = satelliteLayer;
    esriLayerRef.current = esriSatelliteLayer;
    roadsLayerRef.current = roadsLayer;
    placesLayerRef.current = placesLayer;

    return () => {
      if (pointerRafRef.current) cancelAnimationFrame(pointerRafRef.current);
      resizeObserver.disconnect();
      map.setTarget(undefined);
      mapRef.current = streetsLayerRef.current = satelliteLayerRef.current = esriLayerRef.current =
        roadsLayerRef.current = placesLayerRef.current =
        parcelsLayerRef.current = activeLayerRef.current = verticesLayerRef.current =
        drawInteractionRef.current = translateInteractionRef.current = null;
    };
  }, [parcelsLayerStyle, activeLayerStyle, verticesLayerStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───────────────────────────────────────────────────────────────────────────
  // Conmutar capas base (Google Satélite, Google Híbrido, Esri Satélite, Calles)
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (
      !streetsLayerRef.current ||
      !satelliteLayerRef.current ||
      !esriLayerRef.current ||
      !roadsLayerRef.current ||
      !placesLayerRef.current
    ) {
      return;
    }
    const isStreets = baseLayer === 'streets';
    const isGoogleSat = baseLayer === 'satellite' || baseLayer === 'hybrid';
    const isEsriSat = baseLayer === 'esri';
    const isAnySat = isGoogleSat || isEsriSat;

    streetsLayerRef.current.setVisible(isStreets);
    satelliteLayerRef.current.setVisible(isGoogleSat);
    esriLayerRef.current.setVisible(isEsriSat);
    roadsLayerRef.current.setVisible(baseLayer === 'hybrid' || (isAnySat && showRoads));
    placesLayerRef.current.setVisible(isAnySat && showPlaces);
  }, [baseLayer, mapType, showRoads, showPlaces]);

  // ───────────────────────────────────────────────────────────────────────────
  // Herramientas de medición (módulo independiente: capa e interacciones propias)
  // ───────────────────────────────────────────────────────────────────────────
  useMeasureTool(mapRef);
  useContourLayer(mapRef);
  const contourVisibleIds = useContourStore((s) => s.visibleParcelIds);
  const contourLoadingIds = useContourStore((s) => s.loadingParcelIds);
  const toggleParcelContours = useContourStore((s) => s.toggleParcelContours);
  const measureActive = useMeasureStore((s) => s.mode !== 'off');
  useEffect(() => {
    // Medir y "Nuevo Predio" son mutuamente excluyentes
    if (measureActive && isDrawingRef.current) {
      drawInteractionRef.current?.setActive(false);
      setIsDrawing(false);
    }
  }, [measureActive]);

  // ───────────────────────────────────────────────────────────────────────────
  // Repintado Instantáneo (60 FPS) sin destruir geometrías ante cambios de estilo
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    parcelsLayerRef.current?.changed();
    activeLayerRef.current?.changed();
    verticesLayerRef.current?.changed();
  }, [selectedParcelId, activeParcelId, movableParcelIds, mapTool, labelSizeOffset, hatchColor, hatchOpacity]);

  // ───────────────────────────────────────────────────────────────────────────
  // EFECTO 1: Carga y Actualización Estructural de savedParcels y dxfPreview
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const source = parcelsSourceRef.current;
    const vtxSource = verticesSourceRef.current;
    const map = mapRef.current;
    if (!source || !vtxSource || !map) return;

    // Limpieza rápida O(1) sin disparar eventos por feature individual
    source.clear(true);
    vtxSource.clear(true);

    const featuresToAdd: Feature[] = [];
    const vtxFeaturesToAdd: Feature[] = [];
    const allCoordinatesToFit: Coordinate[] = [];

    savedParcels.forEach((parcel) => {
      const coords3857: Coordinate[] = [];
      parcel.puntos.forEach((p) => {
        const c = extractCoord3857(p, huso, effectiveDirection);
        if (c && !isNaN(c[0]) && !isNaN(c[1])) {
          coords3857.push(c);
          allCoordinatesToFit.push(c);
        }
      });

      if (coords3857.length === 0) return;

      const pType = parcel.geometryType || 'cerrada';

      if (pType === 'cerrada' && coords3857.length >= 3) {
        const ring = [...coords3857];
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          ring.push([first[0], first[1]]);
        }
        const polyFeature = new Feature({ geometry: new Polygon([ring]) });
        polyFeature.set('parcelId', parcel.id);
        polyFeature.set('parcelData', parcel);
        polyFeature.set('geometryType', 'cerrada');
        featuresToAdd.push(polyFeature);
      } else if (pType === 'abierta' && coords3857.length >= 2) {
        const lineFeature = new Feature({ geometry: new LineString(coords3857) });
        lineFeature.set('parcelId', parcel.id);
        lineFeature.set('parcelData', parcel);
        lineFeature.set('geometryType', 'abierta');
        featuresToAdd.push(lineFeature);
      }

      // Un único MultiPoint por parcela en vez de N Features individuales
      const multiPtFeature = new Feature({ geometry: new MultiPoint(coords3857) });
      multiPtFeature.set('parcelId', parcel.id);
      vtxFeaturesToAdd.push(multiPtFeature);
    });

    // Renderizar dxfPreview (usa coordenadas ya transformadas/resultEpsg, soporta cerrados y abiertos)
    const dxfCoordinatesToFit: Coordinate[] = [];
    if (dxfPreview && dxfPreview.length > 0) {
      dxfPreview.forEach((dxfPoly) => {
        const dxfHuso = [18, 19, 20, 21].includes(Number(dxfPoly.huso)) ? Number(dxfPoly.huso) : huso;
        const defaultEpsg = dxfPoly.resultEpsg || `EPSG:220${dxfHuso - 17}`;
        const coords: Coordinate[] = dxfPoly.vertices
          .map((pt: any) => {
            try {
              if (
                pt?.result &&
                typeof pt.result.este === 'number' && !isNaN(pt.result.este) &&
                typeof pt.result.norte === 'number' && !isNaN(pt.result.norte) &&
                (Math.abs(pt.result.este) > 1000 || Math.abs(pt.result.norte) > 1000)
              ) {
                const resEpsg =
                  pt.result.direction === 'regven_canoa' ? `EPSG:248${dxfHuso}` : defaultEpsg;
                return transform([pt.result.este, pt.result.norte], resEpsg, 'EPSG:3857');
              }
              if (
                typeof pt?.lat === 'number' && !isNaN(pt.lat) &&
                typeof pt?.lng === 'number' && !isNaN(pt.lng) &&
                Math.abs(pt.lat) <= 90 && Math.abs(pt.lng) <= 180 &&
                (pt.lat !== 0 || pt.lng !== 0)
              ) {
                return transform([pt.lng, pt.lat], 'EPSG:4326', 'EPSG:3857');
              }
              if (dxfPoly.isGeographic && typeof pt?.e === 'number' && typeof pt?.n === 'number') {
                return transform([pt.e, pt.n], 'EPSG:4326', 'EPSG:3857');
              }
              if (typeof pt?.e === 'number' && typeof pt?.n === 'number' && !isNaN(pt.e) && !isNaN(pt.n)) {
                return transform([pt.e, pt.n], defaultEpsg, 'EPSG:3857');
              }
            } catch {
              // Fallback silent
            }
            return null;
          })
          .filter((c): c is Coordinate => c !== null && isFinite(c[0]) && isFinite(c[1]));

        if (dxfPoly.closed && coords.length >= 3) {
          const ring = [...coords];
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            ring.push([first[0], first[1]]);
          }
          const dxfFeat = new Feature({ geometry: new Polygon([ring]) });
          dxfFeat.set('isDxf', true);
          dxfFeat.set('dxfColor', dxfPoly.color);
          dxfFeat.set('dxfLayer', dxfPoly.layer);
          dxfFeat.set('geometryType', 'cerrada');
          featuresToAdd.push(dxfFeat);
          dxfCoordinatesToFit.push(...coords);
        } else if (coords.length >= 2) {
          const lineFeat = new Feature({ geometry: new LineString(coords) });
          lineFeat.set('isDxf', true);
          lineFeat.set('dxfColor', dxfPoly.color);
          lineFeat.set('dxfLayer', dxfPoly.layer);
          lineFeat.set('geometryType', 'abierta');
          featuresToAdd.push(lineFeat);
          dxfCoordinatesToFit.push(...coords);
        }
      });
    }

    source.addFeatures(featuresToAdd);

    // Preservar el MultiPoint activo si existe
    if (activeVtxFeatureRef.current) {
      vtxFeaturesToAdd.push(activeVtxFeatureRef.current);
    }
    vtxSource.addFeatures(vtxFeaturesToAdd);

    // Forzar repintado de capas cuando se vacían todos los elementos de parcelas (clear(true) omite eventos)
    if (savedParcels.length === 0) {
      setSelectedParcelId(null);
      drawSourceRef.current?.clear();
    }
    source.changed();
    vtxSource.changed();
    parcelsLayerRef.current?.changed();
    verticesLayerRef.current?.changed();
    map.render();

    // Ajuste de cámara: priorizar dxfPreview cuando está activo o nuevas parcelas importadas
    const parcelsCount = savedParcels.length;
    const prevParcelsCount = prevParcelsCountRef.current;
    prevParcelsCountRef.current = parcelsCount;

    if (dxfCoordinatesToFit.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of dxfCoordinatesToFit) {
        if (c[0] < minX) minX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] > maxY) maxY = c[1];
      }
      if (isFinite(minX) && isFinite(minY)) {
        map.getView().fit([minX, minY, maxX, maxY], {
          duration: 500,
          padding: [80, 80, 80, 80],
          maxZoom: 19,
        });
      }
    } else if (!hasInitialFitRef.current || (parcelsCount > prevParcelsCount && parcelsCount > 0)) {
      if (allCoordinatesToFit.length > 0) {
        const extent = source.getExtent();
        if (extent && isFinite(extent[0]) && isFinite(extent[1])) {
          map.getView().fit(extent, {
            duration: 600,
            padding: [80, 80, 80, 80],
            maxZoom: 18,
          });
          hasInitialFitRef.current = true;
        }
      }
    }
  }, [savedParcels, dxfPreview, huso]);

  // ───────────────────────────────────────────────────────────────────────────
  // EFECTO 2: Carga y Actualización Estructural de results (Parcela Activa)
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const activeSource = activeSourceRef.current;
    const vtxSource = verticesSourceRef.current;
    if (!activeSource || !vtxSource) return;

    activeSource.clear(true);

    // Remover únicamente el MultiPoint activo anterior sin tocar los vértices de savedParcels
    if (activeVtxFeatureRef.current) {
      if (vtxSource.hasFeature(activeVtxFeatureRef.current)) {
        vtxSource.removeFeature(activeVtxFeatureRef.current);
      }
      activeVtxFeatureRef.current = null;
    }

    if (!results || results.length === 0) {
      activeSource.changed();
      vtxSource.changed();
      activeLayerRef.current?.changed();
      verticesLayerRef.current?.changed();
      mapRef.current?.render();
      return;
    }

    const activeCoords: Coordinate[] = [];
    results.forEach((r) => {
      const c = extractCoord3857(r, huso, effectiveDirection);
      if (c && !isNaN(c[0]) && !isNaN(c[1])) {
        activeCoords.push(c);
      }
    });

    if (activeCoords.length === 0) return;

    const activePid = activeParcelId || 'active';
    const matchedParcel = savedParcelsRef.current.find((p) => p.id === activePid);
    const parcelName = matchedParcel?.nombre || 'Parcela Activa';
    const areaM2 = matchedParcel?.area ?? calculatePlanarAreaM2(results);

    if (activeCoords.length >= 3 && geometryType === 'cerrada') {
      const ring = [...activeCoords];
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
      }
      const activeFeature = new Feature({ geometry: new Polygon([ring]) });
      activeFeature.set('parcelId', activePid);
      activeFeature.set('parcelName', parcelName);
      activeFeature.set('areaM2', areaM2);
      activeFeature.set('geometryType', 'cerrada');
      activeSource.addFeature(activeFeature);
    } else if (activeCoords.length >= 2 && geometryType === 'abierta') {
      const activeLine = new Feature({ geometry: new LineString(activeCoords) });
      activeLine.set('parcelId', activePid);
      activeLine.set('geometryType', 'abierta');
      activeSource.addFeature(activeLine);
    }

    // Un único MultiPoint para los vértices de la parcela activa
    const activeMultiPt = new Feature({ geometry: new MultiPoint(activeCoords) });
    activeMultiPt.set('parcelId', activePid);
    activeVtxFeatureRef.current = activeMultiPt;
    vtxSource.addFeature(activeMultiPt);
  }, [results, geometryType, huso, activeParcelId, effectiveDirection]);

  // ───────────────────────────────────────────────────────────────────────────
  // AUTO-CENTRADO: Se dispara ÚNICAMENTE cuando results cambia
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!results || results.length === 0) return;

    const doCenter = () => {
      const map = mapRef.current;
      if (!map) return false;

      const coords: Coordinate[] = [];
      results.forEach((r) => {
        const c = extractCoord3857(r, huso, effectiveDirection);
        if (c && !isNaN(c[0]) && !isNaN(c[1]) && isFinite(c[0]) && isFinite(c[1])) {
          coords.push(c);
        }
      });

      if (coords.length === 0) return true;

      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      if (coords.length === 1 || (minX === maxX && minY === maxY)) {
        map.getView().animate({ center: [minX, minY], zoom: 17, duration: 700 });
      } else {
        map.getView().fit([minX, minY, maxX, maxY], {
          duration: 700,
          padding: [80, 80, 80, 80],
          maxZoom: 19,
        });
      }
      hasInitialFitRef.current = true;
      return true;
    };

    if (!doCenter()) {
      const timer = setTimeout(() => { doCenter(); }, 200);
      return () => clearTimeout(timer);
    }
  }, [results, huso]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───────────────────────────────────────────────────────────────────────────
  // Control de cámara centralizado (viewTarget)
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewTarget.trigger) return;

    const map = mapRef.current;
    const parcelsSource = parcelsSourceRef.current;
    const activeSource = activeSourceRef.current;
    if (!map || !parcelsSource || !activeSource) return;

    if (viewTarget.type === 'all') {
      const extent = parcelsSource.getExtent();
      if (extent && isFinite(extent[0]) && isFinite(extent[1])) {
        map.getView().fit(extent, { duration: 600, padding: [60, 60, 60, 60], maxZoom: 18 });
      }
    } else if (viewTarget.type === 'parcel' && viewTarget.id) {
      const features = [...parcelsSource.getFeatures(), ...activeSource.getFeatures()];
      const targetFeature = features.find((f) => f.get('parcelId') === viewTarget.id);

      if (targetFeature) {
        const geom = targetFeature.getGeometry();
        if (geom) {
          const extent = geom.getExtent();
          map.getView().fit(extent, {
            duration: 650,
            padding: [100, 100, 100, 100],
            maxZoom: 19,
          });
          return;
        }
      }

      const coords: Coordinate[] = [];
      if (viewTarget.id === 'active' || viewTarget.id === activeParcelId) {
        results.forEach((r) => {
          const c = extractCoord3857(r, huso, effectiveDirection);
          if (c && !isNaN(c[0]) && !isNaN(c[1])) coords.push(c);
        });
      } else {
        const targetParcel = savedParcels.find((p) => p.id === viewTarget.id);
        if (targetParcel && targetParcel.puntos?.length > 0) {
          targetParcel.puntos.forEach((p) => {
            const c = extractCoord3857(p, huso, effectiveDirection);
            if (c && !isNaN(c[0]) && !isNaN(c[1])) coords.push(c);
          });
        }
      }

      if (coords.length > 0) {
        const xs = coords.map((c) => c[0]);
        const ys = coords.map((c) => c[1]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        if (xs.length === 1 || (minX === maxX && minY === maxY)) {
          map.getView().animate({
            center: [minX, minY],
            zoom: Math.max(map.getView().getZoom() || 16, 17),
            duration: 650,
          });
        } else {
          map.getView().fit([minX, minY, maxX, maxY], {
            duration: 650,
            padding: [100, 100, 100, 100],
            maxZoom: 19,
          });
        }
      }
    }
  }, [viewTarget.trigger, viewTarget.id, viewTarget.type, savedParcels, results, activeParcelId, huso]);

  // ── Handlers de UI ─────────────────────────────────────────────────────────
  const handleToggleDraw = useCallback(() => {
    const draw = drawInteractionRef.current;
    if (!draw) return;
    const next = !isDrawing;
    if (next) useMeasureStore.getState().setMode('off');
    draw.setActive(next);
    setIsDrawing(next);
  }, [isDrawing]);

  // Activar siempre la capa satelital al iniciar la aplicación (salvo que el perfil la tenga bloqueada en el panel)
  useEffect(() => {
    if (canUseSatellite) {
      toggleBaseLayer('satellite');
      setMapType('satellite');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseSatellite]);

  // Si el administrador desactiva explícitamente la capa satelital para el perfil del usuario, cambiar a callejero
  useEffect(() => {
    if (Boolean(user?.rol) && !canUseSatellite && baseLayer !== 'streets') {
      toggleBaseLayer('streets');
      setMapType('standard');
    }
  }, [user?.rol, canUseSatellite, baseLayer, toggleBaseLayer, setMapType]);

  const handleToggleLayer = (mode: BaseLayerType) => {
    if (mode !== 'streets' && !canUseSatellite) {
      toast.error('Modo DEMO: Ortofotos y capas satelitales están bloqueadas.');
      return;
    }
    if (mode === 'hybrid') {
      setShowRoads(true);
    } else if (mode === 'satellite') {
      setShowRoads(false);
    }
    toggleBaseLayer(mode);
    setMapType(mode === 'streets' ? 'standard' : 'satellite');
  };

  const handleToggleRoads = () => {
    if (!canUseSatellite) {
      toast.error('Modo DEMO: Capas satelitales bloqueadas.');
      return;
    }
    if (baseLayer === 'streets') {
      handleToggleLayer('satellite');
    } else if (baseLayer === 'hybrid') {
      toggleBaseLayer('satellite');
      setShowRoads(false);
      return;
    }
    setShowRoads((prev) => !prev);
  };

  const handleTogglePlaces = () => {
    if (!canUseSatellite) {
      toast.error('Modo DEMO: Capas satelitales bloqueadas.');
      return;
    }
    if (baseLayer === 'streets') {
      handleToggleLayer('satellite');
    }
    setShowPlaces((prev) => !prev);
  };

  const handleIncreaseText = () => {
    setLabelSizeOffset((prev) => Math.min(8, prev + 1));
  };

  const handleDecreaseText = () => {
    setLabelSizeOffset((prev) => Math.max(-4, prev - 1));
  };

  const handleResetText = () => {
    setLabelSizeOffset(0);
  };

  return (
    <div className={`relative w-full h-full overflow-hidden rounded-xl flex flex-col ${className ?? ''}`}>
     {/* Área del mapa: los overlays absolutos se posicionan respecto a este contenedor, por encima de la banda inferior */}
     <div className="relative flex-1 min-h-0 w-full">
      {/* Contenedor Canvas OpenLayers con protección de menú contextual en modo Demo */}
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        onContextMenu={(e) => {
          if (isDemo) {
            e.preventDefault();
            e.stopPropagation();
            toast.error('Menú contextual deshabilitado en Modo DEMO.');
          }
        }}
      />

      {/* ── Banner / HUD de Modo Mover Activo ──────────────────────────────── */}
      {mapTool === 'move' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 animate-bounce">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500 text-slate-950 text-xs font-bold shadow-2xl shadow-amber-500/50 border border-amber-300">
            <Move className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '4s' }} />
            <span>Modo Mover Activo: Arrastra cualquier parcela con el ratón</span>
          </div>
        </div>
      )}

      {/* ── Banner / HUD de Herramienta Interactiva "Amarrar con Punto" ────── */}
      {calibStep !== 'off' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-emerald-600/95 text-white text-xs font-bold shadow-2xl shadow-emerald-500/40 border border-emerald-300 backdrop-blur-md">
            <Crosshair className="w-4 h-4 animate-pulse shrink-0" />
            <span>
              {calibStep === 'vertex'
                ? 'Paso 1/2: Haz clic sobre el vértice conocido de tu polígono'
                : 'Paso 2/2: Haz clic sobre ese mismo rincón visible en la foto satelital'}
            </span>
            <button
              onClick={() => {
                setCalibStep('off');
                setCalibRealUTM(null);
              }}
              className="ml-1 p-0.5 rounded-full bg-black/25 hover:bg-black/40 text-white transition-colors"
              title="Cancelar amarre"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Tarjeta de Parcela Seleccionada (Inspector Rápido) ──────────────── */}
      {(() => {
        const targetId = selectedParcelId || activeParcelId;
        if (!targetId) return null;
        const parcel = savedParcels.find((p) => p.id === targetId);
        const name = parcel?.nombre || (targetId === 'active' ? 'Parcela Activa (En Cálculo)' : 'Parcela');
        const color = parcel?.hatchColor || '#38bdf8';
        const isMovableThis = mapTool === 'move' || movableParcelIds.includes(targetId);

        return (
          <div className="absolute top-16 left-4 z-20 max-w-sm bg-slate-900/95 backdrop-blur-xl border border-cyan-500/40 rounded-xl p-3 shadow-2xl shadow-black/70 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-3 h-3 rounded-full shrink-0 border border-white/40" style={{ backgroundColor: color }} />
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-white truncate">{name}</h4>
                  <p className="text-[10px] text-cyan-400 font-mono">
                    {parcel?.area ? `${parcel.area.toFixed(2)} m²` : 'Seleccionada con ratón'}
                    {parcel?.perim ? ` · ${parcel.perim.toFixed(2)} ml` : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedParcelId(null)}
                className="text-slate-400 hover:text-white transition-colors p-0.5"
                title="Deseleccionar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 pt-1 border-t border-white/10">
              <button
                onClick={() => toggleParcelMovement(targetId)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg text-[11px] font-bold transition-all duration-200 border',
                  isMovableThis
                    ? 'bg-amber-500 border-amber-400 text-slate-950 shadow-md shadow-amber-500/30'
                    : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-amber-400 hover:text-white'
                )}
                title="Habilitar arrastre con el ratón solo para esta parcela"
              >
                <Move className="w-3 h-3" />
                {isMovableThis ? 'Mover: ON' : 'Mover con ratón'}
              </button>

              <button
                onClick={() => centerOnParcel(targetId)}
                className="flex items-center justify-center gap-1 py-1 px-2.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-300 hover:text-white transition-colors"
                title="Centrar mapa en esta parcela"
              >
                <Maximize2 className="w-3 h-3 text-cyan-400" />
                Centrar
              </button>

              {(() => {
                const targetParcel: Parcel | null =
                  parcel ??
                  (targetId === 'active' && results.length >= 3
                    ? {
                        id: 'active',
                        nombre: 'Parcela Activa',
                        fecha: new Date().toISOString(),
                        puntos: results,
                        geometryType: geometryType,
                      }
                    : null);
                if (!targetParcel || (targetParcel.puntos?.length ?? 0) < 3) return null;
                const hasC = contourVisibleIds.includes(targetParcel.id);
                const isLoadC = contourLoadingIds.includes(targetParcel.id);
                return (
                  <button
                    onClick={() => toggleParcelContours(targetParcel, huso, effectiveDirection)}
                    disabled={isLoadC}
                    className={cn(
                      'flex items-center justify-center gap-1 py-1 px-2 rounded-lg text-[11px] font-bold border transition-colors disabled:opacity-50',
                      hasC
                        ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                        : 'bg-slate-800 hover:bg-slate-700 border-white/10 text-slate-300 hover:text-amber-300'
                    )}
                    title="Proyectar u ocultar curvas de nivel satelitales en esta parcela"
                  >
                    <Mountain className={cn('w-3 h-3', isLoadC && 'animate-pulse')} />
                    {isLoadC ? '...' : 'Curvas'}
                  </button>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* ── Herramientas de Medición (estilo Google Earth, módulo independiente) ── */}
      <MeasureToolbar />

      {/* ── HUD Altimétrico y Modal Imprimible de Curvas de Nivel ────────────── */}
      <ContourMapHUD />
      <ContourPrintModal />

      {/* ── Selector de Capas Base y Controles del Viewport (Colapsable en Móvil) ── */}
      <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setMobileToolsOpen((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border shadow-2xl backdrop-blur-md transition-all duration-150',
            mobileToolsOpen || isDrawing || mapTool === 'move' || satOffset.dE !== 0 || satOffset.dN !== 0
              ? 'bg-emerald-500/90 border-emerald-400 text-slate-950 shadow-emerald-500/30'
              : 'bg-slate-900/90 border-white/10 text-slate-200 hover:border-cyan-500/50'
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>{mobileToolsOpen ? 'Ocultar' : 'Herramientas'}</span>
        </button>

        {mobileToolsOpen && (
          <div className="flex flex-col gap-2 w-48 max-h-[60vh] overflow-y-auto p-1.5 bg-slate-900/95 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl">
        {/* Barra de Modos de Interacción (Seleccionar vs Mover vs Dibujar) */}
        <div className="flex flex-col gap-1 p-1 bg-slate-950/60 border border-white/5 rounded-xl">
          <div className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider px-1.5 pt-0.5">
            Herramienta
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => {
                setMapTool('select');
                useMeasureStore.getState().setMode('off');
                if (isDrawing) {
                  drawInteractionRef.current?.setActive(false);
                  setIsDrawing(false);
                }
              }}
              className={cn(
                'flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 border',
                mapTool === 'select' && !isDrawing
                  ? 'bg-cyan-500 border-cyan-400 text-white shadow-md shadow-cyan-500/30'
                  : 'bg-slate-800/80 border-transparent text-slate-400 hover:text-white'
              )}
              title="Modo Selección: Clic sobre cualquier parcela o vértice para seleccionarla"
            >
              <MousePointer className="w-3.5 h-3.5" />
              <span>Elegir</span>
            </button>

            <button
              onClick={() => {
                setMapTool('move');
                useMeasureStore.getState().setMode('off');
                if (isDrawing) {
                  drawInteractionRef.current?.setActive(false);
                  setIsDrawing(false);
                }
              }}
              className={cn(
                'flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 border',
                mapTool === 'move'
                  ? 'bg-amber-500 border-amber-400 text-slate-950 shadow-md shadow-amber-500/30 animate-pulse'
                  : 'bg-slate-800/80 border-transparent text-slate-400 hover:text-amber-300'
              )}
              title="Modo Mover: Arrastra cualquier parcela directamente con el ratón"
            >
              <Move className="w-3.5 h-3.5" />
              <span>Mover</span>
            </button>
          </div>
        </div>

        {/* Ajuste de Tamaño de Texto de Parcelas (A- / A+) */}
        <div className="flex flex-col gap-1 pt-1.5 border-t border-white/10">
          <div className="flex items-center justify-between px-1 text-[10px] text-slate-400 font-medium">
            <span>Texto Parcela</span>
            <span className="font-mono text-cyan-400 font-bold">
              {labelSizeOffset > 0 ? `+${labelSizeOffset}` : labelSizeOffset === 0 ? 'Normal' : `${labelSizeOffset}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleDecreaseText}
              disabled={labelSizeOffset <= -4}
              title="Disminuir altura de texto de parcelas (A-)"
              className="flex-1 flex items-center justify-center py-1.5 rounded-md bg-slate-900/80 border border-white/10 text-xs font-bold text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40 transition-colors shadow-md"
            >
              A -
            </button>
            <button
              onClick={handleResetText}
              title="Restablecer tamaño predeterminado (1:1)"
              className="px-2 py-1.5 rounded-md bg-slate-900/80 border border-white/10 text-[10px] font-mono text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shadow-md"
            >
              1:1
            </button>
            <button
              onClick={handleIncreaseText}
              disabled={labelSizeOffset >= 8}
              title="Aumentar altura de texto de parcelas (A+)"
              className="flex-1 flex items-center justify-center py-1.5 rounded-md bg-slate-900/80 border border-white/10 text-xs font-bold text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40 transition-colors shadow-md"
            >
              A +
            </button>
          </div>
        </div>

        {/* Acción Nuevo Predio */}
        <div className="pt-1.5 border-t border-white/10">
          <button
            onClick={handleToggleDraw}
            className={['w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold shadow-xl border transition-all duration-200',
              isDrawing
                ? 'bg-orange-500 border-orange-400 text-white scale-105 animate-pulse shadow-orange-500/30'
                : 'bg-slate-900/80 border-white/10 text-slate-300 hover:border-orange-500/50 hover:text-white backdrop-blur-sm',
            ].join(' ')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            {isDrawing ? 'Cancelar' : 'Nuevo Predio'}
          </button>
        </div>

        {/* Calibración de Imagen Satelital (Offset Local ΔE / ΔN en metros) */}
        <div className="relative pt-1.5 border-t border-white/10">
          <button
            onClick={() => setShowSatCalib((v) => !v)}
            title="Alinear visualmente la ortofoto satelital (ΔE / ΔN en metros) sin alterar coordenadas de parcelas"
            className={cn(
              'w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-xl border transition-all duration-200 backdrop-blur-sm',
              satOffset.dE !== 0 || satOffset.dN !== 0
                ? 'bg-emerald-500/90 border-emerald-400 text-white shadow-emerald-500/30'
                : showSatCalib
                  ? 'bg-slate-800 border-cyan-500/50 text-white'
                  : 'bg-slate-900/80 border-white/10 text-slate-300 hover:border-cyan-500/50 hover:text-white'
            )}
          >
            <span className="flex items-center gap-1.5 truncate">
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Calibrar Satélite</span>
            </span>
            {(satOffset.dE !== 0 || satOffset.dN !== 0) && (
              <span className="text-[9px] px-1 rounded bg-black/30 font-mono font-bold shrink-0">
                ON
              </span>
            )}
          </button>

          {showSatCalib && (
            <div className="mt-1.5 p-2.5 bg-slate-900/95 border border-white/15 backdrop-blur-xl rounded-xl shadow-2xl flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider">
                  Calibrar Satélite
                </span>
                <button
                  onClick={() => {
                    setSatOffset({ dE: 0, dN: 0 });
                    setCalibStep('off');
                    setCalibRealUTM(null);
                  }}
                  disabled={satOffset.dE === 0 && satOffset.dN === 0 && calibStep === 'off'}
                  title="Restablecer desplazamiento a 0 m"
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-white/10 text-slate-300 hover:text-white hover:border-cyan-500/40 disabled:opacity-40 transition-colors font-mono"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Reset
                </button>
              </div>

              {/* Botón Interactivo de 2 Clics: Amarrar con Punto */}
              <button
                onClick={() => {
                  if (calibStep !== 'off') {
                    setCalibStep('off');
                    setCalibRealUTM(null);
                  } else {
                    if (isDrawing) {
                      drawInteractionRef.current?.setActive(false);
                      setIsDrawing(false);
                    }
                    useMeasureStore.getState().setMode('off');
                    setCalibStep('vertex');
                    setCalibRealUTM(null);
                    toast('Paso 1/2: Haz clic sobre el vértice conocido de tu polígono', {
                      icon: '🎯',
                      id: 'calib-step-toast',
                      duration: 4000,
                    });
                  }
                }}
                title="Alinear foto en 2 clics: 1) Clic en vértice del polígono, 2) Clic en rincón real sobre la foto satelital"
                className={cn(
                  'w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-bold border transition-all duration-150',
                  calibStep !== 'off'
                    ? 'bg-emerald-500 border-emerald-300 text-slate-950 shadow-md shadow-emerald-500/30 animate-pulse'
                    : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25 hover:text-white'
                )}
              >
                <Crosshair className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {calibStep === 'vertex'
                    ? '1/2 Clic en Vértice...'
                    : calibStep === 'photo'
                      ? '2/2 Clic en Foto...'
                      : 'Amarrar con Punto'}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-1.5">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-mono text-slate-400">ΔE (m)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={satOffset.dE}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setSatOffset((prev) => ({ ...prev, dE: Number.isFinite(val) ? val : 0 }));
                    }}
                    className="w-full px-1.5 py-1 rounded bg-slate-950 border border-white/10 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-mono text-slate-400">ΔN (m)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={satOffset.dN}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setSatOffset((prev) => ({ ...prev, dN: Number.isFinite(val) ? val : 0 }));
                    }}
                    className="w-full px-1.5 py-1 rounded bg-slate-950 border border-white/10 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-400"
                  />
                </label>
              </div>
              <p className="text-[9px] text-slate-400 leading-tight">
                Alinea visualmente la ortofoto con los vértices GNSS sin alterar coordenadas.
              </p>
            </div>
          )}
        </div>
          </div>
        )}
      </div>

      {/* ── Panel de Control de Movimiento por Parcela ─────────────────────── */}
      {savedParcels.length > 0 && (
      <div className="absolute bottom-14 right-3 z-20">
        <button
          onClick={() => setShowMovePanel((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold shadow-2xl border transition-all duration-200 backdrop-blur-md',
            movableParcelIds.length > 0
              ? 'bg-amber-500/90 border-amber-400 text-white shadow-amber-500/30 animate-pulse'
              : showMovePanel
                ? 'bg-slate-700 border-white/20 text-white'
                : 'bg-slate-900/85 border-white/10 text-slate-300 hover:text-white hover:border-white/20'
          )}
          title={movableParcelIds.length > 0 ? `${movableParcelIds.length} parcela(s) en modo movimiento` : 'Control de movimiento de parcelas'}
        >
          <Move className="w-3.5 h-3.5" />
          {movableParcelIds.length > 0 ? `Moviendo ${movableParcelIds.length}` : 'Mover parcelas'}
        </button>

        {showMovePanel && (
          <div className="absolute bottom-full mb-2 right-0 w-64 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10 bg-slate-800/60">
              <div className="flex items-center gap-2">
                <Move className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-bold text-white uppercase tracking-wide">Mover Parcelas</span>
              </div>
              <div className="flex items-center gap-1.5">
                {movableParcelIds.length > 0 && (
                  <button
                    onClick={() => clearAllParcelMovement()}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors font-bold"
                    title="Desactivar movimiento en todas las parcelas"
                  >
                    Limpiar
                  </button>
                )}
                <button
                  onClick={() => setShowMovePanel(false)}
                  className="text-slate-500 hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
              <p className="text-[9px] text-amber-300/80 leading-tight">
                <Crosshair className="inline w-2.5 h-2.5 mr-1 mb-0.5" />
                Activa el movimiento por parcela y arrástrala en el mapa. También puedes hacer clic sobre una parcela en el mapa para seleccionarla.
              </p>
            </div>

            <div className="max-h-56 overflow-y-auto divide-y divide-white/5">
              {savedParcels.map((parcel) => {
                const isMovable = movableParcelIds.includes(parcel.id);
                const isSelected = selectedParcelId === parcel.id;
                return (
                  <div
                    key={parcel.id}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2.5 transition-colors',
                      isSelected ? 'bg-cyan-500/15 border-l-2 border-cyan-400' : 'hover:bg-slate-800/50'
                    )}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                      style={{ backgroundColor: parcel.hatchColor || '#ffff00' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-slate-200 truncate">{parcel.nombre}</p>
                      {isSelected && (
                        <p className="text-[9px] text-cyan-400 font-mono">Seleccionada en mapa</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleParcelMovement(parcel.id); }}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide border transition-all duration-200 shrink-0',
                        isMovable
                          ? 'bg-amber-500/90 border-amber-400 text-white shadow-sm shadow-amber-500/30'
                          : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-amber-500/50 hover:text-amber-300'
                      )}
                      title={isMovable ? 'Desactivar movimiento para esta parcela' : 'Activar movimiento para esta parcela'}
                    >
                      <Move className="w-2.5 h-2.5" />
                      {isMovable ? 'ON' : 'OFF'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Indicador de Estado del Proyecto */}
      <div className="absolute top-3 left-3 z-10 max-w-[56vw]">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/85 border border-white/10 backdrop-blur-sm text-[11px] text-slate-300 shadow-xl truncate">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          <span className="font-semibold text-white truncate">{projectMeta.nombre || 'Proyecto Activo'}</span>
          <span className="text-slate-500">|</span>
          <span className="text-emerald-400 font-mono font-medium shrink-0">{savedParcels.length}p</span>
          {results.length > 0 && (
            <>
              <span className="text-slate-500">|</span>
              <span className="text-cyan-400 font-mono shrink-0">{results.length}pts</span>
            </>
          )}
        </div>
      </div>

      {/* ── Controles de Zoom Flotantes (+ / −) ────────────────────────────── */}
      <div className={cn(
        'absolute right-3 z-20 flex flex-col items-center bg-slate-900/90 border border-white/10 backdrop-blur-md rounded-xl shadow-2xl p-1 gap-1',
        savedParcels.length > 0 ? 'bottom-24' : 'bottom-14'
      )}>
        <button
          onClick={() => {
            const view = mapRef.current?.getView();
            if (view) {
              const current = view.getZoom() || 7;
              view.animate({ zoom: Math.min(24, current + 1), duration: 220 });
            }
          }}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-lg transition-colors border border-white/5 shadow-md active:scale-95"
          title="Acercar (Zoom In)"
        >
          +
        </button>
        <div className="w-5 h-px bg-white/10" />
        <button
          onClick={() => {
            const view = mapRef.current?.getView();
            if (view) {
              const current = view.getZoom() || 7;
              view.animate({ zoom: Math.max(3, current - 1), duration: 220 });
            }
          }}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-lg transition-colors border border-white/5 shadow-md active:scale-95"
          title="Alejar (Zoom Out)"
        >
          −
        </button>
      </div>

      {/* HUD de Coordenadas UTM Cursor (Metros REGVEN Zona Dinámica, 0 Re-renders) */}
      <div className="absolute bottom-2 left-2 z-10 pointer-events-none">
        <div className="flex gap-2 px-2 py-1 rounded-lg bg-slate-900/90 border border-white/10 backdrop-blur-sm text-[10px] font-mono text-slate-300 shadow-xl">
          <span className="text-slate-400 font-bold">{huso}N</span>
          <span ref={esteRef} className="text-cyan-400">E ---</span>
          <span ref={norteRef} className="text-emerald-400">N ---</span>
        </div>
      </div>

      {/* Predio Dibujado Temporalmente */}
      {lastDrawnUTM && (
        <div className="absolute bottom-14 left-4 z-10 max-w-xs">
          <div className="px-3 py-2 rounded-lg bg-orange-900/90 border border-orange-500/50 backdrop-blur-sm text-xs text-orange-200 shadow-2xl">
            <p className="font-semibold text-orange-300 mb-0.5">Predio dibujado · {lastDrawnUTM.length} vértices</p>
            <p className="text-orange-400/80 text-[11px]">Coordenadas UTM REGVEN {huso}N capturadas con precisión.</p>
            <button
              onClick={() => setLastDrawnUTM(null)}
              className="mt-1 text-orange-400 hover:text-white transition-colors text-xs underline font-medium"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
      </div>

      {/* ── Banda inferior anclada de capas (no oculta el mapa) ─────────────── */}
      <LayerBand
        baseLayer={baseLayer}
        roadsActive={baseLayer === 'hybrid' || (showRoads && baseLayer !== 'streets')}
        placesActive={showPlaces && baseLayer !== 'streets'}
        onSelectLayer={handleToggleLayer}
        onToggleRoads={handleToggleRoads}
        onTogglePlaces={handleTogglePlaces}
        satCalibActive={showSatCalib}
        satCalibOffsetNonZero={satOffset.dE !== 0 || satOffset.dN !== 0}
        onToggleSatCalib={() => setShowSatCalib((v) => !v)}
      />
    </div>
  );
}
