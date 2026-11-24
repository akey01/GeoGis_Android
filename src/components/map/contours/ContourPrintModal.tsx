/**
 * ContourPrintModal.tsx — Plano Único Oficial Venezolano (ISO A3 Horizontal · 3 Cuerpos IGVSB/LGCCN)
 * GeoGIS6
 *
 * Unifica en un solo formato reglamentario tanto para DXF como para PDF/Impresión:
 *  - Cuerpo Izquierdo (49%): Área Gráfica UTM (Blanco CAD o Ortofoto Satelital), Grilla UTM en bordes
 *    superior/izquierdo, Poligonal oficial con cotas, Curvas de Nivel maestras/intermedias (opcionales),
 *    Malla Altimétrica IGVSB, Cuadro de Datos Generales y Escala Gráfica.
 *  - Cuerpo Central (31%): Cuadro de Construcción Catastral Adaptativo en 3 Niveles (Balance de Superficie,
 *    Punto de Apoyo REGVEN, Rumbos, Distancias, Coordenadas UTM y Cota Z) + Resumen Altimétrico y Leyenda.
 *    Para polígonos >38 vértices genera automáticamente una Hoja 2 (Anexo de Cuadro de Construcción) en PDF.
 *  - Cuerpo Derecho (20%): Membrete Reglamentario Venezolano (Título, Ubicación, Registro Documental,
 *    Antecedentes, Croquis de Ubicación Local 1:5.000, Zonificación, Rosa Náutica, Propietario, Profesional C.I.V.
 *    y bloques de revisión/registro catastral).
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
  Grid3x3,
  AlertTriangle,
  FileDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'react-hot-toast';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useAppStore, type Parcel } from '@/lib/store';
import { exportParcelToDXF } from '@/lib/exportDxf';
import { hasPermission, isDemoRole } from '@/src/types/auth';
import { useContourStore } from './useContourStore';
import {
  calculatePolygonSurface,
  extractParcelVertices,
  formatContourElevation,
  isCanoaOutputDirection,
  normalizeHuso,
  SATELLITE_DEM_WARNING,
  utmToWebMercator,
  type ParcelContourData,
  type UTMVertex,
} from './contourEngine';

type SheetTheme = 'cad' | 'satellite';
type GridStepChoice = 'auto' | 10 | 20 | 25 | 50 | 100 | 200 | 500;
const GRID_STEP_OPTIONS: readonly (10 | 20 | 25 | 50 | 100 | 200 | 500)[] = [
  10, 20, 25, 50, 100, 200, 500,
];
const DEM_GRID_OPTIONS = [
  { value: 0, label: 'Auto' },
  { value: 5, label: '5×5m' },
  { value: 10, label: '10×10m' },
  { value: 15, label: '15×15m' },
  { value: 20, label: '20×20m' },
  { value: 25, label: '25×25m' },
  { value: 50, label: '50×50m' },
] as const;
type SatProvider = 'esri' | 'google';
const INTERVAL_CHOICES = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10] as const;

// Lienzo SVG del Cuerpo Izquierdo (49% del ancho útil de la lámina A3 420×297mm)
const SVG_W = 680;
const SVG_H = 880;
const FRAME_PAD_L = 8;
const FRAME_PAD_R = 8;
const FRAME_PAD_T = 8;
const FRAME_PAD_B = 8;
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

function snapOfficialScale(dataW: number, dataH: number): number {
  const padding = 1.35;
  const scaleW = (dataW * padding) / (0.42 * 0.51);
  const scaleH = (dataH * padding) / (0.297 * 0.9);
  const rawScale = Math.max(scaleW, scaleH, 250);
  const power = Math.pow(10, Math.floor(Math.log10(rawScale)));
  const norm = rawScale / power;
  const snap = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return Math.round(snap * power);
}

function formatBearingDMS(dx: number, dy: number): string {
  const angleDeg = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
  const d = Math.floor(angleDeg);
  const mFloat = (angleDeg - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  const ns = dy >= 0 ? 'N' : 'S';
  const ew = dx >= 0 ? 'E' : 'W';
  return `${ns} ${String(d).padStart(2, '0')}°${String(m).padStart(2, '0')}'${s.toFixed(1)}" ${ew}`;
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

  if ((txMax - txMin + 1) * (tyMax - tyMin + 1) > 49) return null;

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
    ctx.drawImage(img, 0, 0, 256, 256, tileMinMX, tileMaxMY, tileWorldSpan, -tileWorldSpan);
  });

  ctx.restore();

  try {
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
}

interface ConstructionRow {
  lado: string;
  est: string;
  pv: string;
  rumbo: string;
  dist: string;
  vert: string;
  norte: string;
  este: string;
  z: string;
}

export default function ContourPrintModal() {
  const printModalParcelId = useContourStore((s) => s.printModalParcelId);
  const contoursByParcelId = useContourStore((s) => s.contoursByParcelId);
  const loadingParcelIds = useContourStore((s) => s.loadingParcelIds);
  const setParcelInterval = useContourStore((s) => s.setParcelInterval);
  const setGridSpacing = useContourStore((s) => s.setGridSpacing);
  const recalculateParcelContours = useContourStore((s) => s.recalculateParcelContours);
  const showIntermediateLabels = useContourStore((s) => s.showIntermediateLabels);
  const toggleIntermediateLabels = useContourStore((s) => s.toggleIntermediateLabels);
  const closePrintModal = useContourStore((s) => s.closePrintModal);
  const satOffset = useContourStore((s) => s.satOffset);

  const savedParcels = useAppStore((s) => s.savedParcels);
  const projectMeta = useAppStore((s) => s.projectMeta);
  const defaultHuso = useAppStore((s) => s.huso);
  const defaultDirection = useAppStore((s) => s.direction);
  const routine = useAppStore((s) => s.routine);
  const method = useAppStore((s) => s.method);
  const user = useAppStore((s) => s.user);

  const effectiveDirection =
    routine === 'ploteo' || method === 'rigida02' ? 'canoa_regven' : defaultDirection;

  const isDemo = Boolean(user?.rol) && isDemoRole(user?.rol);
  const canPrint = user ? hasPermission(user.rol, 'print_view', user?.roleConfig?.capabilities) : true;
  const canExportPdf = user ? hasPermission(user.rol, 'export_pdf', user?.roleConfig?.capabilities) : true;
  const canExportDxf = user ? hasPermission(user.rol, 'export_dxf', user?.roleConfig?.capabilities) : true;

  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<SheetTheme>('cad');
  const [satProvider, setSatProvider] = useState<SatProvider>('google');
  const [includeContours, setIncludeContours] = useState(true);
  const [showVertexZ, setShowVertexZ] = useState(true);
  const [showDemGrid, setShowDemGrid] = useState(true);
  const [gridStepOverride, setGridStepOverride] = useState<GridStepChoice>('auto');
  const [satDataUrl, setSatDataUrl] = useState<string | null>(null);
  const [loadingSat, setLoadingSat] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDxf, setExportingDxf] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const parcelMeta: Parcel | undefined = useMemo(
    () => (printModalParcelId ? savedParcels.find((p) => p.id === printModalParcelId) : undefined),
    [printModalParcelId, savedParcels]
  );

  const cachedContourData: ParcelContourData | null = printModalParcelId
    ? contoursByParcelId[printModalParcelId] ?? null
    : null;

  const isComputingContours = Boolean(printModalParcelId && loadingParcelIds.includes(printModalParcelId));

  // Al abrir el modal para una parcela nueva: activar curvas si ya están calculadas o dejar en modo mensura si no
  useEffect(() => {
    if (!printModalParcelId) return;
    setIncludeContours(Boolean(contoursByParcelId[printModalParcelId]?.contours?.length));
  }, [printModalParcelId]);

  // Geometría base normalizada (funciona tanto con contourData como con parcelMeta sin curvas)
  const basePlan = useMemo(() => {
    if (!printModalParcelId) return null;

    if (cachedContourData) {
      const [pMinE, pMinN, pMaxE, pMaxN] = cachedContourData.bboxUTM;
      const w = Math.max(10, pMaxE - pMinE);
      const h = Math.max(10, pMaxN - pMinN);
      return {
        parcelId: cachedContourData.parcelId,
        parcelName: cachedContourData.parcelName,
        huso: cachedContourData.huso,
        direction: cachedContourData.direction,
        vertices: cachedContourData.vertices,
        polygonUTM: cachedContourData.polygonUTM,
        bboxUTM: cachedContourData.bboxUTM,
        areaM2: cachedContourData.areaM2,
        areaHa: cachedContourData.areaHa,
        perimeterM: cachedContourData.perimeterM,
        printScale: snapOfficialScale(w, h),
      };
    }

    if (!parcelMeta || !parcelMeta.puntos || parcelMeta.puntos.length < 3) return null;
    const { vertices, huso, direction } = extractParcelVertices(
      parcelMeta,
      defaultHuso,
      effectiveDirection
    );
    if (vertices.length < 3) return null;
    const polygonUTM: [number, number][] = vertices.map((v) => [v.este, v.norte]);
    const surf = calculatePolygonSurface(polygonUTM);
    const es = vertices.map((v) => v.este);
    const ns = vertices.map((v) => v.norte);
    const pMinE = Math.min(...es);
    const pMaxE = Math.max(...es);
    const pMinN = Math.min(...ns);
    const pMaxN = Math.max(...ns);
    const w = Math.max(10, pMaxE - pMinE);
    const h = Math.max(10, pMaxN - pMinN);

    return {
      parcelId: parcelMeta.id,
      parcelName: parcelMeta.nombre || 'PARCELA',
      huso: normalizeHuso(huso, 19),
      direction,
      vertices,
      polygonUTM,
      bboxUTM: [pMinE, pMinN, pMaxE, pMaxN] as [number, number, number, number],
      areaM2: surf.areaM2 > 0 ? surf.areaM2 : Number(parcelMeta.area) || 0,
      areaHa: (surf.areaM2 > 0 ? surf.areaM2 : Number(parcelMeta.area) || 0) / 10000,
      perimeterM: surf.perimeterM > 0 ? surf.perimeterM : Number(parcelMeta.perim) || 0,
      printScale: snapOfficialScale(w, h),
    };
  }, [printModalParcelId, cachedContourData, parcelMeta, defaultHuso, effectiveDirection]);

  const data = includeContours ? cachedContourData : null;
  const hasContours = Boolean(data && data.contours.length > 0);

  // Ventana UTM isométrica exacta dentro del SVG izquierdo (49% de lámina A3)
  const viewport = useMemo(() => {
    if (!basePlan) return null;
    const [pMinE, pMinN, pMaxE, pMaxN] = basePlan.bboxUTM;
    const rawW = Math.max(10, pMaxE - pMinE);
    const rawH = Math.max(10, pMaxN - pMinN);

    const padFactor = 1.28;
    const targetW = rawW * padFactor;
    const targetH = rawH * padFactor;

    const scale = Math.min(DRAW_W / targetW, DRAW_H / targetH);
    const viewSpanE = DRAW_W / scale;
    const viewSpanN = DRAW_H / scale;

    const cE = (pMinE + pMaxE) * 0.5;
    const cN = (pMinN + pMaxN) * 0.5;
    // Desplazar ligeramente hacia arriba el centro para dejar libre la zona inferior izquierda (Cuadro de Datos + Escala)
    const offsetCenterN = cN - viewSpanN * 0.04;

    const viewMinE = cE - viewSpanE * 0.5;
    const viewMaxE = cE + viewSpanE * 0.5;
    const viewMinN = offsetCenterN - viewSpanN * 0.5;
    const viewMaxN = offsetCenterN + viewSpanN * 0.5;

    const toSvg = (e: number, n: number): [number, number] => [
      FRAME_PAD_L + (e - viewMinE) * scale,
      FRAME_PAD_T + (viewMaxN - n) * scale,
    ];

    const desiredBarMeters = 135 / scale;
    const barMeters = pickNiceStep(desiredBarMeters, 1);
    const barPx = barMeters * scale;

    return {
      viewMinE,
      viewMaxE,
      viewMinN,
      viewMaxN,
      viewSpanE,
      viewSpanN,
      scale,
      toSvg,
      barMeters,
      barPx,
    };
  }, [basePlan]);

  // Grilla UTM independiente (coordenadas solo arriba e izquierda, sin interferir con el cuadro inferior izquierdo)
  const utmGrid = useMemo(() => {
    if (!viewport) return null;
    const autoStep = pickNiceStep(Math.max(viewport.viewSpanE, viewport.viewSpanN), 4);
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

  // Descargar mosaico satelital únicamente cuando theme === 'satellite'
  useEffect(() => {
    if (!printModalParcelId || !basePlan || !viewport || theme !== 'satellite') {
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
        basePlan.huso,
        basePlan.direction,
        satOffset,
        satProvider
      );

      if (!url && !cancelled) {
        const fallbackProvider: SatProvider = satProvider === 'google' ? 'esri' : 'google';
        url = await renderSatelliteMosaicDataUrl(
          viewport.viewMinE,
          viewport.viewMaxE,
          viewport.viewMinN,
          viewport.viewMaxN,
          basePlan.huso,
          basePlan.direction,
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
  }, [printModalParcelId, basePlan, viewport, theme, satProvider, satOffset]);

  // Filas completas del Cuadro de Construcción Catastral (EST-PV, Rumbo, Distancia, Vert, N, E, Z)
  const constructionRows: ConstructionRow[] = useMemo(() => {
    if (!basePlan) return [];
    const verts = basePlan.vertices;
    const n = verts.length;
    return verts.map((p1, idx) => {
      const p2 = verts[(idx + 1) % n];
      const dx = p2.este - p1.este;
      const dy = p2.norte - p1.norte;
      const dist = Math.hypot(dx, dy);
      return {
        lado: `${p1.id}-${p2.id}`,
        est: p1.id,
        pv: p2.id,
        rumbo: formatBearingDMS(dx, dy),
        dist: dist.toFixed(2),
        vert: p1.id,
        norte: p1.norte.toFixed(3),
        este: p1.este.toFixed(3),
        z: Number.isFinite(p1.z) ? p1.z.toFixed(2) : '-',
      };
    });
  }, [basePlan]);

  // Cotas de distancia sobre los segmentos exteriores de la poligonal
  const edgeCotas = useMemo(() => {
    if (!basePlan || !viewport) return [];
    const verts = basePlan.vertices;
    const n = verts.length;
    let signedA = 0;
    for (let i = 0; i < n; i++) {
      const p1 = verts[i];
      const p2 = verts[(i + 1) % n];
      signedA += p1.este * p2.norte - p2.este * p1.norte;
    }
    const isCcw = signedA > 0;
    return verts.map((p1, idx) => {
      const p2 = verts[(idx + 1) % n];
      const [x1, y1] = viewport.toSvg(p1.este, p1.norte);
      const [x2, y2] = viewport.toSvg(p2.este, p2.norte);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenPx = Math.hypot(dx, dy);
      const distM = Math.hypot(p2.este - p1.este, p2.norte - p1.norte);
      // Normal exterior en coordenadas SVG (Y invertido)
      const ux = dx / Math.max(lenPx, 1);
      const uy = dy / Math.max(lenPx, 1);
      // En pantalla Y baja; si UTM es CCW, interior está a la izq en UTM = en pantalla (uy, -ux) está afuera
      const nx = isCcw ? -uy : uy;
      const ny = isCcw ? ux : -ux;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      return {
        idx,
        mx: (x1 + x2) * 0.5 + nx * 10,
        my: (y1 + y2) * 0.5 + ny * 10,
        deg,
        lenPx,
        text: distM.toFixed(2),
      };
    });
  }, [basePlan, viewport]);

  // Croquis vectorial 1:5000 (Cuerpo Derecho — Plano de Ubicación Local)
  const croquisPoints = useMemo(() => {
    if (!basePlan) return '';
    const verts = basePlan.vertices;
    const es = verts.map((v) => v.este);
    const ns = verts.map((v) => v.norte);
    const minE = Math.min(...es);
    const maxE = Math.max(...es);
    const minN = Math.min(...ns);
    const maxN = Math.max(...ns);
    const span = Math.max(10, maxE - minE, maxN - minN);
    const cE = (minE + maxE) * 0.5;
    const cN = (minN + maxN) * 0.5;
    const boxSize = 84;
    const scale = (boxSize * 0.68) / span;
    return verts
      .map((v) => {
        const x = 50 + (v.este - cE) * scale;
        const y = 50 - (v.norte - cN) * scale;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [basePlan]);

  const handleToggleContours = useCallback(async () => {
    if (!basePlan) return;
    if (!includeContours) {
      setIncludeContours(true);
      if (!cachedContourData && parcelMeta && !isComputingContours) {
        await recalculateParcelContours(parcelMeta, defaultHuso, effectiveDirection);
      }
    } else {
      setIncludeContours(false);
    }
  }, [basePlan, includeContours, cachedContourData, parcelMeta, isComputingContours, recalculateParcelContours, defaultHuso, effectiveDirection]);

  const handlePrint = useCallback(() => {
    if (isDemo || !canPrint) {
      toast.error('Impresión deshabilitada en Modo DEMO.');
      return;
    }
    window.print();
  }, [isDemo, canPrint]);

  const handleDownloadPdf = useCallback(async () => {
    if (!basePlan) return;
    if (isDemo || !canExportPdf) {
      toast.error('La exportación PDF está bloqueada para su rol.');
      return;
    }
    const sheet1El = document.getElementById('contour-print-sheet');
    if (!sheet1El) return;

    setExportingPdf(true);
    try {
      // Validar autorización PDF con el backend (sin bloquear modo offline local si falla red)
      try {
        const res = await fetch('/api/export/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ projectName: basePlan.parcelName }),
        });
        if (res.status === 403 || res.status === 401) {
          const err = await res.json().catch(() => ({}));
          toast.error(err?.error || 'Exportación PDF no autorizada.');
          setExportingPdf(false);
          return;
        }
      } catch {
        // Ignorar error de red transitorio para permitir generación local
      }

      const imgData1 = await toPng(sheet1El, {
        pixelRatio: 2.2,
        backgroundColor: '#ffffff',
        cacheBust: true,
      });

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a3',
        compress: true,
      });
      pdf.addImage(imgData1, 'PNG', 0, 0, 420, 297, undefined, 'FAST');

      const sheet2El = document.getElementById('contour-print-annex');
      if (sheet2El) {
        const imgData2 = await toPng(sheet2El, {
          pixelRatio: 2.2,
          backgroundColor: '#ffffff',
          cacheBust: true,
        });
        pdf.addPage('a3', 'landscape');
        pdf.addImage(imgData2, 'PNG', 0, 0, 420, 297, undefined, 'FAST');
      }

      const safeName = (basePlan.parcelName || 'PARCELA')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .toUpperCase();
      const suffix = hasContours ? 'TOPO_OFICIAL_A3' : 'MENSURA_OFICIAL_A3';
      pdf.save(`${safeName}_${suffix}.pdf`);
      toast.success(`PDF A3 Oficial (${safeName}_${suffix}.pdf) descargado`);
    } catch (err: any) {
      console.error('[PDF Official Error]', err);
      toast.error(`Error generando PDF A3: ${err?.message || 'Error inesperado'}`);
    } finally {
      setExportingPdf(false);
    }
  }, [basePlan, isDemo, canExportPdf, hasContours]);

  const handleDownloadDxf = useCallback(async () => {
    if (!basePlan) return;
    if (isDemo || !canExportDxf) {
      toast.error('Exportación DXF oficial deshabilitada para su rol.');
      return;
    }
    const parcelObj: Parcel =
      parcelMeta ?? {
        id: basePlan.parcelId,
        nombre: basePlan.parcelName,
        fecha: new Date().toLocaleDateString('es-VE'),
        area: basePlan.areaM2,
        perim: basePlan.perimeterM,
        ha: basePlan.areaHa,
        geometryType: 'cerrada',
        puntos: basePlan.vertices.map((v) => ({
          id: v.id,
          ok: true,
          direction: basePlan.direction as any,
          input: { este: v.este, norte: v.norte, alt: v.z },
          result: { este: v.este, norte: v.norte, lat: v.lat, lng: v.lng, cota_regven: v.z, huso: basePlan.huso },
        })),
      };

    setExportingDxf(true);
    try {
      await exportParcelToDXF(parcelObj, hasContours ? data : null, {
        includeContours: hasContours,
        showDemGrid,
        showIntermediateLabels,
      });
    } finally {
      setExportingDxf(false);
    }
  }, [basePlan, parcelMeta, data, hasContours, showDemGrid, showIntermediateLabels, isDemo, canExportDxf]);

  if (!mounted || !printModalParcelId || !basePlan || !viewport) return null;

  const isSat = theme === 'satellite';
  const datumLabel = isCanoaOutputDirection(basePlan.direction)
    ? `PSAD-56 / LA CANOA (EPSG:248${basePlan.huso})`
    : `REGVEN SIRGAS GRS80 (EPSG:220${basePlan.huso - 17})`;
  const datumShort = isCanoaOutputDirection(basePlan.direction)
    ? `LA CANOA PSAD56 / UTM ${basePlan.huso}N`
    : `REGVEN (SIRGAS) / UTM ${basePlan.huso}N`;

  const polyPointsAttr = basePlan.polygonUTM
    .map(([e, n]) => {
      const [sx, sy] = viewport.toSvg(e, n);
      return `${sx.toFixed(1)},${sy.toFixed(1)}`;
    })
    .join(' ');

  const areaM2 = basePlan.areaM2;
  const areaHa = basePlan.areaHa;
  const perimM = basePlan.perimeterM;
  const areaDocM2 = Number(parcelMeta?.area) > 0 ? Number(parcelMeta?.area) : areaM2;
  const puntoApoyo: UTMVertex = basePlan.vertices[0];

  // Reglas de 3 niveles para el Cuadro de Construcción (paridad exacta con cad_geometry.py)
  const totalVerts = constructionRows.length;
  const level = totalVerts <= 15 ? 1 : totalVerts <= 38 ? 2 : 3;
  const maxMainRows = hasContours ? 30 : 35;
  const mainRows = level === 3 ? constructionRows.slice(0, maxMainRows) : constructionRows;
  const annexRows = level === 3 ? constructionRows.slice(maxMainRows) : [];
  const annexChunks: ConstructionRow[][] = [];
  for (let i = 0; i < annexRows.length; i += 45) {
    annexChunks.push(annexRows.slice(i, i + 45));
  }

  const activeGridStep =
    utmGrid?.gridStep ?? pickNiceStep(Math.max(viewport.viewSpanE, viewport.viewSpanN), 4);
  const activeGridEs = utmGrid?.gridEs ?? [];
  const activeGridNs = utmGrid?.gridNs ?? [];
  const clippedGridLines = data?.clippedGridLinesUTM ?? [];
  const interiorNodes = data?.interiorGridNodes ?? [];
  const demGridStepMeters = data?.gridSpacingMeters ?? data?.gridSpacingE ?? 10;
  const minCellSvgPx = data
    ? Math.min((data.gridSpacingE ?? 10) * viewport.scale, (data.gridSpacingN ?? 10) * viewport.scale)
    : 30;
  const nodeLabelStride =
    interiorNodes.length > 130 || minCellSvgPx < 24
      ? Math.max(2, Math.ceil(Math.sqrt(Math.max(1, interiorNodes.length) / 95)))
      : 1;

  const pMetaAny = parcelMeta as any;
  const estado = (pMetaAny?.estado || '').toUpperCase();
  const municipio = (pMetaAny?.municipio || '').toUpperCase();
  const parroquia = (pMetaAny?.parroquia || '').toUpperCase();
  const propietario = (pMetaAny?.propietario || '').toUpperCase();
  const rif = (pMetaAny?.rif || '').toUpperCase();
  const domicilio = (pMetaAny?.domicilio || '').toUpperCase();
  const profesional = (pMetaAny?.profesional || '').toUpperCase();
  const civ = (pMetaAny?.civ || '').toUpperCase();
  const zona = (pMetaAny?.zona || '').toUpperCase();
  const seccion = (pMetaAny?.seccion || '').toUpperCase();
  const cedulaCat = (pMetaAny?.cedulaCat || '').toUpperCase();
  const observacionesRaw = (pMetaAny?.observaciones || '').toUpperCase();
  const observacionesText =
    observacionesRaw ||
    (hasContours
      ? 'LEVANTAMIENTO PLANIALTIMETRICO REGVEN-SIRGAS UTM. DATUM VERTICAL: MAREOGRAFO DE LA GUAIRA. LEY DE GEOGRAFIA, CARTOGRAFIA Y CATASTRO NACIONAL (G.O. 37.002).'
      : 'LEVANTAMIENTO PLANIMETRICO REGVEN-SIRGAS UTM SEGUN LEY DE GEOGRAFIA, CARTOGRAFIA Y CATASTRO NACIONAL (G.O. 37.002).');

  const regText =
    estado && municipio
      ? `OFICINA SUBALTERNA DE REGISTRO DEL MUNICIPIO ${municipio} DEL ESTADO ${estado}, BAJO EL NRO. ____, FOLIOS ____ AL ___, PROTOCOLO: ________, TRIMESTRE ______, ANO: ______`
      : 'OFICINA SUBALTERNA DE REGISTRO DEL MUNICIPIO ________ DEL ESTADO ________, BAJO EL NRO. ____, FOLIOS ____ AL ___, PROTOCOLO: ________, TRIMESTRE ______, ANO: ______';

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
                size: A3 landscape;
                margin: 5mm;
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
              #contour-print-sheet,
              #contour-print-annex {
                width: 100% !important;
                max-width: none !important;
                box-shadow: none !important;
                margin: 0 !important;
                page-break-after: always;
                break-after: page;
              }
              #contour-print-annex:last-child,
              #contour-print-sheet:last-child {
                page-break-after: auto;
                break-after: auto;
              }
            }
          `,
        }}
      />

      {/* ── Barra Superior de Controles Unificados ─────────────────────────────── */}
      <div className="shrink-0 bg-slate-900 border-b border-slate-800 px-3 py-2 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Mountain className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider truncate">
              Plano Único Oficial (IGVSB A3) · {basePlan.parcelName}
            </h2>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              {datumLabel} · Escala 1:{basePlan.printScale} · {totalVerts} vértices
              {hasContours ? ` · Curvas ΔZ ${data!.interval}m` : ' · Solo Mensura'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Fondo */}
          <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setTheme('cad')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-colors',
                theme === 'cad' ? 'bg-slate-200 text-slate-950' : 'text-slate-400 hover:text-white'
              )}
            >
              <FileSpreadsheet className="w-3 h-3" />
              Blanco CAD
            </button>
            <button
              onClick={() => setTheme('satellite')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-colors',
                theme === 'satellite' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
              )}
            >
              <Satellite className="w-3 h-3" />
              Satélite
            </button>
          </div>

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

          {/* Activar/Desactivar Curvas de Nivel sobre el Plano Único */}
          <button
            onClick={handleToggleContours}
            disabled={isComputingContours}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase border transition-colors',
              includeContours
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            )}
            title="Incluir o excluir curvas de nivel y altimetría en este plano (PDF y DXF)"
          >
            {isComputingContours ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Mountain className="w-3 h-3" />
            )}
            {isComputingContours ? 'Calculando DEM...' : includeContours ? 'Con Curvas' : 'Sin Curvas'}
          </button>

          {/* Controles de Curvas cuando están activas */}
          {hasContours && data && (
            <>
              <div className="flex items-center gap-0.5 bg-slate-950 px-1.5 py-1 rounded-lg border border-slate-800">
                <span className="text-[9px] font-bold text-slate-400 uppercase mr-0.5">ΔZ:</span>
                {INTERVAL_CHOICES.map((iv) => (
                  <button
                    key={iv}
                    onClick={() => setParcelInterval(data.parcelId, iv)}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors',
                      data.interval === iv
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    )}
                  >
                    {iv}m
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
                <span className="text-[9px] font-bold text-slate-400 uppercase">Malla IGVSB:</span>
                <select
                  value={String(data.requestedGridSpacing ?? 0)}
                  onChange={(e) => setGridSpacing(Number(e.target.value), data.parcelId)}
                  className="bg-transparent text-[10px] font-mono font-bold text-emerald-300 outline-none cursor-pointer"
                >
                  {DEM_GRID_OPTIONS.map((opt) => (
                    <option key={opt.value} value={String(opt.value)} className="bg-slate-900 text-slate-200">
                      {opt.value === 0 ? `Auto (${demGridStepMeters}m)` : opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={toggleIntermediateLabels}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors',
                  showIntermediateLabels
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                )}
              >
                <Tag className="w-3 h-3" />
                Cotas Int.
              </button>

              <button
                onClick={() => setShowDemGrid((v) => !v)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors',
                  showDemGrid
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                )}
              >
                <Grid3x3 className="w-3 h-3" />
                Malla
              </button>
            </>
          )}

          {/* Vértices & Grilla UTM */}
          <button
            onClick={() => setShowVertexZ((v) => !v)}
            className={cn(
              'px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors',
              showVertexZ
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            )}
          >
            Vértices
          </button>

          <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
            <span className="text-[9px] font-bold text-slate-400 uppercase">Grilla UTM:</span>
            <select
              value={String(gridStepOverride)}
              onChange={(e) => {
                const val = e.target.value;
                setGridStepOverride(val === 'auto' ? 'auto' : (Number(val) as GridStepChoice));
              }}
              className="bg-transparent text-[10px] font-mono font-bold text-cyan-300 outline-none cursor-pointer"
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

          {/* Botones de Exportación Unificados: DXF Oficial + PDF (A3) + Imprimir */}
          <button
            onClick={handleDownloadDxf}
            disabled={exportingDxf}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-[10px] font-extrabold uppercase tracking-wider transition-colors disabled:opacity-50"
            title="Descargar Plano Único Oficial en AutoCAD (.dxf)"
          >
            {exportingDxf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            DXF Oficial
          </button>

          <button
            onClick={handleDownloadPdf}
            disabled={exportingPdf}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-extrabold uppercase tracking-wider transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            title="Descargar archivo PDF directo en formato oficial ISO A3 horizontal"
          >
            {exportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
            PDF (A3)
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-extrabold uppercase tracking-wider transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir
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

      {/* ── Lienzo Scrollable con Lámina A3 Oficial (y Anexo si >38 vértices) ── */}
      <div className="flex-1 overflow-auto p-3 md:p-5 flex flex-col items-center gap-6 print:p-0 print:overflow-visible print:block">
        {/* ==================== HOJA 1: LÁMINA OFICIAL A3 (3 CUERPOS: 49% / 31% / 20%) ==================== */}
        <div
          id="contour-print-sheet"
          className="w-[1380px] min-w-[1380px] h-[976px] bg-white text-slate-900 border-2 border-slate-900 p-2 shadow-2xl shrink-0"
        >
          <div className="w-full h-full border-[1.5px] border-slate-900 grid grid-cols-[49%_31%_20%] bg-white">
            {/* ── CUERPO 1 (49%): ÁREA GRÁFICA OFICIAL ─────────────────────── */}
            <div className="relative border-r border-slate-900 h-full overflow-hidden bg-white">
              {loadingSat && (
                <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/85 text-amber-300 text-[10px] font-bold shadow print:hidden">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Cargando ortofoto...
                </div>
              )}

              <svg
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                className="w-full h-full block select-none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <clipPath id="official-draw-clip">
                    <rect x={FRAME_PAD_L} y={FRAME_PAD_T} width={DRAW_W} height={DRAW_H} />
                  </clipPath>
                </defs>

                <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#ffffff" />

                <g clipPath="url(#official-draw-clip)">
                  <rect
                    x={FRAME_PAD_L}
                    y={FRAME_PAD_T}
                    width={DRAW_W}
                    height={DRAW_H}
                    fill={isSat ? '#0f172a' : '#ffffff'}
                  />

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

                  {isSat && (
                    <rect
                      x={FRAME_PAD_L}
                      y={FRAME_PAD_T}
                      width={DRAW_W}
                      height={DRAW_H}
                      fill="rgba(2, 6, 23, 0.14)"
                    />
                  )}

                  {/* Grilla UTM interna */}
                  {activeGridEs.map((ge) => {
                    const [gx] = viewport.toSvg(ge, viewport.viewMinN);
                    return (
                      <line
                        key={`ge-${ge}`}
                        x1={gx}
                        y1={FRAME_PAD_T}
                        x2={gx}
                        y2={FRAME_PAD_T + DRAW_H}
                        stroke={isSat ? 'rgba(255,255,255,0.40)' : '#94a3b8'}
                        strokeWidth={0.8}
                        strokeDasharray="4 4"
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
                        stroke={isSat ? 'rgba(255,255,255,0.40)' : '#94a3b8'}
                        strokeWidth={0.8}
                        strokeDasharray="4 4"
                      />
                    );
                  })}

                  {/* Cruces cartográficas (+) */}
                  {activeGridEs.map((ge) =>
                    activeGridNs.map((gn) => {
                      const [gx, gy] = viewport.toSvg(ge, gn);
                      return (
                        <g key={`gx-${ge}-${gn}`}>
                          <line x1={gx - 3.5} y1={gy} x2={gx + 3.5} y2={gy} stroke={isSat ? 'rgba(255,255,255,0.7)' : '#64748b'} strokeWidth={0.85} />
                          <line x1={gx} y1={gy - 3.5} x2={gx} y2={gy + 3.5} stroke={isSat ? 'rgba(255,255,255,0.7)' : '#64748b'} strokeWidth={0.85} />
                        </g>
                      );
                    })
                  )}

                  {/* Relleno sutil de parcela */}
                  <polygon
                    points={polyPointsAttr}
                    fill={isSat ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.04)'}
                    stroke="none"
                  />

                  {/* Malla Altimétrica IGVSB recortada al polígono */}
                  {hasContours &&
                    showDemGrid &&
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
                          strokeWidth={0.7}
                          strokeOpacity={0.65}
                          strokeDasharray="2.5 2.5"
                        />
                      );
                    })}

                  {/* Nodos DEM internos con Cota Z diezmada */}
                  {hasContours &&
                    showDemGrid &&
                    interiorNodes.map((gn, idx) => {
                      const [sx, sy] = viewport.toSvg(gn.este, gn.norte);
                      const showLabel = gn.col % nodeLabelStride === 0 && gn.row % nodeLabelStride === 0;
                      const crossSz = interiorNodes.length > 350 ? 1.4 : 2.1;
                      return (
                        <g key={`dgn-${idx}`}>
                          <line x1={sx - crossSz} y1={sy} x2={sx + crossSz} y2={sy} stroke={isSat ? '#a7f3d0' : '#047857'} strokeWidth={0.7} />
                          <line x1={sx} y1={sy - crossSz} x2={sx} y2={sy + crossSz} stroke={isSat ? '#a7f3d0' : '#047857'} strokeWidth={0.7} />
                          {showLabel && (
                            <text
                              x={sx + 2.5}
                              y={sy - 2}
                              fontFamily="ui-monospace, monospace"
                              fontSize={6.2}
                              fontWeight="bold"
                              fill={isSat ? '#d1fae5' : '#065f46'}
                              stroke={isSat ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.92)'}
                              strokeWidth={1.8}
                              paintOrder="stroke"
                            >
                              {gn.z.toFixed(1)}
                            </text>
                          )}
                        </g>
                      );
                    })}

                  {/* Curvas Intermedias */}
                  {hasContours &&
                    data!.contours
                      .filter((c) => !c.isMaster)
                      .map((c, idx) => {
                        const isDense = data!.contours.length > 20;
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
                            strokeWidth={isDense ? 0.85 : 1.0}
                            strokeOpacity={0.85}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        );
                      })}

                  {/* Curvas Maestras */}
                  {hasContours &&
                    data!.contours
                      .filter((c) => c.isMaster)
                      .map((c, idx) => {
                        const isDense = data!.contours.length > 20;
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
                                strokeWidth={isDense ? 2.4 : 3.2}
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

                  {/* Etiquetas Cartográficas sobre Curvas con Máscara/Interrupción de Trazo */}
                  {hasContours &&
                    data!.contours.flatMap((c, cIdx) => {
                      if (!c.isMaster && !showIntermediateLabels) return [];
                      const placements =
                        c.labels && c.labels.length > 0
                          ? c.labels
                          : c.labelPointUTM
                            ? [
                              {
                                pointUTM: c.labelPointUTM,
                                angleDeg: ((c.labelAngleRad ?? 0) * 180) / Math.PI,
                                formattedText: formatContourElevation(c.elevation, data!.interval, false),
                              },
                            ]
                            : [];

                      return placements.map((lbl, lIdx) => {
                        const [lx, ly] = viewport.toSvg(lbl.pointUTM[0], lbl.pointUTM[1]);
                        let svgDeg = -lbl.angleDeg;
                        if (svgDeg > 90) svgDeg -= 180;
                        if (svgDeg < -90) svgDeg += 180;
                        const textStr = c.isMaster ? `${lbl.formattedText} m` : lbl.formattedText;
                        const fontSize = c.isMaster ? 9 : 7.5;
                        const pillW = textStr.length * (c.isMaster ? 5.6 : 4.7) + 5;
                        const pillH = c.isMaster ? 12 : 9.5;
                        const pillFill = isSat ? '#0f172a' : '#ffffff';
                        const accentColor = isSat
                          ? c.isMaster
                            ? '#f59e0b'
                            : '#38bdf8'
                          : c.isMaster
                            ? '#9a3412'
                            : '#d97706';

                        return (
                          <g
                            key={`lbl-${cIdx}-${lIdx}`}
                            transform={`rotate(${svgDeg.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})`}
                          >
                            <rect
                              x={lx - pillW * 0.5}
                              y={ly - pillH * 0.5}
                              width={pillW}
                              height={pillH}
                              rx={2}
                              fill={pillFill}
                              fillOpacity={isSat ? 0.92 : 0.96}
                              stroke={accentColor}
                              strokeWidth={0.45}
                              strokeOpacity={0.65}
                            />
                            <text
                              x={lx}
                              y={ly}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                              fontSize={fontSize}
                              fontWeight={c.isMaster ? 'bold' : '600'}
                              fill={isSat ? (c.isMaster ? '#fef3c7' : '#e0f2fe') : c.isMaster ? '#7c2d12' : '#b45309'}
                            >
                              {textStr}
                            </text>
                          </g>
                        );
                      });
                    })}

                  {/* Poligonal / Lindero Oficial */}
                  <polygon
                    points={polyPointsAttr}
                    fill="none"
                    stroke={isSat ? '#ef4444' : '#b91c1c'}
                    strokeWidth={2.4}
                    strokeLinejoin="round"
                  />

                  {/* Nombre de la parcela en el interior */}
                  {(() => {
                    const [pMinE, pMinN, pMaxE, pMaxN] = basePlan.bboxUTM;
                    const [cxSvg, cySvg] = viewport.toSvg((pMinE + pMaxE) * 0.5, (pMinN + pMaxN) * 0.5);
                    return (
                      <text
                        x={cxSvg}
                        y={cySvg}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontFamily="system-ui, sans-serif"
                        fontSize={12}
                        fontWeight="bold"
                        fill={isSat ? '#ffffff' : '#0f172a'}
                        stroke={isSat ? '#0f172a' : '#ffffff'}
                        strokeWidth={3.2}
                        paintOrder="stroke"
                      >
                        {basePlan.parcelName}
                      </text>
                    );
                  })()}

                  {/* Cotas de distancia sobre lados suficientes */}
                  {edgeCotas.map((ec) =>
                    ec.lenPx > 28 ? (
                      <text
                        key={`ec-${ec.idx}`}
                        x={ec.mx}
                        y={ec.my}
                        transform={`rotate(${ec.deg.toFixed(1)} ${ec.mx.toFixed(1)} ${ec.my.toFixed(1)})`}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontFamily="ui-monospace, monospace"
                        fontSize={8}
                        fontWeight="bold"
                        fill={isSat ? '#f8fafc' : '#1e293b'}
                        stroke={isSat ? '#0f172a' : '#ffffff'}
                        strokeWidth={2.8}
                        paintOrder="stroke"
                      >
                        {ec.text}
                      </text>
                    ) : null
                  )}

                  {/* Cotas extremas (Mínima y Máxima) cuando hay curvas */}
                  {hasContours &&
                    data &&
                    (() => {
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
                              fontSize={8.5}
                              fontWeight="bold"
                              fill={isSat ? '#7dd3fc' : '#0369a1'}
                              stroke={isSat ? '#0f172a' : '#ffffff'}
                              strokeWidth={2.8}
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
                              fontSize={8.5}
                              fontWeight="bold"
                              fill={isSat ? '#6ee7b7' : '#047857'}
                              stroke={isSat ? '#0f172a' : '#ffffff'}
                              strokeWidth={2.8}
                              paintOrder="stroke"
                            >
                              {`▲ Zmax ${data.maxZ.toFixed(1)}m`}
                            </text>
                          </g>
                        </>
                      );
                    })()}

                  {/* Vértices P1..Pn */}
                  {basePlan.vertices.map((v) => {
                    const [vx, vy] = viewport.toSvg(v.este, v.norte);
                    return (
                      <g key={v.id} transform={`translate(${vx}, ${vy})`}>
                        <circle
                          r={3}
                          fill={isSat ? '#ffffff' : '#dc2626'}
                          stroke="#0f172a"
                          strokeWidth={1.1}
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
                            strokeWidth={2.6}
                            paintOrder="stroke"
                          >
                            {v.id}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Etiquetas de Grilla UTM ÚNICAMENTE en Borde SUPERIOR e IZQUIERDO (Norma Catastral) */}
                  {activeGridEs.map((ge) => {
                    const [gx] = viewport.toSvg(ge, viewport.viewMinN);
                    if (gx < FRAME_PAD_L + 36 || gx > FRAME_PAD_L + DRAW_W - 22) return null;
                    return (
                      <text
                        key={`top-e-${ge}`}
                        x={gx - 4}
                        y={FRAME_PAD_T + 14}
                        transform={`rotate(90 ${(gx - 4).toFixed(1)} ${(FRAME_PAD_T + 14).toFixed(1)})`}
                        fontFamily="ui-monospace, monospace"
                        fontSize={8.5}
                        fontWeight="bold"
                        fill={isSat ? '#f8fafc' : '#0f172a'}
                        stroke={isSat ? '#0f172a' : '#ffffff'}
                        strokeWidth={2.6}
                        paintOrder="stroke"
                      >
                        {`E ${Math.round(ge)}`}
                      </text>
                    );
                  })}

                  {activeGridNs.map((gn) => {
                    const [, gy] = viewport.toSvg(viewport.viewMinE, gn);
                    if (gy < FRAME_PAD_T + 22 || gy > FRAME_PAD_T + DRAW_H - 135) return null;
                    return (
                      <text
                        key={`left-n-${gn}`}
                        x={FRAME_PAD_L + 8}
                        y={gy - 4}
                        fontFamily="ui-monospace, monospace"
                        fontSize={8.5}
                        fontWeight="bold"
                        fill={isSat ? '#f8fafc' : '#0f172a'}
                        stroke={isSat ? '#0f172a' : '#ffffff'}
                        strokeWidth={2.6}
                        paintOrder="stroke"
                      >
                        {`N ${Math.round(gn)}`}
                      </text>
                    );
                  })}

                  {/* Cuadro de Datos Generales del Levantamiento (Esquina Inferior Izquierda del Mapa) */}
                  <g transform={`translate(${FRAME_PAD_L + 10}, ${FRAME_PAD_T + DRAW_H - (hasContours ? 114 : 88)})`}>
                    <rect
                      x={0}
                      y={0}
                      width={318}
                      height={hasContours ? 104 : 78}
                      fill="rgba(255,255,255,0.95)"
                      stroke="#0f172a"
                      strokeWidth={1.3}
                    />
                    <text x={8} y={15} fontFamily="ui-monospace, monospace" fontSize={9.2} fontWeight="bold" fill="#0f172a">
                      {`PROYECTO: ${basePlan.parcelName.slice(0, 32)}`}
                    </text>
                    <text x={8} y={29} fontFamily="ui-monospace, monospace" fontSize={8.5} fontWeight="bold" fill="#0f172a">
                      {areaM2 >= 10000
                        ? `AREA TOTAL: ${areaM2.toFixed(2)} m2 (${areaHa.toFixed(4)} ha)`
                        : `AREA TOTAL: ${areaM2.toFixed(2)} m2`}
                    </text>
                    <text x={8} y={43} fontFamily="ui-monospace, monospace" fontSize={8.5} fill="#0f172a">
                      {`PERIMETRO TOTAL: ${perimM.toFixed(2)} m`}
                    </text>
                    <text x={8} y={57} fontFamily="ui-monospace, monospace" fontSize={8.5} fontWeight="bold" fill="#0f172a">
                      {`ESCALA DE DIBUJO: 1:${basePlan.printScale}`}
                    </text>
                    <text x={8} y={70} fontFamily="ui-monospace, monospace" fontSize={8} fill="#334155">
                      {`DATUM: ${datumShort}`}
                    </text>
                    {hasContours && data && (
                      <>
                        <text x={8} y={84} fontFamily="ui-monospace, monospace" fontSize={8} fontWeight="bold" fill="#9a3412">
                          {`CURVAS: dZ=${data.interval}m (MAEST ${data.masterInterval}m) | MALLA ${demGridStepMeters}x${demGridStepMeters}m`}
                        </text>
                        <text x={8} y={97} fontFamily="ui-monospace, monospace" fontSize={7.6} fill="#334155">
                          {`DATUM VERT.: MAREOGRAFO DE LA GUAIRA (m.s.n.m.)`}
                        </text>
                      </>
                    )}
                  </g>

                  {/* Barra de Escala Gráfica (Esquina Inferior Derecha del Área Gráfica) */}
                  <g transform={`translate(${FRAME_PAD_L + DRAW_W - Math.max(130, viewport.barPx) - 24}, ${FRAME_PAD_T + DRAW_H - 48})`}>
                    <rect
                      x={-8}
                      y={-12}
                      width={Math.max(116, viewport.barPx + 24)}
                      height={42}
                      fill="rgba(255,255,255,0.95)"
                      stroke="#0f172a"
                      strokeWidth={1.1}
                    />
                    <text x={0} y={-1} fontFamily="ui-monospace, monospace" fontSize={7.8} fontWeight="bold" fill="#0f172a">
                      {`ESCALA GRAFICA 1:${basePlan.printScale}`}
                    </text>
                    <rect x={0} y={5} width={viewport.barPx * 0.25} height={6} fill="#0f172a" stroke="#0f172a" strokeWidth={0.8} />
                    <rect x={viewport.barPx * 0.25} y={5} width={viewport.barPx * 0.25} height={6} fill="#ffffff" stroke="#0f172a" strokeWidth={0.8} />
                    <rect x={viewport.barPx * 0.5} y={5} width={viewport.barPx * 0.25} height={6} fill="#0f172a" stroke="#0f172a" strokeWidth={0.8} />
                    <rect x={viewport.barPx * 0.75} y={5} width={viewport.barPx * 0.25} height={6} fill="#ffffff" stroke="#0f172a" strokeWidth={0.8} />
                    <text x={0} y={22} fontFamily="ui-monospace, monospace" fontSize={7.5} fill="#0f172a">0</text>
                    <text x={viewport.barPx * 0.5} y={22} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={7.5} fill="#0f172a">
                      {`${viewport.barMeters * 0.5}m`}
                    </text>
                    <text x={viewport.barPx} y={22} textAnchor="end" fontFamily="ui-monospace, monospace" fontSize={7.5} fontWeight="bold" fill="#0f172a">
                      {`${viewport.barMeters}m`}
                    </text>
                  </g>
                </g>
              </svg>
            </div>

            {/* ── CUERPO 2 (31%): CUADRO DE CONSTRUCCIÓN (3 NIVELES) + ALTIMETRÍA ── */}
            <div className="border-r border-slate-900 p-2 flex flex-col justify-between gap-1.5 h-full overflow-hidden bg-white">
              <div className="flex flex-col gap-1.5 min-h-0 flex-1">
                {/* Bloque 1: Balance de Superficie & Punto de Apoyo */}
                <div className="border border-slate-900 text-[8.5px]">
                  <div className="bg-slate-100 border-b border-slate-900 px-1.5 py-0.5 font-extrabold text-center uppercase tracking-wider">
                    Balance de Superficie y Punto de Apoyo (REGVEN)
                  </div>
                  <div className="grid grid-cols-2 border-b border-slate-900 font-mono">
                    <div className="px-1.5 py-0.5 border-r border-slate-900 flex justify-between">
                      <span className="font-sans font-semibold text-slate-600">A. DOC:</span>
                      <span className="font-bold">{areaDocM2.toFixed(2)} m²</span>
                    </div>
                    <div className="px-1.5 py-0.5 flex justify-between">
                      <span className="font-sans font-semibold text-slate-600">A. MENS:</span>
                      <span className="font-bold text-emerald-900">{areaM2.toFixed(2)} m²</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-[20%_40%_40%] font-mono text-[8px]">
                    <div className="px-1.5 py-0.5 border-r border-slate-900 font-bold text-center">
                      PA: V.P.
                    </div>
                    <div className="px-1.5 py-0.5 border-r border-slate-900 text-center">
                      N: {puntoApoyo.norte.toFixed(2)}
                    </div>
                    <div className="px-1.5 py-0.5 text-center">
                      E: {puntoApoyo.este.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Bloque 2: Cuadro de Construcción Catastral */}
                <div className="border border-slate-900 flex flex-col flex-1 min-h-0">
                  <div className="bg-slate-100 border-b border-slate-900 px-1.5 py-0.5 text-[8.5px] font-extrabold text-center uppercase tracking-wider shrink-0">
                    {level === 3
                      ? `Cuadro de Construcción (1-${mainRows.length} de ${totalVerts})`
                      : 'Cuadro de Construcción Catastral (UTM)'}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <table className="w-full text-center font-mono border-collapse table-fixed">
                      <thead>
                        <tr className="bg-slate-200 border-b border-slate-900 text-[7.5px] font-bold">
                          <th className="border-r border-slate-900 py-0.5 w-[11%]">LADO</th>
                          <th className="border-r border-slate-900 py-0.5 w-[24%]">RUMBO</th>
                          <th className="border-r border-slate-900 py-0.5 w-[11%]">DIST(m)</th>
                          <th className="border-r border-slate-900 py-0.5 w-[8%]">V</th>
                          <th className="border-r border-slate-900 py-0.5 w-[19%]">NORTE</th>
                          <th className={cn('py-0.5', hasContours ? 'border-r border-slate-900 w-[18%]' : 'w-[27%]')}>
                            ESTE
                          </th>
                          {hasContours && <th className="py-0.5 w-[9%]">Z(m)</th>}
                        </tr>
                      </thead>
                      <tbody className={level === 1 ? 'text-[8.5px]' : level === 2 ? 'text-[7.3px]' : 'text-[7px]'}>
                        {mainRows.map((r, idx) => (
                          <tr key={idx} className="border-b border-slate-300 odd:bg-white even:bg-slate-50/70">
                            <td className="border-r border-slate-400 px-0.5 py-[1.5px] font-bold truncate">{r.lado}</td>
                            <td className="border-r border-slate-400 px-0.5 py-[1.5px] truncate">{r.rumbo}</td>
                            <td className="border-r border-slate-400 px-0.5 py-[1.5px] text-right">{r.dist}</td>
                            <td className="border-r border-slate-400 px-0.5 py-[1.5px] font-bold">{r.vert}</td>
                            <td className="border-r border-slate-400 px-0.5 py-[1.5px] text-right">{r.norte}</td>
                            <td className={cn('px-0.5 py-[1.5px] text-right', hasContours && 'border-r border-slate-400')}>
                              {r.este}
                            </td>
                            {hasContours && (
                              <td className="px-0.5 py-[1.5px] text-right font-semibold text-amber-900">{r.z}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {level === 3 && (
                    <div className="bg-amber-50 border-t border-slate-900 px-1.5 py-0.5 text-[7.8px] font-bold text-center text-amber-950 shrink-0">
                      CONTINÚA EN HOJA 2 — ANEXO DE CUADRO DE CONSTRUCCIÓN ({annexRows.length} PTS)
                    </div>
                  )}
                </div>
              </div>

              {/* Bloque 3 (si incluye curvas): Resumen Altimétrico & Leyenda IGVSB */}
              {hasContours && data ? (
                <div className="border border-slate-900 text-[8px] shrink-0">
                  <div className="bg-amber-100/80 border-b border-slate-900 px-1.5 py-0.5 font-extrabold text-center uppercase tracking-wider text-amber-950">
                    Resumen Altimétrico y Curvas (IGVSB)
                  </div>
                  <div className="grid grid-cols-3 border-b border-slate-900 font-mono">
                    <div className="px-1.5 py-0.5 border-r border-slate-900 flex justify-between">
                      <span className="font-sans text-slate-600">Zmín:</span>
                      <span className="font-bold text-sky-900">{data.minZ.toFixed(2)}m</span>
                    </div>
                    <div className="px-1.5 py-0.5 border-r border-slate-900 flex justify-between">
                      <span className="font-sans text-slate-600">Zmáx:</span>
                      <span className="font-bold text-emerald-900">{data.maxZ.toFixed(2)}m</span>
                    </div>
                    <div className="px-1.5 py-0.5 flex justify-between">
                      <span className="font-sans text-slate-600">ΔH:</span>
                      <span className="font-bold text-amber-900">{data.deltaH.toFixed(2)}m</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 border-b border-slate-900 font-mono">
                    <div className="px-1.5 py-0.5 border-r border-slate-900 flex justify-between">
                      <span className="font-sans text-slate-600">Zmed / Pend:</span>
                      <span className="font-bold">{data.meanZ.toFixed(1)}m · {data.meanSlopePct.toFixed(1)}%</span>
                    </div>
                    <div className="px-1.5 py-0.5 flex justify-between">
                      <span className="font-sans text-slate-600">Relieve:</span>
                      <span className="font-bold truncate max-w-[110px]">{data.reliefClass}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 border-b border-slate-900 font-mono">
                    <div className="px-1.5 py-0.5 border-r border-slate-900 flex items-center gap-1.5">
                      <span className="w-4 h-[2.5px] inline-block bg-[#9a3412]" />
                      <span>Maestra c/{data.masterInterval}m</span>
                    </div>
                    <div className="px-1.5 py-0.5 flex items-center gap-1.5">
                      <span className="w-4 h-[1.5px] inline-block bg-[#d97706]" />
                      <span>Interm. c/{data.interval}m</span>
                    </div>
                  </div>
                  <div className="px-1.5 py-0.5 flex items-center justify-between bg-slate-50 font-mono text-[7.5px]">
                    <span>Malla IGVSB: {demGridStepMeters}×{demGridStepMeters}m ({interiorNodes.length} ptos)</span>
                    <span className="font-bold text-slate-800">{data.contours.length} curvas</span>
                  </div>
                  {(data.uncertaintyWarning || data.sourceType === 'SATELLITE_DEM') && (
                    <div className="bg-amber-50 border-t border-slate-900 px-1.5 py-0.5 text-[7.2px] font-bold text-amber-950 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-700 shrink-0" />
                      <span className="truncate">{data.uncertaintyWarning || SATELLITE_DEM_WARNING}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="border border-slate-900 p-1.5 bg-slate-50 text-[7.8px] shrink-0 space-y-0.5">
                  <div className="font-extrabold uppercase text-slate-800">Simbología Planimétrica Oficial</div>
                  <div className="grid grid-cols-2 gap-1 font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-[2.5px] bg-[#b91c1c] inline-block" />
                      <span>Lindero Poligonal</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-[1px] border-t border-dashed border-slate-500 inline-block" />
                      <span>Grilla UTM (c/{activeGridStep}m)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── CUERPO 3 (20%): MEMBRETE REGLAMENTARIO VENEZOLANO ───────────── */}
            <div className="flex flex-col text-[8px] leading-tight h-full bg-white overflow-hidden">
              {/* 1. Encabezado */}
              <div className="p-2 border-b border-slate-900 text-center space-y-0.5 bg-slate-50">
                <div className="text-[9.5px] font-black uppercase tracking-wide text-slate-900">
                  {hasContours ? 'PLANO TOPOGRÁFICO Y DE MENSURA' : 'MENSURA DE TERRENO'}
                </div>
                <div className="text-left font-mono text-[7.5px] pt-0.5 space-y-0.5">
                  <div><span className="font-bold">ESTADO:</span> {estado || '________________'}</div>
                  <div><span className="font-bold">MUNICIPIO:</span> {municipio || '_____________'}</div>
                  <div><span className="font-bold">PARROQUIA:</span> {parroquia || '_____________'}</div>
                </div>
              </div>

              {/* 2. Amparada por el Documento */}
              <div className="p-1.5 border-b border-slate-900 space-y-0.5">
                <div className="font-extrabold text-center uppercase text-[7.8px]">Amparada por el Documento</div>
                <div className="font-mono text-[6.8px] leading-snug text-slate-800">{regText}</div>
              </div>

              {/* 3. Antecedentes y Observaciones */}
              <div className="p-1.5 border-b border-slate-900 space-y-0.5 min-h-[74px]">
                <div className="font-extrabold uppercase text-[7.8px]">Antecedentes y Observaciones</div>
                <div className="font-mono text-[6.8px] leading-snug text-slate-700 break-words">
                  {observacionesText}
                </div>
              </div>

              {/* 4. Croquis de Ubicación Local + Zonificación + Rosa Náutica */}
              <div className="grid grid-cols-[60%_40%] border-b border-slate-900 h-[190px]">
                <div className="border-r border-slate-900 p-1.5 flex flex-col justify-between">
                  <div className="text-[7.2px] font-extrabold uppercase text-center">
                    Plano de Ubicación Local
                  </div>
                  <svg viewBox="0 0 100 100" className="w-full h-[125px] border border-slate-300 bg-slate-50/40">
                    <line x1="50" y1="6" x2="50" y2="94" stroke="#cbd5e1" strokeWidth="0.6" strokeDasharray="2 2" />
                    <line x1="6" y1="50" x2="94" y2="50" stroke="#cbd5e1" strokeWidth="0.6" strokeDasharray="2 2" />
                    <polygon points={croquisPoints} fill="rgba(6,182,212,0.18)" stroke="#0e7490" strokeWidth="1.6" />
                  </svg>
                  <div className="text-[7px] font-mono font-bold text-center text-slate-700">
                    CROQUIS · ESC. 1:5000
                  </div>
                </div>

                <div className="p-1.5 flex flex-col justify-between text-[7px]">
                  <div className="space-y-1">
                    <div className="font-extrabold uppercase border-b border-slate-400 pb-0.5">Zonificación</div>
                    <div className="font-mono">ZONA: {zona || '—'}</div>
                    <div className="font-mono">SECC.: {seccion || '—'}</div>
                    <div className="font-mono break-all">CAT.: {cedulaCat || '—'}</div>
                  </div>
                  {/* Rosa Náutica */}
                  <div className="flex flex-col items-center pb-1">
                    <svg viewBox="0 0 60 60" className="w-12 h-12">
                      <circle cx="30" cy="30" r="18" fill="none" stroke="#0f172a" strokeWidth="1" />
                      <polygon points="30,6 25,28 30,23 35,28" fill="#0f172a" />
                      <polygon points="30,54 27,32 30,36 33,32" fill="#64748b" />
                      <text x="30" y="5" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#0f172a">N</text>
                      <text x="30" y="59" textAnchor="middle" fontSize="6" fill="#475569">S</text>
                      <text x="56" y="32" textAnchor="middle" fontSize="6" fill="#475569">E</text>
                      <text x="4" y="32" textAnchor="middle" fontSize="6" fill="#475569">O</text>
                    </svg>
                  </div>
                </div>
              </div>

              {/* 5. Propietario / Domicilio */}
              <div className="grid grid-cols-[60%_40%] border-b border-slate-900 min-h-[68px]">
                <div className="border-r border-slate-900 p-1.5 flex flex-col justify-between">
                  <div className="font-extrabold uppercase text-[7.2px]">Propietario:</div>
                  <div className="font-mono font-bold text-[7.5px] break-words">{propietario || '________________'}</div>
                  <div className="font-mono text-[7px]">C.I. / RIF: {rif || '__________'}</div>
                </div>
                <div className="p-1.5">
                  <div className="font-extrabold uppercase text-[7.2px]">Domicilio:</div>
                  <div className="font-mono text-[6.8px] break-words mt-0.5">{domicilio || '____________'}</div>
                </div>
              </div>

              {/* 6. Fecha, Escala y Profesional CIV */}
              <div className="grid grid-cols-[60%_40%] border-b border-slate-900 min-h-[64px]">
                <div className="border-r border-slate-900 p-1.5 flex flex-col justify-between font-mono text-[7.2px]">
                  <div>
                    <span className="font-sans font-extrabold block text-[7px]">FECHA DE MENSURA:</span>
                    <span>{parcelMeta?.fecha || new Date().toLocaleDateString('es-VE')}</span>
                  </div>
                  <div>
                    <span className="font-sans font-extrabold block text-[7px]">ESCALA:</span>
                    <span className="font-bold">1:{basePlan.printScale}</span>
                  </div>
                </div>
                <div className="p-1.5 flex flex-col justify-between font-mono text-[7px]">
                  <div>
                    <span className="font-sans font-extrabold block text-[7px]">PROFESIONAL:</span>
                    <span className="font-bold break-words">{profesional || 'ING. GEODESTA'}</span>
                  </div>
                  <div>REG. CIV: {civ || '______'}</div>
                </div>
              </div>

              {/* 7. Firmas y Catastro */}
              <div className="grid grid-cols-[60%_40%] border-b border-slate-900 h-[44px] text-[7px]">
                <div className="border-r border-slate-900 p-1 font-extrabold">REVISADO:</div>
                <div className="p-1 flex flex-col justify-between">
                  <span className="font-extrabold">LEVANTAMIENTO:</span>
                  <span className="font-mono">FIRMA:</span>
                </div>
              </div>
              <div className="grid grid-cols-[60%_40%] border-b border-slate-900 h-[46px] text-[7px]">
                <div className="border-r border-slate-900 p-1 flex flex-col justify-between">
                  <span className="font-extrabold">REGISTRADO:</span>
                  <span className="font-extrabold text-center">JEFE DE CATASTRO</span>
                </div>
                <div className="p-1 flex flex-col justify-between">
                  <span className="font-extrabold">DIGITALIZACIÓN:</span>
                  <span className="font-mono">FIRMA:</span>
                </div>
              </div>

              {/* 8. Membrete Resumen Oficial */}
              <div className="flex-1 p-1.5 bg-slate-50 flex flex-col justify-between text-[7px] font-mono">
                <div className="grid grid-cols-2 gap-x-1 border-b border-slate-300 pb-0.5">
                  <span className="font-bold">PROYECTO:</span>
                  <span className="truncate text-right">{projectMeta.nombre || 'GEOGIS6'}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-1 border-b border-slate-300 pb-0.5">
                  <span className="font-bold">DATUM HORIZ.:</span>
                  <span className="text-right">REGVEN GRS80</span>
                </div>
                <div className="grid grid-cols-2 gap-x-1 border-b border-slate-300 pb-0.5">
                  <span className="font-bold">DATUM VERT.:</span>
                  <span className="text-right">LA GUAIRA</span>
                </div>
                <div className="grid grid-cols-2 gap-x-1">
                  <span className="font-bold">N° DE PLANO:</span>
                  <span className="text-right font-bold">01 / {level === 3 ? '02' : '01'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== HOJA 2: ANEXO OFICIAL DE CUADRO DE CONSTRUCCIÓN (>38 VERTICES) ==================== */}
        {level === 3 && annexRows.length > 0 && (
          <div
            id="contour-print-annex"
            className="w-[1380px] min-w-[1380px] h-[976px] bg-white text-slate-900 border-2 border-slate-900 p-2 shadow-2xl shrink-0"
          >
            <div className="w-full h-full border-[1.5px] border-slate-900 flex flex-col bg-white p-3 gap-2">
              <div className="border border-slate-900 bg-slate-100 px-4 py-2 flex items-center justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-wider">
                    ANEXO: CONTINUACIÓN CUADRO DE CONSTRUCCIÓN CATASTRAL (UTM) — {basePlan.parcelName}
                  </div>
                  <div className="text-[10px] font-mono text-slate-600">
                    {datumLabel} · Escala 1:{basePlan.printScale} · Vértices {maxMainRows + 1} al {totalVerts} de {totalVerts}
                  </div>
                </div>
                <div className="text-xs font-mono font-bold">LÁMINA 02 / 02</div>
              </div>

              <div className="flex-1 grid gap-3 overflow-hidden" style={{ gridTemplateColumns: `repeat(${Math.min(3, annexChunks.length)}, minmax(0, 1fr))` }}>
                {annexChunks.map((chunk, cIdx) => {
                  const startNo = maxMainRows + cIdx * 45 + 1;
                  const endNo = startNo + chunk.length - 1;
                  return (
                    <div key={cIdx} className="border border-slate-900 flex flex-col overflow-hidden">
                      <div className="bg-slate-200 border-b border-slate-900 px-2 py-1 text-[9px] font-extrabold text-center uppercase">
                        CUADRO ANEXO ({startNo} - {endNo} DE {totalVerts})
                      </div>
                      <table className="w-full text-center font-mono border-collapse table-fixed">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-900 text-[8px] font-bold">
                            <th className="border-r border-slate-900 py-1 w-[12%]">LADO</th>
                            <th className="border-r border-slate-900 py-1 w-[24%]">RUMBO</th>
                            <th className="border-r border-slate-900 py-1 w-[11%]">DIST(m)</th>
                            <th className="border-r border-slate-900 py-1 w-[8%]">V</th>
                            <th className="border-r border-slate-900 py-1 w-[19%]">NORTE</th>
                            <th className={cn('py-1', hasContours ? 'border-r border-slate-900 w-[17%]' : 'w-[26%]')}>
                              ESTE
                            </th>
                            {hasContours && <th className="py-1 w-[9%]">Z(m)</th>}
                          </tr>
                        </thead>
                        <tbody className="text-[8px]">
                          {chunk.map((r, rIdx) => (
                            <tr key={rIdx} className="border-b border-slate-300 odd:bg-white even:bg-slate-50/70">
                              <td className="border-r border-slate-400 px-0.5 py-[2px] font-bold truncate">{r.lado}</td>
                              <td className="border-r border-slate-400 px-0.5 py-[2px] truncate">{r.rumbo}</td>
                              <td className="border-r border-slate-400 px-0.5 py-[2px] text-right">{r.dist}</td>
                              <td className="border-r border-slate-400 px-0.5 py-[2px] font-bold">{r.vert}</td>
                              <td className="border-r border-slate-400 px-0.5 py-[2px] text-right">{r.norte}</td>
                              <td className={cn('px-0.5 py-[2px] text-right', hasContours && 'border-r border-slate-400')}>
                                {r.este}
                              </td>
                              {hasContours && (
                                <td className="px-0.5 py-[2px] text-right font-semibold text-amber-900">{r.z}</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
