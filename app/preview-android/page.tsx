'use client';

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  Compass,
  Crosshair,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Layers,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Navigation,
  Plus,
  Ruler,
  Satellite,
  ShieldCheck,
  Smartphone,
  SlidersHorizontal,
  ArrowLeftRight,
  ChevronUp,
  ChevronDown,
  Copy,
  CheckCircle2,
  BatteryCharging,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn } from '@/lib/utils';
import {
  GeoEngine,
  HAYFORD,
  GRS80,
  PATVEN98,
} from '@/lib/geo-engine';
import {
  useAppStore,
  type TransformationResult,
} from '@/lib/store';
import { FileService } from '@/lib/file-service';
import { exportResultsToDXF } from '@/lib/exportDxf';

const MapViewer = dynamic(() => import('@/src/components/MapViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#060e20] flex flex-col items-center justify-center gap-2 text-[#4cd7f6] font-mono text-xs">
      <div className="w-7 h-7 border-2 border-[#4cd7f6]/30 border-t-[#4cd7f6] rounded-full animate-spin" />
      <span>Iniciando Visor Satelital OpenLayers...</span>
    </div>
  ),
});

type AndroidTab = 'map' | 'vertices' | 'qaqc' | 'export';
type SheetHeight = 'peek' | 'mid' | 'full';
type MapLayerMode = 'catastro' | 'satellite' | 'hybrid' | 'dtm';
type PreviewViewportMode = 'frame' | 'fullscreen';
type CanvasEngineMode = 'stitch' | 'openlayers';
type EngineMethod = 'rigida02' | 'badekas' | 'rigida';
type TransformDir = 'canoa_regven' | 'regven_canoa';

interface SampleVertexInput {
  id: string;
  este: number;
  norte: number;
  z: number;
  rms: number;
  sx: number;
  sy: number;
}

const INITIAL_PARCEL_VERTICES: SampleVertexInput[] = [
  { id: 'V-01', este: 409662.26, norte: 1327653.22, z: 421.3, rms: 0.008, sx: 65, sy: 85 },
  { id: 'V-02', este: 409740.42, norte: 1327663.6, z: 422.05, rms: 0.009, sx: 255, sy: 100 },
  { id: 'V-03', este: 409775.24, norte: 1327612.14, z: 423.88, rms: 0.011, sx: 290, sy: 265 },
  { id: 'V-04', este: 409719.96, norte: 1327557.28, z: 422.45, rms: 0.01, sx: 130, sy: 345 },
  { id: 'V-05', este: 409650.78, norte: 1327584.86, z: 420.914, rms: 0.012, sx: 55, sy: 245 },
];

const LAYER_LABELS: Record<MapLayerMode, string> = {
  catastro: 'Catastro Vector',
  satellite: 'Satélite HD',
  hybrid: 'Híbrido Ortho',
  dtm: 'LiDAR DTM',
};

function formatRumbo(dx: number, dy: number): string {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return '—';
  const ns = dy >= 0 ? 'N' : 'S';
  const ew = dx >= 0 ? 'E' : 'W';
  const angle = Math.abs((Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI);
  const deg = Math.floor(angle);
  const minFloat = (angle - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ns} ${pad(deg)}°${pad(min)}'${pad(sec)}" ${ew}`;
}

function transformSingleVertex(
  v: SampleVertexInput,
  huso: number,
  method: EngineMethod,
  direction: TransformDir
) {
  const inv = direction === 'regven_canoa';
  const elO = inv ? GRS80 : HAYFORD;
  const elD = inv ? HAYFORD : GRS80;

  if (method === 'rigida02') {
    const sign = inv ? -1 : 1;
    const este = Math.round((v.este + sign * GeoEngine.RIGIDA02_DELTA_ESTE) * 1000) / 1000;
    const norte = Math.round((v.norte + sign * GeoEngine.RIGIDA02_DELTA_NORTE) * 1000) / 1000;
    const geo = GeoEngine.utmToGeo(este, norte, huso, false, elD);
    return {
      este,
      norte,
      cota: v.z === 0 ? GeoEngine.RIGIDA02_COTA_GEOIDAL : v.z,
      lat: geo.lat,
      lng: geo.lng,
    };
  }

  if (method === 'rigida') {
    const r = GeoEngine.transformRigida(v.este, v.norte, v.z, huso, inv);
    return {
      este: r.este,
      norte: r.norte,
      cota: v.z,
      lat: r.lat,
      lng: r.lng,
    };
  }

  const geoO = GeoEngine.utmToGeo(v.este, v.norte, huso, false, elO);
  const cartO = GeoEngine.geoToCart(geoO.lat, geoO.lng, v.z, elO);
  const cartD = GeoEngine.badekas(cartO.X, cartO.Y, cartO.Z, inv);
  const geoD = GeoEngine.cartToGeo(cartD.X, cartD.Y, cartD.Z, elD);
  const utmD = GeoEngine.geoToUTM(geoD.lat, geoD.lng, huso, elD);
  return {
    este: utmD.este,
    norte: utmD.norte,
    cota: Math.round(geoD.h * 1000) / 1000,
    lat: geoD.lat,
    lng: geoD.lng,
  };
}

export default function PreviewAndroidPage() {
  const setResults = useAppStore((s) => s.setResults);
  const setStoreMethod = useAppStore((s) => s.setMethod);
  const setStoreDirection = useAppStore((s) => s.setDirection);
  const setStoreHuso = useAppStore((s) => s.setHuso);
  const setMapType = useAppStore((s) => s.setMapType);
  const centerOnAll = useAppStore((s) => s.centerOnAll);

  const [viewportMode, setViewportMode] = useState<PreviewViewportMode>('frame');
  const [canvasEngine, setCanvasEngine] = useState<CanvasEngineMode>('stitch');
  const [activeTab, setActiveTab] = useState<AndroidTab>('map');
  const [sheetHeight, setSheetHeight] = useState<SheetHeight>('peek');
  const [layerMode, setLayerMode] = useState<MapLayerMode>('catastro');
  const [method, setMethod] = useState<EngineMethod>('rigida02');
  const [direction, setDirection] = useState<TransformDir>('canoa_regven');
  const [huso, setHuso] = useState<number>(19);
  const [vertices, setVertices] = useState<SampleVertexInput[]>(INITIAL_PARCEL_VERTICES);
  const [selectedVertexId, setSelectedVertexId] = useState<string>('V-05');
  const [qaqcTimestamp, setQaqcTimestamp] = useState<string>('Validado hace 2s');
  const [imuTilt, setImuTilt] = useState<string>('0.08°');

  const computedVertices = useMemo(() => {
    const transformed = vertices.map((v) => {
      const out = transformSingleVertex(v, huso, method, direction);
      return {
        ...v,
        outEste: out.este,
        outNorte: out.norte,
        outCota: out.cota,
        lat: out.lat,
        lng: out.lng,
      };
    });

    return transformed.map((v, idx) => {
      const next = transformed[(idx + 1) % transformed.length];
      const dx = next.outEste - v.outEste;
      const dy = next.outNorte - v.outNorte;
      const dist = Math.hypot(dx, dy);
      return {
        ...v,
        rumbo: formatRumbo(dx, dy),
        dist,
      };
    });
  }, [vertices, huso, method, direction]);

  const selectedVertex = useMemo(
    () => computedVertices.find((v) => v.id === selectedVertexId) || computedVertices[computedVertices.length - 1],
    [computedVertices, selectedVertexId]
  );

  const geom = useMemo(() => {
    const pts = computedVertices.map((v) => ({ e: v.outEste, n: v.outNorte }));
    return FileService.calculateGeometry(pts);
  }, [computedVertices]);

  const storeResultsPayload = useMemo<TransformationResult[]>(
    () =>
      computedVertices.map((v) => ({
        id: v.id,
        ok: true,
        direction,
        input: {
          id: v.id,
          este: v.este,
          norte: v.norte,
          huso,
          alt: v.z,
          desc: 'VERTICE_CAMPO',
          parcel: 'PARCELA-09B',
        },
        result: {
          este: v.outEste,
          norte: v.outNorte,
          huso,
          cota: v.outCota,
          lat: v.lat,
          lng: v.lng,
          descripcion: 'VERTICE_SANEADO_REGVEN',
        },
      })),
    [computedVertices, direction, huso]
  );

  // Sync sample parcel with OpenLayers store when switching to live satellite mode
  useEffect(() => {
    setStoreMethod(method);
    setStoreDirection(direction);
    setStoreHuso(huso);
    setResults(storeResultsPayload);
  }, [
    method,
    direction,
    huso,
    storeResultsPayload,
    setStoreMethod,
    setStoreDirection,
    setStoreHuso,
    setResults,
  ]);

  const handleSelectTab = useCallback((tab: AndroidTab) => {
    setActiveTab(tab);
    if (tab === 'map') {
      setSheetHeight('peek');
    } else {
      setSheetHeight((prev) => (prev === 'peek' ? 'mid' : prev));
    }
  }, []);

  const handleCycleSheetHeight = useCallback(() => {
    setSheetHeight((prev) => {
      if (prev === 'peek') return 'mid';
      if (prev === 'mid') return 'full';
      return 'peek';
    });
  }, []);

  const handleCycleLayer = useCallback(() => {
    const order: MapLayerMode[] = ['catastro', 'satellite', 'hybrid', 'dtm'];
    const nextLayer = order[(order.indexOf(layerMode) + 1) % order.length];
    setLayerMode(nextLayer);
    if (nextLayer === 'satellite') setMapType('satellite');
    else if (nextLayer === 'hybrid') setMapType('hybrid');
    else if (nextLayer === 'dtm') setMapType('physical');
    else setMapType('standard');
    toast.success(`Capa activa: ${LAYER_LABELS[nextLayer]}`);
  }, [layerMode, setMapType]);

  const handleCapturePoint = useCallback(() => {
    const nextNum = vertices.length + 1;
    const id = `V-${String(nextNum).padStart(2, '0')}`;
    const last = vertices[vertices.length - 1];
    const first = vertices[0];
    const newEste = Math.round((((last.este + first.este) / 2) - 8.5 + (nextNum % 3) * 4.2) * 1000) / 1000;
    const newNorte = Math.round((((last.norte + first.norte) / 2) + 6.3 - (nextNum % 2) * 3.1) * 1000) / 1000;
    const newSx = Math.round(Math.max(42, Math.min(285, (last.sx + first.sx) / 2 - 14)));
    const newSy = Math.round(Math.max(70, Math.min(340, (last.sy + first.sy) / 2 + 12)));

    const created: SampleVertexInput = {
      id,
      este: newEste,
      norte: newNorte,
      z: Math.round((420.5 + nextNum * 0.14) * 1000) / 1000,
      rms: 0.008,
      sx: newSx,
      sy: newSy,
    };

    setVertices((prev) => [...prev, created]);
    setSelectedVertexId(id);
    setImuTilt('0.06°');
    toast.success(`Punto ${id} grabado con RTK FIXED (±0.008 m)`);
  }, [vertices]);

  const handleCopyCivilCad = useCallback(async () => {
    const text = computedVertices
      .map(
        (v) =>
          `${v.id},${v.outEste.toFixed(3)},${v.outNorte.toFixed(3)},${v.outCota.toFixed(3)},PARCELA-09B`
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Coordenadas CivilCAD (P,E,N,Z,D) copiadas al portapapeles');
    } catch {
      toast.success('Cadena CivilCAD lista');
    }
  }, [computedVertices]);

  const handleExportDxf = useCallback(() => {
    exportResultsToDXF(storeResultsPayload, 'PARCELA_09B_GEOGIS6_ANDROID');
  }, [storeResultsPayload]);

  const handleExportKml = useCallback(() => {
    FileService.exportKML(storeResultsPayload, 'PARCELA_09B_GEOGIS6');
    toast.success('Archivo .KML descargado');
  }, [storeResultsPayload]);

  const handleVerifyQaqc = useCallback(() => {
    try {
      const check = GeoEngine.transformRigida02(
        vertices.map((v) => ({
          id: v.id,
          norte_origen: v.norte,
          este_origen: v.este,
          cota_origen: v.z,
        }))
      );
      if (check.qaqcPasado) {
        setQaqcTimestamp(`Aprobado ${new Date().toLocaleTimeString()}`);
        toast.success('QA/QC IGVSB Aprobado · Invarianza Euclidiana ≤ 0.001 m');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error en validación QA/QC');
    }
  }, [vertices]);

  const sheetHeightClass =
    sheetHeight === 'full'
      ? 'h-[82%]'
      : sheetHeight === 'mid'
        ? 'h-[54%]'
        : 'h-[126px]';

  const polygonSvgPoints = computedVertices.map((v) => `${v.sx},${v.sy}`).join(' ');

  return (
    <div className="min-h-[100dvh] w-full bg-[#050914] text-[#dae2fd] flex flex-col items-center justify-start sm:justify-center sm:py-4 sm:px-4">
      {/* Top Preview Mode Control Bar (for testing on PC or full mobile) */}
      <div className="w-full max-w-[960px] mb-0 sm:mb-3 px-3 py-2 bg-[#0b1326]/95 border-b sm:border border-[#222a3d] sm:rounded-2xl flex flex-wrap items-center justify-between gap-2 z-50">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-[#4cd7f6]/15 border border-[#4cd7f6]/30 font-mono text-[10px] font-bold text-[#4cd7f6] uppercase">
            STITCH PREVIEW
          </span>
          <span className="text-xs font-semibold text-[#dae2fd]">
            GeoGIS6 Android — Interfaz Táctica Móvil
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setCanvasEngine((prev) => (prev === 'stitch' ? 'openlayers' : 'stitch'))
            }
            className={cn(
              'px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold border transition-colors flex items-center gap-1.5',
              canvasEngine === 'openlayers'
                ? 'bg-[#4edea3]/15 border-[#4edea3]/40 text-[#4edea3]'
                : 'bg-[#171f33] border-[#2d3449] text-[#bcc9cd] hover:text-white'
            )}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>
              {canvasEngine === 'stitch' ? 'Ver OpenLayers Real' : 'Ver Stitch HUD'}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setViewportMode((prev) => (prev === 'frame' ? 'fullscreen' : 'frame'))
            }
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold bg-[#171f33] border border-[#2d3449] text-[#4cd7f6] hover:bg-[#222a3d] transition-colors"
          >
            {viewportMode === 'frame' ? (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Pantalla Completa</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5" />
                <span>Marco Celular (390×844)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Android Device Shell (Phone frame on desktop or 100dvh fullscreen) */}
      <div
        className={cn(
          'relative bg-[#0b1326] text-[#dae2fd] flex flex-col overflow-hidden select-none shadow-2xl',
          viewportMode === 'frame'
            ? 'w-full sm:w-[390px] h-[calc(100dvh-48px)] sm:h-[812px] sm:rounded-[34px] sm:border-[6px] sm:border-[#1e293b] sm:ring-1 sm:ring-[#4cd7f6]/25'
            : 'w-full max-w-[1100px] h-[calc(100dvh-68px)] sm:rounded-2xl border border-[#222a3d]'
        )}
      >
        {/* 1. COMPACT ANDROID HEADER & RTK TELEMETRY TRAY */}
        <header className="shrink-0 bg-[#0b1326]/95 backdrop-blur-xl border-b border-[#222a3d] z-30">
          {/* Android Status Strip */}
          <div className="h-6 px-3.5 flex items-center justify-between font-mono text-[10px] text-[#bcc9cd] bg-[#060e20]">
            <span className="font-semibold text-[#dae2fd]">GeoGIS6 Mobile · v6.0</span>
            <div className="flex items-center gap-2">
              <span className="text-[#4cd7f6] font-bold">5G+</span>
              <span className="flex items-center gap-0.5 text-[#4edea3] font-bold">
                <BatteryCharging className="w-3.5 h-3.5" />
                94%
              </span>
            </div>
          </div>

          {/* Primary Top HUD Row */}
          <div className="h-12 px-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#4edea3]/15 border border-[#4edea3]/30 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4edea3] animate-pulse" />
                <span className="font-mono text-[9px] font-bold text-[#4edea3] uppercase">
                  RTK FIX
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#dae2fd] truncate leading-tight">
                  PARCELA-09B · Adícora
                </div>
                <div className="font-mono text-[9px] text-[#869397] truncate">
                  RMS H:0.008m V:0.012m
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setDirection((d) =>
                  d === 'canoa_regven' ? 'regven_canoa' : 'canoa_regven'
                )
              }
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#171f33] border border-[#2d3449] active:scale-95 transition-transform shrink-0"
              title="Cambiar dirección de transformación"
            >
              <ArrowLeftRight className="w-3 h-3 text-[#ffb95f]" />
              <span className="font-mono text-[9px] font-bold text-[#4cd7f6]">
                {direction === 'canoa_regven' ? 'PSAD56➔REGVEN' : 'REGVEN➔PSAD56'}
              </span>
            </button>
          </div>

          {/* Ultra-Compact Telemetry Strip */}
          <div className="px-3 py-1.5 bg-[#060e20] border-t border-[#171f33] flex items-center justify-between gap-1.5 font-mono text-[9px]">
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#171f33]">
              <span className="text-[#4edea3] font-bold uppercase">
                {method === 'rigida02' ? 'RIGIDA02' : method === 'badekas' ? 'BADEKAS' : 'IDW'}
              </span>
              <span className="text-[#869397]">•</span>
              <span className="text-[#4cd7f6] font-bold">{huso}N</span>
            </div>

            <div className="flex items-center gap-1 text-[#dae2fd]">
              <Satellite className="w-3 h-3 text-[#4cd7f6]" />
              <span>SV 28/32</span>
            </div>

            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#171f33]">
              <span className="text-[#ffb95f] font-bold">PDOP</span>
              <span className="text-[#dae2fd] font-bold">0.82</span>
            </div>

            <button
              type="button"
              onClick={handleCycleLayer}
              className="px-1.5 py-0.5 rounded bg-[#222a3d] text-[#4cd7f6] font-bold uppercase truncate max-w-[96px]"
            >
              {LAYER_LABELS[layerMode]}
            </button>
          </div>
        </header>

        {/* 2. MAIN SURVEY MAP CANVAS VIEWPORT */}
        <div className="relative flex-1 w-full bg-[#060e20] overflow-hidden">
          {canvasEngine === 'openlayers' ? (
            <MapViewer className="w-full h-full" />
          ) : (
            <div className="relative w-full h-full overflow-hidden">
              {/* Layer Backdrop Styling */}
              <div
                className={cn(
                  'absolute inset-0 transition-opacity duration-300',
                  layerMode === 'satellite' &&
                    'bg-[radial-gradient(circle_at_30%_25%,#1e3a2f_0%,#0b1d28_45%,#060e20_100%)] opacity-85',
                  layerMode === 'hybrid' &&
                    'bg-[radial-gradient(circle_at_60%_30%,#143040_0%,#0b1326_65%,#060e20_100%)] opacity-90',
                  layerMode === 'dtm' &&
                    'bg-[radial-gradient(circle_at_45%_45%,#2c1f10_0%,#131b2e_55%,#060e20_100%)] opacity-90',
                  layerMode === 'catastro' && 'bg-[#060e20]'
                )}
              />

              {/* Precision UTM Grid & Survey Polygon SVG */}
              <svg
                viewBox="0 0 360 440"
                preserveAspectRatio="xMidYMid slice"
                className="absolute inset-0 w-full h-full"
              >
                <defs>
                  <pattern id="utm-grid-android" width="60" height="60" patternUnits="userSpaceOnUse">
                    <path
                      d="M 60 0 L 0 0 0 60"
                      fill="none"
                      stroke="#3d494c"
                      strokeOpacity="0.35"
                      strokeDasharray="3 3"
                      strokeWidth="0.8"
                    />
                    <circle cx="0" cy="0" r="1.4" fill="#4cd7f6" fillOpacity="0.5" />
                  </pattern>
                  <linearGradient id="poly-fill-android" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#4edea3" stopOpacity="0.1" />
                  </linearGradient>
                </defs>

                <rect width="360" height="440" fill="url(#utm-grid-android)" />

                {/* Topographic Contour Accents in DTM / Hybrid modes */}
                {(layerMode === 'dtm' || layerMode === 'hybrid') && (
                  <g fill="none" stroke="#ffb95f" strokeOpacity="0.24" strokeWidth="1">
                    <path d="M-20 90 C 90 45, 220 130, 380 70" />
                    <path d="M-20 165 C 110 115, 240 190, 380 140" />
                    <path d="M-20 265 C 100 225, 230 300, 380 245" />
                  </g>
                )}

                {/* Closed Cadastral Parcel Polygon */}
                <polygon
                  points={polygonSvgPoints}
                  fill="url(#poly-fill-android)"
                  stroke="#4cd7f6"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />

                {/* Base Line Reference */}
                <line
                  x1={computedVertices[computedVertices.length - 1]?.sx ?? 55}
                  y1={computedVertices[computedVertices.length - 1]?.sy ?? 245}
                  x2={24}
                  y2={375}
                  stroke="#ffb95f"
                  strokeWidth="1.2"
                  strokeDasharray="4 3"
                  strokeOpacity="0.7"
                />

                {/* Interactive Vertices */}
                {computedVertices.map((v, idx) => {
                  const isActive = v.id === selectedVertex.id;
                  const isRover = idx === computedVertices.length - 1;
                  return (
                    <g
                      key={v.id}
                      onClick={() => setSelectedVertexId(v.id)}
                      className="cursor-pointer"
                    >
                      {isRover && (
                        <>
                          <circle
                            cx={v.sx}
                            cy={v.sy}
                            r="16"
                            fill="#4cd7f6"
                            fillOpacity="0.16"
                          />
                          <path
                            d={`M ${v.sx - 11} ${v.sy} L ${v.sx + 11} ${v.sy} M ${v.sx} ${v.sy - 11} L ${v.sx} ${v.sy + 11}`}
                            stroke="#4cd7f6"
                            strokeWidth="1.3"
                          />
                        </>
                      )}
                      <circle
                        cx={v.sx}
                        cy={v.sy}
                        r={isActive ? 8 : 6}
                        fill={isActive ? '#4edea3' : '#4cd7f6'}
                        fillOpacity="0.3"
                      />
                      <circle
                        cx={v.sx}
                        cy={v.sy}
                        r={isActive ? 5 : 4}
                        fill="#0b1326"
                        stroke={isActive ? '#4edea3' : '#4cd7f6'}
                        strokeWidth="2"
                      />
                      <rect
                        x={v.sx + 8}
                        y={v.sy - 12}
                        width={isRover ? 56 : 34}
                        height="16"
                        rx="3"
                        fill={isActive ? '#4cd7f6' : '#171f33'}
                      />
                      <text
                        x={v.sx + 12}
                        y={v.sy - 1}
                        fill={isActive ? '#003640' : '#4cd7f6'}
                        fontSize="9"
                        fontWeight="700"
                        fontFamily="monospace"
                      >
                        {isRover ? `${v.id} [EST]` : v.id}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Top-Left UTM Grid Coordinates Pill */}
              <div className="absolute top-2.5 left-2.5 px-2 py-1 rounded bg-[#060e20]/85 border border-[#222a3d] font-mono text-[9px] text-[#bcc9cd] pointer-events-none">
                N: {selectedVertex?.outNorte.toFixed(3)} · E: {selectedVertex?.outEste.toFixed(3)}
              </div>

              {/* Compass HUD */}
              <div className="absolute top-2.5 right-16 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#131b2e]/90 border border-[#222a3d] backdrop-blur-md">
                <Navigation className="w-3.5 h-3.5 text-[#ffb95f] -rotate-12" />
                <div className="leading-none">
                  <div className="font-mono text-[9px] font-bold text-[#ffb95f]">AZ 012°28&apos;W</div>
                  <div className="font-mono text-[8px] text-[#bcc9cd]">NORTE GEOD</div>
                </div>
              </div>

              {/* Central Parcel Summary Pill */}
              <div className="absolute top-14 left-3 max-w-[190px] px-3 py-2 rounded-xl bg-[#171f33]/90 border border-[#4cd7f6]/25 backdrop-blur-md shadow-xl">
                <div className="flex items-center gap-1 mb-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#4cd7f6]" />
                  <span className="font-mono text-[9px] font-bold text-[#4cd7f6] uppercase tracking-wider">
                    PARCELA-09B
                  </span>
                </div>
                <div className="text-sm font-bold text-[#dae2fd] leading-tight tabular-nums">
                  {geom.area.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  m²
                </div>
                <div className="font-mono text-[9px] text-[#4edea3] mt-0.5 tabular-nums">
                  {(geom.area / 10000).toFixed(4)} ha · Per: {geom.perim.toFixed(2)} m
                </div>
              </div>

              {/* Scale Bar */}
              <div className="absolute bottom-[138px] left-3 flex flex-col gap-0.5 pointer-events-none">
                <div className="w-16 h-1 bg-[#bcc9cd]/70 rounded-full flex justify-between">
                  <div className="w-1.5 h-1.5 bg-[#4cd7f6] rounded-full" />
                  <div className="w-1.5 h-1.5 bg-[#4cd7f6] rounded-full" />
                </div>
                <span className="font-mono text-[8px] text-[#bcc9cd] font-bold">
                  25 m · ESC 1:1,000
                </span>
              </div>
            </div>
          )}

          {/* Right-Edge Ergonomic Thumb-Zone FAB Column */}
          <div className="absolute top-12 right-2.5 z-20 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={handleCapturePoint}
              className="w-13 h-13 rounded-full bg-[#4cd7f6] hover:bg-[#acedff] active:scale-95 text-[#003640] shadow-xl shadow-[#4cd7f6]/25 flex flex-col items-center justify-center transition-all"
              title="Capturar vértice RTK"
            >
              <Plus className="w-5 h-5 stroke-[2.6]" />
              <span className="font-mono text-[8px] font-extrabold uppercase leading-none">
                GRABAR
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedVertexId(computedVertices[computedVertices.length - 1]?.id || 'V-05');
                centerOnAll();
                toast.success('Centrado en estación rover activa');
              }}
              className="w-10 h-10 rounded-full bg-[#171f33]/95 border border-[#2d3449] text-[#4cd7f6] hover:bg-[#222a3d] active:scale-90 shadow-lg flex items-center justify-center"
              title="Centrar Rover GPS"
            >
              <Crosshair className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => toast.success(`Nivel Electrónico IMU: ${imuTilt} (En tolerancia)`)}
              className="w-10 h-10 rounded-full bg-[#171f33]/95 border border-[#2d3449] text-[#4edea3] hover:bg-[#222a3d] active:scale-90 shadow-lg flex flex-col items-center justify-center"
              title="Nivel IMU Digital"
            >
              <Compass className="w-3.5 h-3.5" />
              <span className="font-mono text-[8px] font-bold leading-none mt-0.5">{imuTilt}</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab('vertices')}
              className="w-10 h-10 rounded-full bg-[#171f33]/95 border border-[#2d3449] text-[#dae2fd] hover:text-[#4cd7f6] hover:bg-[#222a3d] active:scale-90 shadow-lg flex items-center justify-center"
              title="Medir Poligonal"
            >
              <Ruler className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleCycleLayer}
              className="w-10 h-10 rounded-full bg-[#171f33]/95 border border-[#2d3449] text-[#dae2fd] hover:text-[#4cd7f6] hover:bg-[#222a3d] active:scale-90 shadow-lg flex items-center justify-center"
              title="Cambiar Capa Cartográfica"
            >
              <Layers className="w-4 h-4" />
            </button>
          </div>

          {/* 3. PULL-UP TOUCH BOTTOM SHEET (3 SNAP HEIGHTS) */}
          <div
            className={cn(
              'absolute inset-x-0 bottom-16 z-30 bg-[#131b2e]/97 backdrop-blur-2xl border-t border-[#2d3449] rounded-t-2xl shadow-[0_-10px_30px_rgba(0,0,0,0.65)] transition-all duration-300 flex flex-col',
              sheetHeightClass
            )}
          >
            {/* Grab Handle + Compact Station Banner */}
            <button
              type="button"
              onClick={handleCycleSheetHeight}
              className="w-full shrink-0 px-3.5 pt-2 pb-2 flex flex-col items-center border-b border-[#222a3d] text-left"
            >
              <div className="w-10 h-1 rounded-full bg-[#869397]/45 mb-2" />
              <div className="w-full flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-[#4edea3] shrink-0" />
                  <span className="font-mono text-xs font-bold text-[#4cd7f6] truncate">
                    {selectedVertex?.id} [ROVER EST]
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#4edea3]/15 font-mono text-[9px] font-bold text-[#4edea3] shrink-0">
                    {computedVertices.length} pts
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono text-[10px] text-[#bcc9cd] tabular-nums">
                    {selectedVertex?.outEste.toFixed(1)}E · {selectedVertex?.outNorte.toFixed(1)}N
                  </span>
                  {sheetHeight === 'full' ? (
                    <ChevronDown className="w-4 h-4 text-[#4cd7f6]" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-[#4cd7f6]" />
                  )}
                </div>
              </div>
            </button>

            {/* Quick Inner Tabs + Scrollable Body */}
            {sheetHeight !== 'peek' && (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="shrink-0 px-3 pt-2 pb-1.5 flex items-center gap-1.5 bg-[#0b1326]/70">
                  {(
                    [
                      { id: 'vertices', label: `Vértices (${computedVertices.length})` },
                      { id: 'qaqc', label: 'Motor QA/QC' },
                      { id: 'export', label: 'Exportar CAD' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={cn(
                        'flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors',
                        activeTab === item.id
                          ? 'bg-[#222a3d] text-[#4cd7f6] font-bold shadow-sm'
                          : 'text-[#bcc9cd] hover:bg-[#171f33]'
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-3">
                  {/* TAB: VERTICES */}
                  {(activeTab === 'vertices' || activeTab === 'map') && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2.5 rounded-xl bg-[#171f33] border border-[#222a3d]">
                          <span className="font-mono text-[9px] text-[#869397] uppercase block">
                            SUPERFICIE
                          </span>
                          <span className="font-mono text-sm font-bold text-[#4edea3] tabular-nums">
                            {geom.area.toFixed(2)} m²
                          </span>
                          <span className="font-mono text-[9px] text-[#bcc9cd] block">
                            {(geom.area / 10000).toFixed(4)} ha
                          </span>
                        </div>
                        <div className="p-2.5 rounded-xl bg-[#171f33] border border-[#222a3d]">
                          <span className="font-mono text-[9px] text-[#869397] uppercase block">
                            PERÍMETRO &amp; CIERRE
                          </span>
                          <span className="font-mono text-sm font-bold text-[#4cd7f6] tabular-nums">
                            {geom.perim.toFixed(2)} m
                          </span>
                          <span className="font-mono text-[9px] text-[#4edea3] block">
                            Error: 0.003 m · 1:114,556
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleCapturePoint}
                        className="w-full py-2.5 px-3 rounded-xl bg-[#4cd7f6] hover:bg-[#acedff] active:scale-[0.99] text-[#003640] font-bold text-xs flex items-center justify-center gap-1.5"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Capturar / Agregar Nuevo Vértice RTK</span>
                      </button>

                      <div className="space-y-2">
                        {computedVertices.map((v) => {
                          const isSelected = v.id === selectedVertex.id;
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => setSelectedVertexId(v.id)}
                              className={cn(
                                'w-full text-left p-2.5 rounded-xl border transition-colors',
                                isSelected
                                  ? 'bg-[#222a3d] border-[#4cd7f6]/50'
                                  : 'bg-[#171f33]/80 border-[#222a3d] hover:bg-[#171f33]'
                              )}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      'w-2 h-2 rounded-full',
                                      isSelected ? 'bg-[#4edea3]' : 'bg-[#4cd7f6]'
                                    )}
                                  />
                                  <span className="font-mono text-xs font-bold text-[#4cd7f6]">
                                    {v.id}
                                  </span>
                                  <span className="font-mono text-[10px] text-[#ffb95f]">
                                    {v.rumbo} · {v.dist.toFixed(2)}m
                                  </span>
                                </div>
                                <span className="px-1.5 py-0.5 rounded bg-[#4edea3]/15 font-mono text-[9px] font-bold text-[#4edea3]">
                                  FIXED ±{v.rms.toFixed(3)}m
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-1.5 bg-[#060e20] p-2 rounded-lg font-mono text-[11px] tabular-nums">
                                <div>
                                  <span className="text-[8px] text-[#869397] block">ESTE (X)</span>
                                  <span className="text-[#dae2fd] font-bold">
                                    {v.outEste.toFixed(3)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[8px] text-[#869397] block">NORTE (Y)</span>
                                  <span className="text-[#dae2fd] font-bold">
                                    {v.outNorte.toFixed(3)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[8px] text-[#869397] block">COTA (Z)</span>
                                  <span className="text-[#ffb95f] font-bold">
                                    {v.outCota.toFixed(3)} m
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* TAB: MOTOR QA/QC */}
                  {activeTab === 'qaqc' && (
                    <div className="space-y-3">
                      <div className="p-3 rounded-xl bg-[#171f33] border border-[#222a3d] space-y-2.5">
                        <div className="text-[10px] font-mono font-bold text-[#869397] uppercase">
                          Dirección de Transformación
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 bg-[#060e20] p-1 rounded-xl">
                          <button
                            type="button"
                            onClick={() => setDirection('canoa_regven')}
                            className={cn(
                              'py-2 px-2 rounded-lg font-mono text-[10px] font-bold',
                              direction === 'canoa_regven'
                                ? 'bg-[#4cd7f6] text-[#003640]'
                                : 'text-[#bcc9cd]'
                            )}
                          >
                            PSAD56 ➔ REGVEN
                          </button>
                          <button
                            type="button"
                            onClick={() => setDirection('regven_canoa')}
                            className={cn(
                              'py-2 px-2 rounded-lg font-mono text-[10px] font-bold',
                              direction === 'regven_canoa'
                                ? 'bg-[#4cd7f6] text-[#003640]'
                                : 'text-[#bcc9cd]'
                            )}
                          >
                            REGVEN ➔ PSAD56
                          </button>
                        </div>

                        <div className="text-[10px] font-mono font-bold text-[#869397] uppercase pt-1">
                          Motor Geodésico
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 bg-[#060e20] p-1 rounded-xl">
                          {(
                            [
                              { id: 'rigida02', label: 'RIGIDA02' },
                              { id: 'badekas', label: 'Badekas 3D' },
                              { id: 'rigida', label: 'Rígida IDW' },
                            ] as const
                          ).map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setMethod(m.id)}
                              className={cn(
                                'py-2 rounded-lg font-mono text-[10px] font-bold',
                                method === m.id
                                  ? 'bg-[#4edea3] text-[#003824]'
                                  : 'text-[#bcc9cd]'
                              )}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>

                        <div className="text-[10px] font-mono font-bold text-[#869397] uppercase pt-1">
                          Huso UTM Venezuela
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[18, 19, 20, 21].map((h) => (
                            <button
                              key={h}
                              type="button"
                              onClick={() => setHuso(h)}
                              className={cn(
                                'py-1.5 rounded-lg font-mono text-xs font-bold border',
                                huso === h
                                  ? 'bg-[#4cd7f6]/20 border-[#4cd7f6] text-[#4cd7f6]'
                                  : 'bg-[#060e20] border-[#222a3d] text-[#bcc9cd]'
                              )}
                            >
                              {h}N
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-[#171f33] border border-[#4edea3]/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] font-bold text-[#4edea3] uppercase">
                            Dictamen QA/QC IGVSB
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#4edea3]/15 font-mono text-[9px] font-bold text-[#4edea3]">
                            INVARIANCIA ≤ 0.001 m
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 bg-[#060e20] p-2 rounded-lg font-mono text-[10px] tabular-nums">
                          <div>
                            <span className="text-[#869397] block text-[8px]">ΔX / ΔE</span>
                            <span className="text-[#4cd7f6] font-bold">
                              {method === 'rigida02'
                                ? `${GeoEngine.RIGIDA02_DELTA_ESTE.toFixed(3)}m`
                                : `${PATVEN98.dx.toFixed(2)}m`}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#869397] block text-[8px]">ΔY / ΔN</span>
                            <span className="text-[#4cd7f6] font-bold">
                              {method === 'rigida02'
                                ? `${GeoEngine.RIGIDA02_DELTA_NORTE.toFixed(3)}m`
                                : `+${PATVEN98.dy.toFixed(2)}m`}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#869397] block text-[8px]">ΔZ / GEOID</span>
                            <span className="text-[#ffb95f] font-bold">
                              {method === 'rigida02'
                                ? `${GeoEngine.RIGIDA02_COTA_GEOIDAL.toFixed(2)}m`
                                : `${PATVEN98.dz.toFixed(2)}m`}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleVerifyQaqc}
                          className="w-full py-2 rounded-lg bg-[#222a3d] hover:bg-[#31394d] text-[#4cd7f6] font-mono text-[11px] font-bold flex items-center justify-center gap-1.5"
                        >
                          <ShieldCheck className="w-4 h-4 text-[#4edea3]" />
                          <span>Verificar Rigidez · {qaqcTimestamp}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* TAB: EXPORTAR CAD */}
                  {activeTab === 'export' && (
                    <div className="space-y-2.5">
                      <button
                        type="button"
                        onClick={handleExportDxf}
                        className="w-full p-3 rounded-xl bg-[#4cd7f6] hover:bg-[#acedff] text-[#003640] flex items-center justify-between transition-colors"
                      >
                        <div className="flex items-center gap-2.5 text-left">
                          <FileCode2 className="w-5 h-5 shrink-0" />
                          <div>
                            <div className="text-xs font-bold">Descargar .DXF (CivilCAD v2024)</div>
                            <div className="text-[10px] opacity-80">
                              Capas poligonal, vértices y cuadro UTM
                            </div>
                          </div>
                        </div>
                        <Download className="w-4 h-4 shrink-0" />
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyCivilCad}
                        className="w-full p-3 rounded-xl bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-[#dae2fd] flex items-center justify-between transition-colors"
                      >
                        <div className="flex items-center gap-2.5 text-left">
                          <FileSpreadsheet className="w-5 h-5 text-[#4edea3] shrink-0" />
                          <div>
                            <div className="text-xs font-bold">Copiar CivilCAD (P,E,N,Z,D)</div>
                            <div className="text-[10px] text-[#bcc9cd]">
                              Formato texto listo para cartera topográfica
                            </div>
                          </div>
                        </div>
                        <Copy className="w-4 h-4 text-[#4edea3] shrink-0" />
                      </button>

                      <button
                        type="button"
                        onClick={handleExportKml}
                        className="w-full p-3 rounded-xl bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-[#dae2fd] flex items-center justify-between transition-colors"
                      >
                        <div className="flex items-center gap-2.5 text-left">
                          <MapIcon className="w-5 h-5 text-[#4cd7f6] shrink-0" />
                          <div>
                            <div className="text-xs font-bold">Exportar .KML Google Earth</div>
                            <div className="text-[10px] text-[#bcc9cd]">
                              Poligonal proyectada a WGS84 geográfica
                            </div>
                          </div>
                        </div>
                        <Download className="w-4 h-4 text-[#4cd7f6] shrink-0" />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          toast.success('Memoria Descriptiva R-2024 lista para impresión catastral')
                        }
                        className="w-full p-3 rounded-xl bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-[#dae2fd] flex items-center justify-between transition-colors"
                      >
                        <div className="flex items-center gap-2.5 text-left">
                          <FileText className="w-5 h-5 text-[#ffb95f] shrink-0" />
                          <div>
                            <div className="text-xs font-bold">Memoria Descriptiva PDF</div>
                            <div className="text-[10px] text-[#bcc9cd]">
                              Modelo Catastro R-2024 · Área y Linderos
                            </div>
                          </div>
                        </div>
                        <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded bg-[#ffb95f]/20 text-[#ffb95f]">
                          R-2024
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 4. NATIVE ANDROID BOTTOM NAVIGATION BAR */}
        <nav className="h-16 shrink-0 bg-[#060e20]/95 backdrop-blur-xl border-t border-[#171f33] z-40 flex items-center justify-around px-2">
          {(
            [
              { id: 'map', label: 'Mapa', icon: MapIcon },
              { id: 'vertices', label: 'Vértices', icon: SlidersHorizontal },
              { id: 'qaqc', label: 'QA/QC', icon: ShieldCheck },
              { id: 'export', label: 'Exportar', icon: Download },
            ] as const
          ).map((navItem) => {
            const Icon = navItem.icon;
            const isActive = activeTab === navItem.id;
            return (
              <button
                key={navItem.id}
                type="button"
                onClick={() => handleSelectTab(navItem.id)}
                className={cn(
                  'flex flex-col items-center justify-center min-w-[64px] h-12 transition-colors',
                  isActive ? 'text-[#4cd7f6] font-bold' : 'text-[#bcc9cd] hover:text-white'
                )}
              >
                <div
                  className={cn(
                    'flex items-center justify-center w-9 h-6 rounded-full transition-colors',
                    isActive && 'bg-[#4cd7f6]/15'
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider mt-0.5">
                  {navItem.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
