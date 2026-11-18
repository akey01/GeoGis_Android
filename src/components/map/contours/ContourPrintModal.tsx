/**
 * ContourPrintModal.tsx — Modal de Previsualización e Impresión del Plano de Curvas de Nivel
 * GeoGIS6
 *
 * Renderiza mediante React Portal en document.body una lámina técnica Topográfica-Altimétrica
 * en formato Horizontal (Landscape) lista para imprimir o guardar como PDF, con:
 *  - Ortofoto satelital compuesta (Google / Esri) registrada 1:1 en proyección UTM o modo Blanco CAD.
 *  - Curvas maestras e intermedias recortadas estrictamente al polígono con etiquetas orientadas.
 *  - Grilla UTM métrica con cruces y coordenadas en los bordes, rosa náutica y barra de escala gráfica.
 *  - Cuadro altimétrico (Zmin, Zmax, ΔH, pendiente media, clasificación de relieve), cuadro de vértices y cajetín.
 */

'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Printer,
  Download,
  Satellite,
  FileSpreadsheet,
  Mountain,
  Tag,
  Loader2,
  Compass,
  Grid3x3,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'react-hot-toast';
import { useAppStore } from '@/lib/store';
import { hasPermission, isDemoRole } from '@/src/types/auth';
import { useContourStore } from './useContourStore';
import {
  calculatePolygonSurface,
  exportParcelContoursDXF,
  isCanoaOutputDirection,
  SATELLITE_DEM_WARNING,
  utmToWebMercator,
  type ParcelContourData,
} from './contourEngine';

type SheetTheme = 'satellite' | 'cad';
type GridStepChoice = 'auto' | 10 | 20 | 25 | 50 | 100 | 200 | 500;
const GRID_STEP_OPTIONS: readonly (10 | 20 | 25 | 50 | 100 | 200 | 500)[] = [
  10, 20, 25, 50, 100, 200, 500,
];
type SatProvider = 'esri' | 'google';

const INTERVAL_CHOICES = [0.25, 0.5, 1, 2, 5, 10] as const;

const SVG_W = 940;
const SVG_H = 660;
const FRAME_PAD_L = 56;
const FRAME_PAD_R = 24;
const FRAME_PAD_T = 28;
const FRAME_PAD_B = 44;
const DRAW_W = SVG_W - FRAME_PAD_L - FRAME_PAD_R;
const DRAW_H = SVG_H - FRAME_PAD_T - FRAME_PAD_B;

const MERCATOR_HALF_WORLD = 20037508.342789244;

function pickNiceStep(span: number, targetTicks: number): number {
  const rough = span / Math.max(1, targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(0.01, rough))));
  const norm = rough / mag;
  if (norm <= 1.2) return 1 * mag;
  if (norm <= 2.2) return 2 * mag;
  if (norm <= 5.5) return 5 * mag;
  return 10 * mag;
}

function loadTileImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 6500);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function getTileUrl(provider: SatProvider, z: number, tx: number, ty: number): string {
  if (provider === 'esri') {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
  }
  const host = (tx + ty) & 3;
  return `https://mt${host}.google.com/vt/lyrs=s&hl=es&x=${tx}&y=${ty}&z=${z}`;
}

/**
 * Compone un mosaico satelital Web Mercator registrado exactamente con el frame UTM del plano.
 */
async function renderSatelliteMosaicDataUrl(
  viewMinE: number,
  viewMaxE: number,
  viewMinN: number,
  viewMaxN: number,
  huso: number,
  direction: string,
  satOffset: { dE: number; dN: number },
  provider: SatProvider
): Promise<string | null> {
  const offE = satOffset.dE || 0;
  const offN = satOffset.dN || 0;

  // Esquinas del área de dibujo desplazadas inversamente si el usuario calibró la ortofoto
  const mTL = utmToWebMercator(viewMinE - offE, viewMaxN - offN, huso, direction);
  const mTR = utmToWebMercator(viewMaxE - offE, viewMaxN - offN, huso, direction);
  const mBL = utmToWebMercator(viewMinE - offE, viewMinN - offN, huso, direction);
  const mBR = utmToWebMercator(viewMaxE - offE, viewMinN - offN, huso, direction);

  const minMX = Math.min(mTL[0], mTR[0], mBL[0], mBR[0]);
  const maxMX = Math.max(mTL[0], mTR[0], mBL[0], mBR[0]);
  const minMY = Math.min(mTL[1], mTR[1], mBL[1], mBR[1]);
  const maxMY = Math.max(mTL[1], mTR[1], mBL[1], mBR[1]);

  const spanMX = Math.max(10, maxMX - minMX);
  const rawZoom = Math.log2((2 * MERCATOR_HALF_WORLD * (DRAW_W / 256)) / spanMX);
  const maxProviderZoom = provider === 'esri' ? 18 : 19;
  const z = Math.max(11, Math.min(maxProviderZoom, Math.round(rawZoom)));

  const nTiles = Math.pow(2, z);
  const tileWorldSpan = (2 * MERCATOR_HALF_WORLD) / nTiles;

  const txMin = Math.max(0, Math.floor((minMX + MERCATOR_HALF_WORLD) / tileWorldSpan));
  const txMax = Math.min(nTiles - 1, Math.floor((maxMX + MERCATOR_HALF_WORLD) / tileWorldSpan));
  const tyMin = Math.max(0, Math.floor((MERCATOR_HALF_WORLD - maxMY) / tileWorldSpan));
  const tyMax = Math.min(nTiles - 1, Math.floor((MERCATOR_HALF_WORLD - minMY) / tileWorldSpan));

  // Limitar total de teselas por seguridad (máx 7x6)
  if ((txMax - txMin + 1) * (tyMax - tyMin + 1) > 49) {
    return null;
  }

  const tileTasks: Array<{ tx: number; ty: number; url: string }> = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      tileTasks.push({ tx, ty, url: getTileUrl(provider, z, tx, ty) });
    }
  }

  const imgs = await Promise.all(tileTasks.map((t) => loadTileImage(t.url)));
  if (imgs.every((i) => !i)) return null;

  const canvas = document.createElement('canvas');
  canvas.width = DRAW_W;
  canvas.height = DRAW_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, DRAW_W, DRAW_H);

  // Transformación afín exacta (Mercator EPSG:3857) -> Canvas Pixel (DRAW_W x DRAW_H)
  const dx1 = mTR[0] - mTL[0];
  const dy1 = mTR[1] - mTL[1];
  const dx2 = mBL[0] - mTL[0];
  const dy2 = mBL[1] - mTL[1];
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-6) return null;

  const inv00 = (dy2 / det) * DRAW_W;
  const inv01 = (-dx2 / det) * DRAW_W;
  const inv10 = (-dy1 / det) * DRAW_H;
  const inv11 = (dx1 / det) * DRAW_H;
  const txOff = -(inv00 * mTL[0] + inv01 * mTL[1]);
  const tyOff = -(inv10 * mTL[0] + inv11 * mTL[1]);

  ctx.save();
  ctx.setTransform(inv00, inv10, inv01, inv11, txOff, tyOff);

  tileTasks.forEach((task, idx) => {
    const img = imgs[idx];
    if (!img) return;
    const tileMinMX = -MERCATOR_HALF_WORLD + task.tx * tileWorldSpan;
    const tileMaxMY = MERCATOR_HALF_WORLD - task.ty * tileWorldSpan;
    // Altura negativa en coordenadas de mundo porque +my apunta al Norte y canvas Y apunta abajo
    ctx.drawImage(img, 0, 0, 256, 256, tileMinMX, tileMaxMY, tileWorldSpan, -tileWorldSpan);
  });

  ctx.restore();

  try {
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
}

export default function ContourPrintModal() {
  const printModalParcelId = useContourStore((s) => s.printModalParcelId);
  const contoursByParcelId = useContourStore((s) => s.contoursByParcelId);
  const setParcelInterval = useContourStore((s) => s.setParcelInterval);
  const closePrintModal = useContourStore((s) => s.closePrintModal);
  const satOffset = useContourStore((s) => s.satOffset);

  const savedParcels = useAppStore((s) => s.savedParcels);
  const projectMeta = useAppStore((s) => s.projectMeta);
  const user = useAppStore((s) => s.user);

  const isDemo = Boolean(user?.rol) && isDemoRole(user?.rol);
  const canPrint = user ? hasPermission(user.rol, 'print_view', user?.roleConfig?.capabilities) : true;
  const canExportDxf = user ? hasPermission(user.rol, 'export_dxf', user?.roleConfig?.capabilities) : true;

  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<SheetTheme>(isDemo ? 'cad' : 'satellite');
  const [satProvider, setSatProvider] = useState<SatProvider>('google');
  const [showIntermediateLabels, setShowIntermediateLabels] = useState(false);
  const [showVertexZ, setShowVertexZ] = useState(true);
  const [showDemGrid, setShowDemGrid] = useState(true);
  const [gridStepOverride, setGridStepOverride] = useState<GridStepChoice>('auto');
  const [satDataUrl, setSatDataUrl] = useState<string | null>(null);
  const [loadingSat, setLoadingSat] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const data: ParcelContourData | null = printModalParcelId
    ? contoursByParcelId[printModalParcelId] ?? null
    : null;

  const parcelMeta = useMemo(
    () => (printModalParcelId ? savedParcels.find((p) => p.id === printModalParcelId) : undefined),
    [printModalParcelId, savedParcels]
  );

  // Calcular ventana UTM isométrica exacta para el cuadro de dibujo del SVG
  const viewport = useMemo(() => {
    if (!data) return null;
    const [pMinE, pMinN, pMaxE, pMaxN] = data.bboxUTM;
    const rawW = Math.max(10, pMaxE - pMinE);
    const rawH = Math.max(10, pMaxN - pMinN);

    const padFactor = 1.24;
    const targetW = rawW * padFactor;
    const targetH = rawH * padFactor;

    const scale = Math.min(DRAW_W / targetW, DRAW_H / targetH);
    const viewSpanE = DRAW_W / scale;
    const viewSpanN = DRAW_H / scale;

    const cE = (pMinE + pMaxE) * 0.5;
    const cN = (pMinN + pMaxN) * 0.5;

    const viewMinE = cE - viewSpanE * 0.5;
    const viewMaxE = cE + viewSpanE * 0.5;
    const viewMinN = cN - viewSpanN * 0.5;
    const viewMaxN = cN + viewSpanN * 0.5;

    const toSvg = (e: number, n: number): [number, number] => [
      FRAME_PAD_L + (e - viewMinE) * scale,
      FRAME_PAD_T + (viewMaxN - n) * scale,
    ];

    const gridStep = pickNiceStep(Math.max(viewSpanE, viewSpanN), 5);
    const firstE = Math.ceil(viewMinE / gridStep) * gridStep;
    const gridEs: number[] = [];
    for (let e = firstE; e <= viewMaxE; e += gridStep) gridEs.push(e);

    const firstN = Math.ceil(viewMinN / gridStep) * gridStep;
    const gridNs: number[] = [];
    for (let n = firstN; n <= viewMaxN; n += gridStep) gridNs.push(n);

    // Barra de escala gráfica (~120–190 px SVG)
    const desiredBarMeters = 155 / scale;
    const barMeters = pickNiceStep(desiredBarMeters, 1);
    const barPx = barMeters * scale;

    // Escala numérica aproximada en hoja A4/Carta horizontal (el marco de dibujo ocupa ~185 mm reales en papel)
    const approxPaperMeters = 0.185;
    const rawScaleDenom = viewSpanE / approxPaperMeters;
    const niceScaleDenom = Math.max(50, Math.round(rawScaleDenom / 50) * 50);

    return {
      viewMinE,
      viewMaxE,
      viewMinN,
      viewMaxN,
      viewSpanE,
      viewSpanN,
      scale,
      toSvg,
      gridEs,
      gridNs,
      barMeters,
      barPx,
      niceScaleDenom,
    };
  }, [data]);

  // Cuadrícula UTM configurable de forma independiente para no re-descargar la ortofoto satelital
  const utmGrid = useMemo(() => {
    if (!viewport) return null;
    const autoStep = pickNiceStep(Math.max(viewport.viewSpanE, viewport.viewSpanN), 5);
    const gridStep = gridStepOverride === 'auto' ? autoStep : gridStepOverride;

    const firstE = Math.ceil(viewport.viewMinE / gridStep) * gridStep;
    const gridEs: number[] = [];
    for (let e = firstE; e <= viewport.viewMaxE && gridEs.length < 48; e += gridStep) {
      gridEs.push(e);
    }

    const firstN = Math.ceil(viewport.viewMinN / gridStep) * gridStep;
    const gridNs: number[] = [];
    for (let n = firstN; n <= viewport.viewMaxN && gridNs.length < 48; n += gridStep) {
      gridNs.push(n);
    }

    return { gridStep, autoStep, gridEs, gridNs };
  }, [viewport, gridStepOverride]);

  const demSpacingE = data
    ? data.gridSpacingE ??
      Number(((data.rawGrid.maxE - data.rawGrid.minE) / Math.max(1, data.gridCols - 1)).toFixed(2))
    : 0;
  const demSpacingN = data
    ? data.gridSpacingN ??
      Number(((data.rawGrid.maxN - data.rawGrid.minN) / Math.max(1, data.gridRows - 1)).toFixed(2))
    : 0;

  // Descargar mosaico satelital cuando cambia parcela, proveedor o tema
  useEffect(() => {
    if (!printModalParcelId || !data || !viewport || theme !== 'satellite') {
      setSatDataUrl(null);
      setLoadingSat(false);
      return;
    }

    let cancelled = false;
    setLoadingSat(true);

    (async () => {
      let url = await renderSatelliteMosaicDataUrl(
        viewport.viewMinE,
        viewport.viewMaxE,
        viewport.viewMinN,
        viewport.viewMaxN,
        data.huso,
        data.direction,
        satOffset,
        satProvider
      );

      // Reintento automático con proveedor alternativo si el primero falló o fue bloqueado por CORS
      if (!url && !cancelled) {
        const fallbackProvider: SatProvider = satProvider === 'google' ? 'esri' : 'google';
        url = await renderSatelliteMosaicDataUrl(
          viewport.viewMinE,
          viewport.viewMaxE,
          viewport.viewMinN,
          viewport.viewMaxN,
          data.huso,
          data.direction,
          satOffset,
          fallbackProvider
        );
      }

      if (!cancelled) {
        setSatDataUrl(url);
        setLoadingSat(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [printModalParcelId, data, viewport, theme, satProvider, satOffset]);

  const handlePrint = useCallback(() => {
    if (isDemo || !canPrint) {
      toast.error('Impresión deshabilitada en Modo DEMO.');
      return;
    }
    window.print();
  }, [isDemo, canPrint]);

  const handleDownloadDxf = useCallback(() => {
    if (!data) return;
    if (isDemo || !canExportDxf) {
      toast.error('Exportación DXF 3D deshabilitada para su rol.');
      return;
    }
    exportParcelContoursDXF(data);
    toast.success('Plano DXF 3D de curvas descargado');
  }, [data, isDemo, canExportDxf]);

  if (!mounted || !printModalParcelId || !data || !viewport) return null;

  const isSat = theme === 'satellite';
  const datumLabel = isCanoaOutputDirection(data.direction)
    ? `PSAD-56 / La Canoa (EPSG:248${data.huso})`
    : `REGVEN SIRGAS GRS80 (EPSG:220${data.huso - 17})`;

  const polyPointsAttr = data.polygonUTM
    .map(([e, n]) => {
      const [sx, sy] = viewport.toSvg(e, n);
      return `${sx.toFixed(1)},${sy.toFixed(1)}`;
    })
    .join(' ');

  const surface = calculatePolygonSurface(data.polygonUTM);

  const areaM2 =
    surface.areaM2 > 0
      ? surface.areaM2
      : data.areaM2 > 0
        ? data.areaM2
        : Number(parcelMeta?.area) > 0
          ? Number(parcelMeta?.area)
          : 0;
  const areaHa = areaM2 / 10000;

  const perimM =
    surface.perimeterM > 0
      ? surface.perimeterM
      : data.perimeterM > 0
        ? data.perimeterM
        : Number(parcelMeta?.perim) > 0
          ? Number(parcelMeta?.perim)
          : 0;

  const maxTableVertices = 14;
  const visibleVertices = data.vertices.slice(0, maxTableVertices);
  const hiddenVertexCount = Math.max(0, data.vertices.length - maxTableVertices);

  const activeGridStep =
    utmGrid?.gridStep ?? pickNiceStep(Math.max(viewport.viewSpanE, viewport.viewSpanN), 5);
  const activeGridEs = utmGrid?.gridEs ?? viewport.gridEs;
  const activeGridNs = utmGrid?.gridNs ?? viewport.gridNs;
  const clippedGridLines = data.clippedGridLinesUTM ?? [];
  const interiorNodes = data.interiorGridNodes ?? [];
  const minCellSvgPx = Math.min(demSpacingE * viewport.scale, demSpacingN * viewport.scale);
  const labelAllNodes = minCellSvgPx >= 24;

  const modalContent = (
    <div
      id="contour-print-overlay"
      className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-md flex flex-col overflow-hidden print:static print:bg-white print:p-0 print:overflow-visible"
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                size: landscape;
                margin: 6mm;
              }
              html, body {
                background: #ffffff !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: visible !important;
                height: auto !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              body > *:not(#contour-print-overlay) {
                display: none !important;
              }
              #contour-print-overlay {
                position: static !important;
                inset: auto !important;
                background: #ffffff !important;
                display: block !important;
                width: 100% !important;
                height: auto !important;
                overflow: visible !important;
              }
              #contour-print-sheet {
                width: 100% !important;
                max-width: none !important;
                box-shadow: none !important;
                border: 1.5px solid #0f172a !important;
                margin: 0 !important;
              }
            }
          `,
        }}
      />

      {/* ── Barra Superior de Controles (Oculta al imprimir) ───────────────── */}
      <div className="shrink-0 bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Mountain className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider truncate">
              GeoGIS6 · Plano Topográfico de Curvas de Nivel · {data.parcelName}
            </h2>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              {datumLabel} · {data.demSource}
            </p>
          </div>
        </div>

        {/* Opciones de Personalización */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Modo de Fondo */}
          <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setTheme('satellite')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition-colors',
                theme === 'satellite'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              <Satellite className="w-3 h-3" />
              Satélite
            </button>
            <button
              onClick={() => setTheme('cad')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition-colors',
                theme === 'cad'
                  ? 'bg-slate-200 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              <FileSpreadsheet className="w-3 h-3" />
              Blanco CAD
            </button>
          </div>

          {/* Proveedor Satelital */}
          {theme === 'satellite' && (
            <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setSatProvider('google')}
                className={cn(
                  'px-2 py-1 rounded-md text-[10px] font-bold transition-colors',
                  satProvider === 'google' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                )}
              >
                Google
              </button>
              <button
                onClick={() => setSatProvider('esri')}
                className={cn(
                  'px-2 py-1 rounded-md text-[10px] font-bold transition-colors',
                  satProvider === 'esri' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                )}
              >
                Esri
              </button>
            </div>
          )}

          {/* Equidistancia */}
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
            <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">ΔZ:</span>
            {INTERVAL_CHOICES.map((iv) => {
              const isBelowSatFloor = data.sourceType === 'SATELLITE_DEM' && iv < 1;
              return (
                <button
                  key={iv}
                  onClick={() => setParcelInterval(data.parcelId, iv)}
                  title={
                    isBelowSatFloor
                      ? `Equidistancia ${iv} m (anteproyecto referencial satelital)`
                      : `Equidistancia ${iv} m`
                  }
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors',
                    data.interval === iv
                      ? 'bg-amber-500 text-slate-950'
                      : isBelowSatFloor
                        ? 'text-amber-400/60 hover:text-amber-300 hover:bg-slate-800'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                >
                  {iv}m
                </button>
              );
            })}
          </div>

          {/* Etiquetas */}
          <button
            onClick={() => setShowIntermediateLabels((v) => !v)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors',
              showIntermediateLabels
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            )}
            title="Mostrar cotas también en curvas intermedias"
          >
            <Tag className="w-3 h-3" />
            Cotas Int.
          </button>

          <button
            onClick={() => setShowVertexZ((v) => !v)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors',
              showVertexZ
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            )}
            title="Mostrar rótulos de vértices sobre el dibujo"
          >
            Vértices
          </button>

          {/* Cuadrícula DEM interna */}
          <button
            onClick={() => setShowDemGrid((v) => !v)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors',
              showDemGrid
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            )}
            title="Mostrar/ocultar cuadrícula de muestreo DEM (ΔE × ΔN) y cotas internas"
          >
            <Grid3x3 className="w-3 h-3" />
            Malla DEM
          </button>

          {/* Paso de cuadrícula UTM */}
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
            <span className="text-[9px] font-bold text-slate-400 uppercase">Grilla UTM:</span>
            <select
              value={String(gridStepOverride)}
              onChange={(e) => {
                const val = e.target.value;
                setGridStepOverride(val === 'auto' ? 'auto' : (Number(val) as GridStepChoice));
              }}
              className="bg-transparent text-[10px] font-mono font-bold text-cyan-300 outline-none cursor-pointer"
              title="Separación métrica de la cuadrícula UTM del plano"
            >
              <option value="auto" className="bg-slate-900 text-slate-200">
                Auto ({utmGrid?.autoStep ?? activeGridStep}m)
              </option>
              {GRID_STEP_OPTIONS.map((step) => (
                <option key={step} value={String(step)} className="bg-slate-900 text-slate-200">
                  c/{step}m
                </option>
              ))}
            </select>
          </div>

          {/* Exportar DXF 3D */}
          <button
            onClick={handleDownloadDxf}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-bold uppercase tracking-wider transition-colors"
            title="Descargar curvas de nivel 3D en AutoCAD (.dxf)"
          >
            <Download className="w-3.5 h-3.5" />
            DXF 3D
          </button>

          {/* Botón Imprimir / PDF */}
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-extrabold uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir / PDF
          </button>

          <button
            onClick={closePrintModal}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Cerrar vista previa"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Lienzo Scrollable con la Lámina Imprimible ─────────────────────── */}
      <div className="flex-1 overflow-auto p-4 md:p-6 flex items-start justify-center print:p-0 print:overflow-visible">
        <div
          id="contour-print-sheet"
          className="w-full max-w-[1220px] bg-white text-slate-900 border-2 border-slate-900 shadow-2xl grid grid-cols-1 lg:grid-cols-[1fr_290px] print:grid-cols-[1fr_260px]"
        >
          {/* ── COLUMNA IZQUIERDA: MAPA DE CURVAS + GRILLA UTM ─────────────── */}
          <div className="relative border-b lg:border-b-0 lg:border-r-2 border-slate-900 bg-white flex flex-col">
            {loadingSat && (
              <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/85 text-amber-300 text-[10px] font-bold shadow print:hidden">
                <Loader2 className="w-3 h-3 animate-spin" />
                Cargando ortofoto satelital...
              </div>
            )}

            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="w-full h-auto block select-none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <clipPath id="contour-draw-clip">
                  <rect x={FRAME_PAD_L} y={FRAME_PAD_T} width={DRAW_W} height={DRAW_H} />
                </clipPath>
              </defs>

              {/* Fondo completo del marco */}
              <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#ffffff" />

              {/* Área interna del mapa */}
              <g clipPath="url(#contour-draw-clip)">
                <rect
                  x={FRAME_PAD_L}
                  y={FRAME_PAD_T}
                  width={DRAW_W}
                  height={DRAW_H}
                  fill={isSat ? '#0f172a' : '#ffffff'}
                />

                {/* Imagen satelital registrada 1:1 en UTM */}
                {isSat && satDataUrl && (
                  <image
                    href={satDataUrl}
                    x={FRAME_PAD_L}
                    y={FRAME_PAD_T}
                    width={DRAW_W}
                    height={DRAW_H}
                    preserveAspectRatio="none"
                  />
                )}

                {/* Leve viñeta oscura sobre satélite para máximo contraste de curvas */}
                {isSat && (
                  <rect
                    x={FRAME_PAD_L}
                    y={FRAME_PAD_T}
                    width={DRAW_W}
                    height={DRAW_H}
                    fill="rgba(2, 6, 23, 0.14)"
                  />
                )}

                {/* Líneas internas de Grilla UTM */}
                {activeGridEs.map((ge) => {
                  const [gx] = viewport.toSvg(ge, viewport.viewMinN);
                  return (
                    <line
                      key={`ge-${ge}`}
                      x1={gx}
                      y1={FRAME_PAD_T}
                      x2={gx}
                      y2={FRAME_PAD_T + DRAW_H}
                      stroke={isSat ? 'rgba(255,255,255,0.42)' : '#94a3b8'}
                      strokeWidth={isSat ? 0.8 : 0.75}
                      strokeDasharray={isSat ? '5 4' : '3 3'}
                    />
                  );
                })}
                {activeGridNs.map((gn) => {
                  const [, gy] = viewport.toSvg(viewport.viewMinE, gn);
                  return (
                    <line
                      key={`gn-${gn}`}
                      x1={FRAME_PAD_L}
                      y1={gy}
                      x2={FRAME_PAD_L + DRAW_W}
                      y2={gy}
                      stroke={isSat ? 'rgba(255,255,255,0.42)' : '#94a3b8'}
                      strokeWidth={isSat ? 0.8 : 0.75}
                      strokeDasharray={isSat ? '5 4' : '3 3'}
                    />
                  );
                })}

                {/* Cruces cartográficas (+) en las intersecciones de Grilla UTM */}
                {activeGridEs.map((ge) =>
                  activeGridNs.map((gn) => {
                    const [gx, gy] = viewport.toSvg(ge, gn);
                    return (
                      <g key={`gx-${ge}-${gn}`}>
                        <line
                          x1={gx - 3.5}
                          y1={gy}
                          x2={gx + 3.5}
                          y2={gy}
                          stroke={isSat ? 'rgba(255,255,255,0.75)' : '#475569'}
                          strokeWidth={0.9}
                        />
                        <line
                          x1={gx}
                          y1={gy - 3.5}
                          x2={gx}
                          y2={gy + 3.5}
                          stroke={isSat ? 'rgba(255,255,255,0.75)' : '#475569'}
                          strokeWidth={0.9}
                        />
                      </g>
                    );
                  })
                )}

                {/* Relleno translúcido del polígono */}
                <polygon
                  points={polyPointsAttr}
                  fill={isSat ? 'rgba(16, 185, 129, 0.10)' : 'rgba(16, 185, 129, 0.05)'}
                  stroke="none"
                />

                {/* Malla DEM interna (ΔE × ΔN) recortada estrictamente al polígono */}
                {showDemGrid &&
                  clippedGridLines.map((gl, idx) => {
                    const ptsAttr = gl.coordsUTM
                      .map(([e, n]) => {
                        const [sx, sy] = viewport.toSvg(e, n);
                        return `${sx.toFixed(1)},${sy.toFixed(1)}`;
                      })
                      .join(' ');
                    return (
                      <polyline
                        key={`dgl-${idx}`}
                        points={ptsAttr}
                        fill="none"
                        stroke={isSat ? '#6ee7b7' : '#059669'}
                        strokeWidth={isSat ? 0.85 : 0.75}
                        strokeOpacity={isSat ? 0.82 : 0.7}
                        strokeDasharray="3 3"
                      />
                    );
                  })}

                {/* Nodos internos de muestreo DEM con cota Z */}
                {showDemGrid &&
                  interiorNodes.map((gn, idx) => {
                    const [sx, sy] = viewport.toSvg(gn.este, gn.norte);
                    const showLabel = labelAllNodes || (gn.row + gn.col) % 2 === 0;
                    return (
                      <g key={`dgn-${idx}`}>
                        <line
                          x1={sx - 2.2}
                          y1={sy}
                          x2={sx + 2.2}
                          y2={sy}
                          stroke={isSat ? '#a7f3d0' : '#047857'}
                          strokeWidth={0.85}
                        />
                        <line
                          x1={sx}
                          y1={sy - 2.2}
                          x2={sx}
                          y2={sy + 2.2}
                          stroke={isSat ? '#a7f3d0' : '#047857'}
                          strokeWidth={0.85}
                        />
                        {showLabel && (
                          <text
                            x={sx + 3}
                            y={sy - 2.5}
                            fontFamily="ui-monospace, monospace"
                            fontSize={6.5}
                            fontWeight="bold"
                            fill={isSat ? '#d1fae5' : '#065f46'}
                            stroke={isSat ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.92)'}
                            strokeWidth={2}
                            paintOrder="stroke"
                            strokeLinejoin="round"
                          >
                            {gn.z.toFixed(1)}
                          </text>
                        )}
                      </g>
                    );
                  })}

                {/* Curvas Intermedias */}
                {data.contours
                  .filter((c) => !c.isMaster)
                  .map((c, idx) => {
                    const isDense = data.contours.length > 20;
                    const ptsAttr = c.coordsUTM
                      .map(([e, n]) => {
                        const [sx, sy] = viewport.toSvg(e, n);
                        return `${sx.toFixed(1)},${sy.toFixed(1)}`;
                      })
                      .join(' ');
                    return (
                      <polyline
                        key={`ci-${idx}`}
                        points={ptsAttr}
                        fill="none"
                        stroke={isSat ? '#38bdf8' : '#d97706'}
                        strokeWidth={isDense ? 0.85 : isSat ? 1.1 : 0.95}
                        strokeOpacity={isSat ? 0.9 : 0.85}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}

                {/* Curvas Maestras */}
                {data.contours
                  .filter((c) => c.isMaster)
                  .map((c, idx) => {
                    const isDense = data.contours.length > 20;
                    const ptsAttr = c.coordsUTM
                      .map(([e, n]) => {
                        const [sx, sy] = viewport.toSvg(e, n);
                        return `${sx.toFixed(1)},${sy.toFixed(1)}`;
                      })
                      .join(' ');
                    return (
                      <g key={`cm-${idx}`}>
                        {isSat && (
                          <polyline
                            points={ptsAttr}
                            fill="none"
                            stroke="rgba(15,23,42,0.75)"
                            strokeWidth={isDense ? 2.5 : 3.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                        <polyline
                          points={ptsAttr}
                          fill="none"
                          stroke={isSat ? '#f59e0b' : '#9a3412'}
                          strokeWidth={isDense ? 1.6 : 2.0}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>
                    );
                  })}

                {/* Etiquetas sobre Curvas (Maestras y opcionalmente Intermedias) */}
                {data.contours.map((c, idx) => {
                  if (!c.labelPointUTM) return null;
                  if (!c.isMaster && !showIntermediateLabels) return null;
                  const [lx, ly] = viewport.toSvg(c.labelPointUTM[0], c.labelPointUTM[1]);
                  // Convertir ángulo UTM (+E derecha, +N arriba) a rotación SVG (+X derecha, +Y abajo)
                  let deg = -((c.labelAngleRad ?? 0) * 180) / Math.PI;
                  if (deg > 90) deg -= 180;
                  if (deg < -90) deg += 180;
                  const textStr = c.elevation % 1 === 0 ? c.elevation.toFixed(0) : c.elevation.toFixed(1);

                  return (
                    <text
                      key={`lbl-${idx}`}
                      x={lx}
                      y={ly}
                      transform={`rotate(${deg.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})`}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      fontSize={c.isMaster ? 9.5 : 8}
                      fontWeight={c.isMaster ? 'bold' : 'normal'}
                      fill={isSat ? (c.isMaster ? '#fef3c7' : '#e0f2fe') : c.isMaster ? '#7c2d12' : '#b45309'}
                      stroke={isSat ? '#0f172a' : '#ffffff'}
                      strokeWidth={c.isMaster ? 3.2 : 2.5}
                      paintOrder="stroke"
                    >
                      {textStr}
                    </text>
                  );
                })}

                {/* Poligonal / Lindero de la Parcela */}
                <polygon
                  points={polyPointsAttr}
                  fill="none"
                  stroke={isSat ? '#10b981' : '#0f172a'}
                  strokeWidth={2.4}
                  strokeLinejoin="round"
                />

                {/* Cotas extremas (Mínima y Máxima dentro del predio) */}
                {(() => {
                  const [minX, minY] = viewport.toSvg(data.minPointUTM.este, data.minPointUTM.norte);
                  const [maxX, maxY] = viewport.toSvg(data.maxPointUTM.este, data.maxPointUTM.norte);
                  return (
                    <>
                      <g transform={`translate(${minX}, ${minY})`}>
                        <circle r={4} fill="#0284c7" stroke="#ffffff" strokeWidth={1.5} />
                        <text
                          x={6}
                          y={3}
                          fontFamily="ui-monospace, monospace"
                          fontSize={9}
                          fontWeight="bold"
                          fill={isSat ? '#7dd3fc' : '#0369a1'}
                          stroke={isSat ? '#0f172a' : '#ffffff'}
                          strokeWidth={3}
                          paintOrder="stroke"
                        >
                          {`▼ Zmin ${data.minZ.toFixed(1)}m`}
                        </text>
                      </g>
                      <g transform={`translate(${maxX}, ${maxY})`}>
                        <circle r={4} fill="#059669" stroke="#ffffff" strokeWidth={1.5} />
                        <text
                          x={6}
                          y={-4}
                          fontFamily="ui-monospace, monospace"
                          fontSize={9}
                          fontWeight="bold"
                          fill={isSat ? '#6ee7b7' : '#047857'}
                          stroke={isSat ? '#0f172a' : '#ffffff'}
                          strokeWidth={3}
                          paintOrder="stroke"
                        >
                          {`▲ Zmax ${data.maxZ.toFixed(1)}m`}
                        </text>
                      </g>
                    </>
                  );
                })()}

                {/* Vértices de la parcela */}
                {data.vertices.map((v) => {
                  const [vx, vy] = viewport.toSvg(v.este, v.norte);
                  return (
                    <g key={v.id} transform={`translate(${vx}, ${vy})`}>
                      <circle
                        r={3.2}
                        fill={isSat ? '#ffffff' : '#10b981'}
                        stroke="#0f172a"
                        strokeWidth={1.3}
                      />
                      {showVertexZ && (
                        <text
                          x={5}
                          y={-4}
                          fontFamily="ui-monospace, monospace"
                          fontSize={8.5}
                          fontWeight="bold"
                          fill={isSat ? '#ffffff' : '#0f172a'}
                          stroke={isSat ? '#0f172a' : '#ffffff'}
                          strokeWidth={2.8}
                          paintOrder="stroke"
                        >
                          {v.id}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>

              {/* Marco exterior del plano */}
              <rect
                x={FRAME_PAD_L}
                y={FRAME_PAD_T}
                width={DRAW_W}
                height={DRAW_H}
                fill="none"
                stroke="#0f172a"
                strokeWidth={1.6}
              />

              {/* Coordenadas UTM en los márgenes (Este abajo/arriba y Norte izquierda/derecha) */}
              {activeGridEs.map((ge) => {
                const [gx] = viewport.toSvg(ge, viewport.viewMinN);
                return (
                  <g key={`tick-e-${ge}`}>
                    <line
                      x1={gx}
                      y1={FRAME_PAD_T}
                      x2={gx}
                      y2={FRAME_PAD_T + 4}
                      stroke="#0f172a"
                      strokeWidth={1}
                    />
                    <line
                      x1={gx}
                      y1={FRAME_PAD_T + DRAW_H}
                      x2={gx}
                      y2={FRAME_PAD_T + DRAW_H + 5}
                      stroke="#0f172a"
                      strokeWidth={1}
                    />
                    <text
                      x={gx}
                      y={FRAME_PAD_T + DRAW_H + 17}
                      textAnchor="middle"
                      fontFamily="ui-monospace, monospace"
                      fontSize={9}
                      fill="#1e293b"
                    >
                      {`${Math.round(ge).toLocaleString('en-US')} E`}
                    </text>
                  </g>
                );
              })}

              {activeGridNs.map((gn) => {
                const [, gy] = viewport.toSvg(viewport.viewMinE, gn);
                return (
                  <g key={`tick-n-${gn}`}>
                    <line
                      x1={FRAME_PAD_L - 5}
                      y1={gy}
                      x2={FRAME_PAD_L}
                      y2={gy}
                      stroke="#0f172a"
                      strokeWidth={1}
                    />
                    <line
                      x1={FRAME_PAD_L + DRAW_W - 4}
                      y1={gy}
                      x2={FRAME_PAD_L + DRAW_W}
                      y2={gy}
                      stroke="#0f172a"
                      strokeWidth={1}
                    />
                    <text
                      x={FRAME_PAD_L - 8}
                      y={gy}
                      textAnchor="end"
                      dominantBaseline="central"
                      transform={`rotate(-90 ${(FRAME_PAD_L - 12).toFixed(1)} ${gy.toFixed(1)})`}
                      fontFamily="ui-monospace, monospace"
                      fontSize={8.5}
                      fill="#1e293b"
                    >
                      {`${Math.round(gn).toLocaleString('en-US')}`}
                    </text>
                  </g>
                );
              })}

              {/* Etiqueta superior del sistema de referencia */}
              <text
                x={FRAME_PAD_L + 4}
                y={FRAME_PAD_T - 9}
                fontFamily="system-ui, sans-serif"
                fontSize={10}
                fontWeight="bold"
                fill="#0f172a"
              >
                {`PLANO TOPOGRÁFICO DE CURVAS DE NIVEL · HUSO ${data.huso}N · EQUIDISTANCIA ΔZ = ${data.interval} m`}
              </text>

              {/* Tarjeta de separación de cuadrículas (esquina superior izquierda dentro del marco) */}
              <g transform={`translate(${FRAME_PAD_L + 10}, ${FRAME_PAD_T + 10})`}>
                <rect
                  x={0}
                  y={0}
                  width={265}
                  height={showDemGrid ? 32 : 18}
                  rx={4}
                  fill="rgba(255,255,255,0.9)"
                  stroke="#0f172a"
                  strokeWidth={0.8}
                />
                <text
                  x={7}
                  y={12}
                  fontFamily="ui-monospace, monospace"
                  fontSize={8.5}
                  fontWeight="bold"
                  fill="#0f172a"
                >
                  {`GRILLA UTM: cada ${activeGridStep} m`}
                </text>
                {showDemGrid && (
                  <text
                    x={7}
                    y={25}
                    fontFamily="ui-monospace, monospace"
                    fontSize={8.2}
                    fontWeight="bold"
                    fill="#047857"
                  >
                    {`MALLA DEM (${data.gridCols}×${data.gridRows}): ΔE ${demSpacingE.toFixed(1)}m × ΔN ${demSpacingN.toFixed(1)}m`}
                  </text>
                )}
              </g>

              {/* Rosa de los Vientos / Norte UTM (esquina superior derecha dentro del marco) */}
              <g transform={`translate(${FRAME_PAD_L + DRAW_W - 36}, ${FRAME_PAD_T + 38})`}>
                <circle r={20} fill="rgba(255,255,255,0.88)" stroke="#0f172a" strokeWidth={1.2} />
                <polygon points="0,-15 -5,3 0,-1 5,3" fill="#0f172a" />
                <polygon points="0,14 -3,3 0,6 3,3" fill="#64748b" />
                <text
                  x={0}
                  y={-17}
                  textAnchor="middle"
                  fontFamily="system-ui, sans-serif"
                  fontSize={9}
                  fontWeight="bold"
                  fill="#0f172a"
                >
                  N
                </text>
              </g>

              {/* Barra de Escala Gráfica (esquina inferior izquierda del marco) */}
              <g transform={`translate(${FRAME_PAD_L + 16}, ${FRAME_PAD_T + DRAW_H - 34})`}>
                <rect
                  x={-8}
                  y={-12}
                  width={Math.max(105, viewport.barPx + 24)}
                  height={34}
                  rx={4}
                  fill="rgba(255,255,255,0.92)"
                  stroke="#0f172a"
                  strokeWidth={0.9}
                />
                <text x={0} y={-2} fontFamily="system-ui, sans-serif" fontSize={8} fontWeight="bold" fill="#0f172a">
                  {`ESCALA GRÁFICA (Aprox. 1 : ${viewport.niceScaleDenom.toLocaleString('en-US')})`}
                </text>
                <rect x={0} y={4} width={viewport.barPx * 0.5} height={6} fill="#0f172a" stroke="#0f172a" strokeWidth={0.8} />
                <rect x={viewport.barPx * 0.5} y={4} width={viewport.barPx * 0.5} height={6} fill="#ffffff" stroke="#0f172a" strokeWidth={0.8} />
                <text x={0} y={18} fontFamily="ui-monospace, monospace" fontSize={7.5} fill="#0f172a">0</text>
                <text x={viewport.barPx * 0.5} y={18} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={7.5} fill="#0f172a">
                  {(viewport.barMeters * 0.5).toFixed(viewport.barMeters < 10 ? 1 : 0)}
                </text>
                <text x={viewport.barPx} y={18} textAnchor="end" fontFamily="ui-monospace, monospace" fontSize={7.5} fontWeight="bold" fill="#0f172a">
                  {`${viewport.barMeters} m`}
                </text>
              </g>
            </svg>
          </div>

          {/* ── COLUMNA DERECHA: RESUMEN ALTIMÉTRICO, VÉRTICES Y CAJETÍN ─────── */}
          <div className="flex flex-col text-[10px] leading-tight bg-white text-slate-900">
            {/* Encabezado Cajetín */}
            <div className="p-2.5 border-b-2 border-slate-900 bg-slate-100">
              <div className="text-[8px] font-bold uppercase tracking-widest text-slate-600">
                GeoGIS6 · Altimetría Satelital
              </div>
              <div className="text-sm font-black uppercase text-slate-900 truncate mt-0.5">
                {data.parcelName}
              </div>
              <div className="text-[9px] text-slate-700 font-semibold truncate">
                Proyecto: {projectMeta.nombre || 'SIN TÍTULO'}
              </div>
              {parcelMeta?.propietario && (
                <div className="text-[9px] text-slate-700 truncate">
                  Propietario: <span className="font-bold">{parcelMeta.propietario}</span>
                </div>
              )}
              {(parcelMeta?.municipio || parcelMeta?.estado) && (
                <div className="text-[9px] text-slate-600 truncate">
                  {[parcelMeta.ubicacionSector, parcelMeta.parroquia, parcelMeta.municipio, parcelMeta.estado]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
            </div>

            {/* Datos Superficie */}
            <div className="grid grid-cols-3 border-b border-slate-300 text-center bg-slate-50">
              <div className="p-1.5 border-r border-slate-300">
                <div className="text-[8px] font-bold text-slate-500 uppercase">Área (m²)</div>
                <div className="font-mono font-bold text-[10px]">
                  {areaM2.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-1.5 border-r border-slate-300">
                <div className="text-[8px] font-bold text-slate-500 uppercase">Hectáreas</div>
                <div className="font-mono font-bold text-[10px]">
                  {areaHa.toFixed(4)} ha
                </div>
              </div>
              <div className="p-1.5">
                <div className="text-[8px] font-bold text-slate-500 uppercase">Perímetro</div>
                <div className="font-mono font-bold text-[10px]">
                  {perimM.toFixed(2)} m
                </div>
              </div>
            </div>

            {/* Resumen Topográfico y Altimétrico */}
            <div className="p-2.5 border-b border-slate-900 space-y-1.5">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1">
                <Mountain className="w-3 h-3 text-amber-700" />
                Resumen Altimétrico del Predio
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[9.5px]">
                <div className="flex justify-between border-b border-slate-200 pb-0.5">
                  <span className="text-slate-600 font-sans">Cota Mín:</span>
                  <span className="font-bold text-sky-800">{data.minZ.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-0.5">
                  <span className="text-slate-600 font-sans">Cota Máx:</span>
                  <span className="font-bold text-emerald-800">{data.maxZ.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-0.5">
                  <span className="text-slate-600 font-sans">Desnivel ΔH:</span>
                  <span className="font-bold text-amber-800">{data.deltaH.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-0.5">
                  <span className="text-slate-600 font-sans">Cota Media:</span>
                  <span className="font-bold">{data.meanZ.toFixed(2)} m</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-0.5">
                  <span className="text-slate-600 font-sans">Pend. Media:</span>
                  <span className="font-bold">{data.meanSlopePct.toFixed(1)} %</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-0.5">
                  <span className="text-slate-600 font-sans">Equid. ΔZ:</span>
                  <span className="font-bold">{data.interval} m</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-0.5">
                  <span className="text-slate-600 font-sans">Grilla UTM:</span>
                  <span className="font-bold text-slate-900">c/{activeGridStep} m</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-0.5">
                  <span className="text-slate-600 font-sans">Nodos Int.:</span>
                  <span className="font-bold text-emerald-800">{interiorNodes.length} ptos</span>
                </div>
              </div>
              <div className="text-[9px] font-mono bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-emerald-950 flex items-center justify-between">
                <span className="font-sans font-semibold">Malla DEM ({data.gridCols}×{data.gridRows}):</span>
                <span className="font-bold">{demSpacingE.toFixed(1)}×{demSpacingN.toFixed(1)} m</span>
              </div>
              <div className="text-[9px] font-semibold bg-amber-50 border border-amber-200 rounded px-2 py-1 text-amber-950">
                Relieve: <span className="font-bold">{data.reliefClass}</span>
              </div>
              {(data.uncertaintyWarning || data.sourceType === 'SATELLITE_DEM') && (
                <div className="text-[8.5px] font-extrabold bg-amber-100 border border-amber-500 rounded px-2 py-1 text-amber-950 flex items-start gap-1.5 leading-tight">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                  <span>{data.uncertaintyWarning || SATELLITE_DEM_WARNING}</span>
                </div>
              )}
            </div>

            {/* Leyenda Gráfica */}
            <div className="px-2.5 py-2 border-b border-slate-900 space-y-1 bg-slate-50/70">
              <div className="text-[8.5px] font-extrabold uppercase tracking-wider text-slate-700">Leyenda</div>
              <div className="grid grid-cols-2 gap-1 text-[8.5px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-5 h-[2.5px] inline-block" style={{ backgroundColor: isSat ? '#f59e0b' : '#9a3412' }} />
                  <span>Maestra (c/{data.masterInterval}m)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-5 h-[1.3px] inline-block" style={{ backgroundColor: isSat ? '#38bdf8' : '#d97706' }} />
                  <span>Intermedia (c/{data.interval}m)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-5 h-[2.5px] inline-block" style={{ backgroundColor: isSat ? '#10b981' : '#0f172a' }} />
                  <span>Lindero Poligonal</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-5 h-[1.5px] inline-block border-t border-dashed"
                    style={{ borderColor: isSat ? '#6ee7b7' : '#059669' }}
                  />
                  <span>Malla DEM ({demSpacingE.toFixed(1)}×{demSpacingN.toFixed(1)}m)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-5 h-[1.5px] inline-block border-t border-dashed border-slate-500" />
                  <span>Grilla UTM (c/{activeGridStep}m)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Compass className="w-3 h-3 text-slate-700" />
                  <span>Huso UTM {data.huso}N</span>
                </div>
              </div>
            </div>

            {/* Tabla de Coordenadas con Cota Satelital */}
            <div className="flex-1 p-2 overflow-hidden flex flex-col">
              <div className="text-[8.5px] font-extrabold uppercase tracking-wider text-slate-700 mb-1">
                Cuadro de Coordenadas UTM y Cotas
              </div>
              <table className="w-full text-[8.5px] font-mono border-collapse border border-slate-400">
                <thead>
                  <tr className="bg-slate-200 text-slate-900">
                    <th className="border border-slate-400 px-1 py-0.5 text-left">Pto</th>
                    <th className="border border-slate-400 px-1 py-0.5 text-right">Este (X)</th>
                    <th className="border border-slate-400 px-1 py-0.5 text-right">Norte (Y)</th>
                    <th className="border border-slate-400 px-1 py-0.5 text-right">Cota Z</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleVertices.map((v) => (
                    <tr key={v.id} className="odd:bg-white even:bg-slate-50">
                      <td className="border border-slate-300 px-1 py-0.5 font-bold">{v.id}</td>
                      <td className="border border-slate-300 px-1 py-0.5 text-right">{v.este.toFixed(2)}</td>
                      <td className="border border-slate-300 px-1 py-0.5 text-right">{v.norte.toFixed(2)}</td>
                      <td className="border border-slate-300 px-1 py-0.5 text-right font-bold">{v.z.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hiddenVertexCount > 0 && (
                <div className="text-[8px] text-slate-500 italic mt-1">
                  + {hiddenVertexCount} vértices adicionales incluidos en exportación DXF 3D.
                </div>
              )}
            </div>

            {/* Pie del Cajetín */}
            <div className="mt-auto p-2 border-t-2 border-slate-900 bg-slate-100 text-[8.5px] space-y-0.5">
              <div className="flex justify-between">
                <span className="font-bold">DATUM:</span>
                <span className="font-mono">{datumLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">FUENTE ELEV.:</span>
                <span>{data.demSource}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-bold">PROFESIONAL:</span>
                <span className="truncate max-w-[160px]">{parcelMeta?.profesional || 'ING. TOPÓGRAFO / GEODESTA'}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>FECHA: {new Date(data.computedAt).toLocaleDateString('es-VE')}</span>
                <span>
                  Malla {data.gridCols}×{data.gridRows}
                  {data.denseGridCols ? ` (4×: ${data.denseGridCols}×${data.denseGridRows})` : ' pts'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
