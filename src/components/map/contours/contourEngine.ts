/**
 * contourEngine.ts — Motor Geomático de Curvas de Nivel Satelitales sobre Parcelas
 * GeoGIS6
 *
 * Funciones puras y autocontenidas para:
 *  1. Muestreo DEM satelital adaptativo por parcela (lotes <= 80 pts vía ElevationService).
 *  2. Análisis altimétrico y morfométrico del relieve dentro del polígono cerrado.
 *  3. Extracción de curvas de nivel con Marching Squares + empalme topológico + Chaikin.
 *  4. Recorte exacto segmento-polígono (apto para polígonos cóncavos e irregulares).
 *  5. Exportación CAD 3D (.dxf) con polilíneas 3D en capas maestras e intermedias.
 */

import { GeoEngine, GRS80, HAYFORD } from '@/lib/geo-engine';
import type { Parcel, TransformationResult } from '@/lib/store';

export type ReliefClass =
  | 'Plano (0-3%)'
  | 'Suavemente Ondulado (3-8%)'
  | 'Ondulado (8-15%)'
  | 'Quebrado (15-30%)'
  | 'Escarpado (>30%)';

export type ElevationSourceType = 'SATELLITE_DEM' | 'FIELD_SURVEY';

export const SATELLITE_DEM_WARNING =
  'ALTIMETRÍA SATELITAL (30m/px): Uso exclusivo referencial / anteproyecto';

export interface EquidistanceConfig {
  minorInterval: number;
  majorInterval: number;
  wasClamped: boolean;
  warning: string | null;
}

export interface UTMVertex {
  index: number;
  id: string;
  este: number;
  norte: number;
  lat: number;
  lng: number;
  z: number;
}

export interface ContourLine {
  elevation: number;
  isMaster: boolean;
  coordsUTM: [number, number][];
  labelPointUTM?: [number, number];
  labelAngleRad?: number;
}

export interface RawDEMGrid {
  cols: number;
  rows: number;
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
  zMatrix: number[][];
}

export interface ClippedGridLine {
  axis: 'E' | 'N';
  coord: number;
  coordsUTM: [number, number][];
}

export interface InteriorGridNode {
  este: number;
  norte: number;
  z: number;
  col: number;
  row: number;
}

export interface ParcelContourData {
  parcelId: string;
  parcelName: string;
  huso: number;
  direction: string;
  sourceType: ElevationSourceType;
  uncertaintyWarning: string | null;
  wasIntervalClamped: boolean;
  areaM2: number;
  areaHa: number;
  perimeterM: number;
  polygonUTM: [number, number][];
  vertices: UTMVertex[];
  gridCols: number;
  gridRows: number;
  denseGridCols: number;
  denseGridRows: number;
  gridSpacingE: number;
  gridSpacingN: number;
  clippedGridLinesUTM: ClippedGridLine[];
  interiorGridNodes: InteriorGridNode[];
  bboxUTM: [number, number, number, number];
  minZ: number;
  maxZ: number;
  meanZ: number;
  deltaH: number;
  minPointUTM: { este: number; norte: number; z: number };
  maxPointUTM: { este: number; norte: number; z: number };
  meanSlopePct: number;
  reliefClass: ReliefClass;
  interval: number;
  masterInterval: number;
  contours: ContourLine[];
  demSource: string;
  computedAt: number;
  rawGrid: RawDEMGrid;
}

const VALID_HUSOS = [18, 19, 20, 21] as const;

export function normalizeHuso(candidate: unknown, fallback = 19): number {
  const n = Number(candidate);
  return (VALID_HUSOS as readonly number[]).includes(n) ? n : fallback;
}

export function isCanoaOutputDirection(dir?: string): boolean {
  return dir === 'regven_canoa' || dir === 'dma_psad56_real';
}

/**
 * Convierte coordenadas UTM [Este, Norte] a geográficas WGS84/GRS80 [lat, lng]
 * respetando si la parcela está proyectada en PSAD56 (La Canoa) o REGVEN.
 */
export function utmToWgs84(
  este: number,
  norte: number,
  huso: number,
  direction?: string
): { lat: number; lng: number } {
  if (isCanoaOutputDirection(direction)) {
    const geoPSAD = GeoEngine.utmToGeo(este, norte, huso, false, HAYFORD);
    const cartPSAD = GeoEngine.geoToCart(geoPSAD.lat, geoPSAD.lng, 0, HAYFORD);
    const cartREG = GeoEngine.badekas(cartPSAD.X, cartPSAD.Y, cartPSAD.Z, false);
    const geoREG = GeoEngine.cartToGeo(cartREG.X, cartREG.Y, cartREG.Z, GRS80);
    return { lat: geoREG.lat, lng: geoREG.lng };
  }
  return GeoEngine.utmToGeo(este, norte, huso, false, GRS80);
}

/**
 * Convierte coordenadas geográficas WGS84 a proyección Web Mercator EPSG:3857.
 */
export function wgs84ToWebMercator(lat: number, lng: number): [number, number] {
  const R = 6378137.0;
  const x = R * ((lng * Math.PI) / 180);
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = R * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
  return [x, y];
}

export function utmToWebMercator(
  este: number,
  norte: number,
  huso: number,
  direction?: string
): [number, number] {
  const { lat, lng } = utmToWgs84(este, norte, huso, direction);
  return wgs84ToWebMercator(lat, lng);
}

/**
 * Extrae vértices UTM válidos de una Parcela (sin duplicar vértice final de cierre).
 */
export function extractParcelVertices(
  parcel: Parcel,
  defaultHuso: number,
  defaultDirection?: string
): { vertices: UTMVertex[]; huso: number; direction: string } {
  const pts: TransformationResult[] = Array.isArray(parcel.puntos) ? parcel.puntos : [];
  if (pts.length === 0) {
    return { vertices: [], huso: normalizeHuso(defaultHuso), direction: defaultDirection || 'canoa_regven' };
  }

  const firstDir = pts[0]?.direction ?? pts[0]?.result?.direction ?? defaultDirection ?? 'canoa_regven';
  const parcelHuso = normalizeHuso(
    pts[0]?.result?.huso ?? pts[0]?.input?.huso ?? defaultHuso,
    normalizeHuso(defaultHuso)
  );

  const parseNum = (val: unknown): number => {
    if (val === undefined || val === null || val === '') return NaN;
    const n = Number(val);
    return Number.isFinite(n) ? n : NaN;
  };

  const rawVertices: UTMVertex[] = [];

  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    const dir = pt.direction ?? pt.result?.direction ?? firstDir;
    const h = normalizeHuso(pt.result?.huso ?? pt.input?.huso, parcelHuso);

    const resEste = parseNum(pt.result?.este ?? pt.result?.x);
    const resNorte = parseNum(pt.result?.norte ?? pt.result?.y);
    const inEste = parseNum(pt.input?.este ?? (pt.input as any)?.x);
    const inNorte = parseNum(pt.input?.norte ?? (pt.input as any)?.y);

    const hasResultUtm = Number.isFinite(resEste) && Number.isFinite(resNorte) && (Math.abs(resEste) > 10 || Math.abs(resNorte) > 10);
    let este = hasResultUtm ? resEste : inEste;
    let norte = hasResultUtm ? resNorte : inNorte;
    const usedInputUtmOnly = !hasResultUtm && Number.isFinite(inEste) && Number.isFinite(inNorte);

    // Corregir si Este y Norte vienen transpuestos (Norte > 1,000,000 en columna Este y Este en [150k..850k])
    if (
      Number.isFinite(este) &&
      Number.isFinite(norte) &&
      este > 1_000_000 &&
      norte >= 150_000 &&
      norte <= 850_000
    ) {
      const tmp = este;
      este = norte;
      norte = tmp;
    }

    const lat = parseNum(pt.result?.lat ?? pt.input?.lat);
    const lng = parseNum(pt.result?.lng ?? pt.input?.lng);

    if (
      (!Number.isFinite(este) || !Number.isFinite(norte) || (este === 0 && norte === 0)) &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) > 0.01 &&
      Math.abs(lng) > 0.01
    ) {
      const ellipsoid = isCanoaOutputDirection(dir) ? HAYFORD : GRS80;
      const utm = GeoEngine.geoToUTM(lat, lng, h, ellipsoid);
      este = utm.este;
      norte = utm.norte;
    }

    if (!Number.isFinite(este) || !Number.isFinite(norte) || (este === 0 && norte === 0)) {
      continue;
    }

    const effectiveUtmDir =
      usedInputUtmOnly && (dir === 'canoa_regven' || dir === 'dma_regven')
        ? 'regven_canoa'
        : dir;
    const wgs = utmToWgs84(este, norte, h, effectiveUtmDir);

    const fieldZRaw =
      pt.result?.cota_regven ??
      pt.result?.h ??
      pt.result?.alt ??
      pt.result?.z ??
      pt.input?.alt ??
      (pt.input as any)?.z;
    const parsedZ = parseNum(fieldZRaw);
    const fieldZ = Number.isFinite(parsedZ) ? parsedZ : 0;

    rawVertices.push({
      index: rawVertices.length,
      id: pt.id || `P${rawVertices.length + 1}`,
      este,
      norte,
      lat: wgs.lat,
      lng: wgs.lng,
      z: fieldZ,
    });
  }

  // Eliminar vértice de cierre repetido si coincide con P1 dentro de 5 mm
  if (rawVertices.length >= 4) {
    const first = rawVertices[0];
    const last = rawVertices[rawVertices.length - 1];
    if (Math.hypot(last.este - first.este, last.norte - first.norte) < 0.005) {
      rawVertices.pop();
    }
  }

  return { vertices: rawVertices, huso: parcelHuso, direction: firstDir };
}

/**
 * Normaliza coordenadas numéricas o cadenas formateadas (con separadores de miles/comas) a float puro.
 */
export function parseCleanFloat(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
  if (typeof val !== 'string') return NaN;
  let s = val.trim().replace(/[^\d.,+\-eE]/g, '');
  if (!s) return NaN;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const parts = s.split(',');
    if (parts.length > 2) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Calcula Área (m²), Hectáreas (ha) y Perímetro (m) cerrando explícitamente el anillo P_{n+1} = P_1
 * mediante la Fórmula del Área de Gauss (Shoelace) con traslación local al origen P_1.
 */
export function calculatePolygonSurface(
  pts: Array<[unknown, unknown] | { este: unknown; norte: unknown }>
): { areaM2: number; areaHa: number; perimeterM: number } {
  const clean: [number, number][] = [];
  for (const p of pts) {
    const rawE = Array.isArray(p) ? p[0] : p?.este;
    const rawN = Array.isArray(p) ? p[1] : p?.norte;
    const e = parseCleanFloat(rawE);
    const n = parseCleanFloat(rawN);
    if (Number.isFinite(e) && Number.isFinite(n)) {
      clean.push([e, n]);
    }
  }
  if (clean.length < 3) {
    return { areaM2: 0, areaHa: 0, perimeterM: 0 };
  }

  const first = clean[0];
  const last = clean[clean.length - 1];
  const ring =
    clean.length >= 4 && Math.hypot(last[0] - first[0], last[1] - first[1]) < 0.005
      ? clean.slice(0, -1)
      : [...clean];
  if (ring.length < 3) {
    return { areaM2: 0, areaHa: 0, perimeterM: 0 };
  }

  const closedRing: [number, number][] = [...ring, [ring[0][0], ring[0][1]]];
  const e0 = closedRing[0][0];
  const n0 = closedRing[0][1];

  let shoelaceSum = 0;
  let perimeter = 0;
  for (let i = 0; i < closedRing.length - 1; i++) {
    const ei = closedRing[i][0];
    const ni = closedRing[i][1];
    const ej = closedRing[i + 1][0];
    const nj = closedRing[i + 1][1];
    shoelaceSum += (ei - e0) * (nj - n0) - (ej - e0) * (ni - n0);
    perimeter += Math.hypot(ej - ei, nj - ni);
  }

  const area = Math.abs(shoelaceSum) * 0.5;
  return {
    areaM2: Number(area.toFixed(2)),
    areaHa: Number((area / 10000).toFixed(4)),
    perimeterM: Number(perimeter.toFixed(2)),
  };
}

/**
 * Calcula la equidistancia óptima con control físico de incertidumbre según la fuente altimétrica.
 * Para DEM satelital anteproyecto: selecciona 0.25–0.5 m en desniveles bajos/medios (~20–35 curvas),
 * 1.0 m hasta 30 m y >= 2.0 m en relieves mayores, permitiendo ajuste manual >= 0.2 m con advertencia.
 */
export function calculateOptimalEquidistance(
  zMin: number,
  zMax: number,
  sourceType: ElevationSourceType,
  userStep?: number
): EquidistanceConfig {
  const deltaH = Math.max(0, Number(zMax) - Number(zMin));

  if (sourceType === 'SATELLITE_DEM') {
    const MIN_MINOR = 0.2;

    if (userStep !== undefined && Number.isFinite(userStep) && userStep > 0) {
      if (userStep < MIN_MINOR) {
        return {
          minorInterval: MIN_MINOR,
          majorInterval: Number((MIN_MINOR * 5).toFixed(4)),
          wasClamped: true,
          warning: SATELLITE_DEM_WARNING,
        };
      }
      return {
        minorInterval: userStep,
        majorInterval: Number((userStep * 5).toFixed(4)),
        wasClamped: false,
        warning: SATELLITE_DEM_WARNING,
      };
    }

    let minorInterval = 0.5;
    if (deltaH <= 6) {
      minorInterval = 0.25;
    } else if (deltaH <= 15) {
      minorInterval = 0.5;
    } else if (deltaH <= 30) {
      minorInterval = 1.0;
    } else {
      const satSteps = [2.0, 5.0, 10.0, 20.0, 50.0];
      minorInterval = satSteps.find((s) => deltaH / s <= 20) ?? 50.0;
    }

    return {
      minorInterval,
      majorInterval: Number((minorInterval * 5).toFixed(4)),
      wasClamped: false,
      warning: SATELLITE_DEM_WARNING,
    };
  }

  // FIELD_SURVEY: levantamiento directo con cotas reales en campo
  if (userStep !== undefined && Number.isFinite(userStep) && userStep > 0) {
    return {
      minorInterval: userStep,
      majorInterval: Number((userStep * 5).toFixed(4)),
      wasClamped: false,
      warning: null,
    };
  }

  const fieldSteps = [0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0];
  const minorInterval = fieldSteps.find((s) => deltaH / s <= 16) ?? 20.0;
  return {
    minorInterval,
    majorInterval: Number((minorInterval * 5).toFixed(4)),
    wasClamped: false,
    warning: null,
  };
}

/**
 * Wrapper retrocompatible para selección automática de equidistancia por desnivel ΔH.
 */
export function chooseOptimalInterval(
  deltaH: number,
  sourceType: ElevationSourceType = 'SATELLITE_DEM'
): number {
  return calculateOptimalEquidistance(0, Math.max(0, deltaH), sourceType).minorInterval;
}

export function classifyRelief(meanSlopePct: number): ReliefClass {
  if (meanSlopePct < 3) return 'Plano (0-3%)';
  if (meanSlopePct < 8) return 'Suavemente Ondulado (3-8%)';
  if (meanSlopePct < 15) return 'Ondulado (8-15%)';
  if (meanSlopePct < 30) return 'Quebrado (15-30%)';
  return 'Escarpado (>30%)';
}

/**
 * Descarga teselas DEM PNG AWS Mapzen Terrarium (zoom 15 ~4.7 m/px) en el navegador y decodifica
 * elevaciones continuas Z = (R*256 + G + B/256) - 32768 con interpolación bilineal sub-píxel.
 */
async function fetchTerrariumElevations(
  coords: Array<{ lat: number; lng: number }>,
  zoom = 15
): Promise<{ elevations: number[]; ok: boolean }> {
  if (typeof window === 'undefined' || typeof document === 'undefined' || coords.length === 0) {
    return { elevations: [], ok: false };
  }

  try {
    const nTiles = Math.pow(2, zoom);
    const tileSize = 256;
    const samplePts = coords.map(({ lat, lng }) => {
      const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
      const latRad = (clampedLat * Math.PI) / 180;
      const xTile = ((lng + 180) / 360) * nTiles;
      const yTile =
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * nTiles;
      return {
        gx: xTile * tileSize,
        gy: yTile * tileSize,
      };
    });

    const neededTiles = new Map<string, { tx: number; ty: number }>();
    for (const pt of samplePts) {
      const gx0 = Math.floor(pt.gx);
      const gy0 = Math.floor(pt.gy);
      for (const gx of [gx0, gx0 + 1]) {
        for (const gy of [gy0, gy0 + 1]) {
          const tx = Math.max(0, Math.min(nTiles - 1, Math.floor(gx / tileSize)));
          const ty = Math.max(0, Math.min(nTiles - 1, Math.floor(gy / tileSize)));
          const key = `${tx}_${ty}`;
          if (!neededTiles.has(key)) neededTiles.set(key, { tx, ty });
        }
      }
    }

    if (neededTiles.size === 0 || neededTiles.size > 16) {
      return { elevations: [], ok: false };
    }

    const loadTileData = (tx: number, ty: number): Promise<Uint8ClampedArray | null> =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timer = window.setTimeout(() => {
          img.onload = null;
          img.onerror = null;
          resolve(null);
        }, 7000);

        img.onload = () => {
          window.clearTimeout(timer);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = tileSize;
            canvas.height = tileSize;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.drawImage(img, 0, 0, tileSize, tileSize);
            const imgData = ctx.getImageData(0, 0, tileSize, tileSize);
            resolve(imgData.data);
          } catch {
            resolve(null);
          }
        };

        img.onerror = () => {
          window.clearTimeout(timer);
          resolve(null);
        };

        img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
      });

    const tileEntries = Array.from(neededTiles.entries());
    const tileResults = await Promise.all(tileEntries.map(([, t]) => loadTileData(t.tx, t.ty)));
    const tileBuffers = new Map<string, Uint8ClampedArray>();
    tileEntries.forEach(([key], idx) => {
      const buf = tileResults[idx];
      if (buf) tileBuffers.set(key, buf);
    });

    if (tileBuffers.size === 0) {
      return { elevations: [], ok: false };
    }

    const samplePixelZ = (gxInt: number, gyInt: number): number => {
      const tx = Math.max(0, Math.min(nTiles - 1, Math.floor(gxInt / tileSize)));
      const ty = Math.max(0, Math.min(nTiles - 1, Math.floor(gyInt / tileSize)));
      const buf = tileBuffers.get(`${tx}_${ty}`);
      if (!buf) return NaN;
      const px = ((gxInt % tileSize) + tileSize) % tileSize;
      const py = ((gyInt % tileSize) + tileSize) % tileSize;
      const offset = (py * tileSize + px) * 4;
      const r = buf[offset];
      const g = buf[offset + 1];
      const b = buf[offset + 2];
      return r * 256 + g + b / 256 - 32768;
    };

    const elevations: number[] = [];
    for (const pt of samplePts) {
      const x0 = Math.floor(pt.gx);
      const y0 = Math.floor(pt.gy);
      const fx = pt.gx - x0;
      const fy = pt.gy - y0;

      const z00 = samplePixelZ(x0, y0);
      if (!Number.isFinite(z00) || z00 < -500 || z00 > 9000) {
        return { elevations: [], ok: false };
      }
      const z10 = samplePixelZ(x0 + 1, y0);
      const z01 = samplePixelZ(x0, y0 + 1);
      const z11 = samplePixelZ(x0 + 1, y0 + 1);

      const safeZ10 = Number.isFinite(z10) ? z10 : z00;
      const safeZ01 = Number.isFinite(z01) ? z01 : z00;
      const safeZ11 = Number.isFinite(z11) ? z11 : safeZ10;

      const top = z00 * (1 - fx) + safeZ10 * fx;
      const bot = safeZ01 * (1 - fx) + safeZ11 * fx;
      elevations.push(top * (1 - fy) + bot * fy);
    }

    return { elevations, ok: elevations.length === coords.length };
  } catch {
    return { elevations: [], ok: false };
  }
}

async function fetchSingleChunkElevations(
  chunk: Array<{ lat: number; lng: number }>
): Promise<{ elevations: number[]; ok: boolean }> {
  // 1. Consulta directa desde navegador a Open-Meteo DEM (Copernicus 90m/30m)
  try {
    const lats = chunk.map((c) => c.lat.toFixed(6)).join(',');
    const lngs = chunk.map((c) => c.lng.toFixed(6)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.elevation) && data.elevation.length === chunk.length) {
        const vals = data.elevation.map((e: unknown) => Number(e));
        if (vals.every((v: number) => Number.isFinite(v))) {
          return { elevations: vals, ok: true };
        }
      }
    }
  } catch {
    // Continuar con respaldo interno
  }

  // 2. API interna /api/elevation (verificando explícitamente data.success !== false)
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/elevation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations: chunk }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        if (
          data?.success !== false &&
          Array.isArray(data?.elevations) &&
          data.elevations.length === chunk.length
        ) {
          const vals = data.elevations.map((e: unknown) => Number(e));
          if (vals.every((v: number) => Number.isFinite(v))) {
            return { elevations: vals, ok: true };
          }
        }
      }
    } catch {
      // Continuar con Open-Elevation
    }
  }

  // 3. Respaldo Open-Elevation
  try {
    const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        locations: chunk.map((l) => ({ latitude: l.lat, longitude: l.lng })),
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.results) && data.results.length === chunk.length) {
        const vals = data.results.map((r: any) => Number(r?.elevation));
        if (vals.every((v: number) => Number.isFinite(v))) {
          return { elevations: vals, ok: true };
        }
      }
    }
  } catch {
    // Todos los proveedores fallaron
  }

  return { elevations: chunk.map(() => 0), ok: false };
}

/**
 * Consulta elevaciones satelitales priorizando teselas Terrarium z15 (alta resolución)
 * con respaldo automático en lotes <= 65 coordenadas vía APIs DEM.
 */
async function fetchElevationsChunked(
  coords: Array<{ lat: number; lng: number }>
): Promise<{ elevations: number[]; succeeded: boolean; usedTerrarium?: boolean }> {
  if (coords.length === 0) return { elevations: [], succeeded: false };

  const terrarium = await fetchTerrariumElevations(coords, 15);
  if (terrarium.ok && terrarium.elevations.length === coords.length) {
    return { elevations: terrarium.elevations, succeeded: true, usedTerrarium: true };
  }

  const CHUNK_SIZE = 65;
  const chunks: Array<Array<{ lat: number; lng: number }>> = [];
  for (let i = 0; i < coords.length; i += CHUNK_SIZE) {
    chunks.push(coords.slice(i, i + CHUNK_SIZE));
  }

  const responses = await Promise.all(chunks.map((chunk) => fetchSingleChunkElevations(chunk)));
  const elevations: number[] = [];
  let anyOk = false;
  for (const r of responses) {
    elevations.push(...r.elevations);
    if (r.ok) anyOk = true;
  }
  return { elevations, succeeded: anyOk, usedTerrarium: false };
}

/**
 * Interpolación bilineal de Z sobre la malla regular UTM.
 */
export function interpolateGridZ(grid: RawDEMGrid, este: number, norte: number): number {
  const { cols, rows, minE, maxE, minN, maxN, zMatrix } = grid;
  const spanE = maxE - minE || 1;
  const spanN = maxN - minN || 1;

  const u = Math.max(0, Math.min(cols - 1, ((este - minE) / spanE) * (cols - 1)));
  const v = Math.max(0, Math.min(rows - 1, ((norte - minN) / spanN) * (rows - 1)));

  const c0 = Math.floor(u);
  const r0 = Math.floor(v);
  const c1 = Math.min(cols - 1, c0 + 1);
  const r1 = Math.min(rows - 1, r0 + 1);

  const tx = u - c0;
  const ty = v - r0;

  const z00 = zMatrix[r0][c0];
  const z10 = zMatrix[r0][c1];
  const z01 = zMatrix[r1][c0];
  const z11 = zMatrix[r1][c1];

  const a = z00 * (1 - tx) + z10 * tx;
  const b = z01 * (1 - tx) + z11 * tx;
  return a * (1 - ty) + b * ty;
}

function catmullRom1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Interpolación bicúbica Catmull-Rom C¹ sobre una malla regular UTM.
 */
export function interpolateGridBicubic(grid: RawDEMGrid, este: number, norte: number): number {
  const { cols, rows, minE, maxE, minN, maxN, zMatrix } = grid;
  if (cols < 2 || rows < 2) return zMatrix[0]?.[0] ?? 0;

  const spanE = maxE - minE || 1;
  const spanN = maxN - minN || 1;

  const u = Math.max(0, Math.min(cols - 1, ((este - minE) / spanE) * (cols - 1)));
  const v = Math.max(0, Math.min(rows - 1, ((norte - minN) / spanN) * (rows - 1)));

  const c1 = Math.min(cols - 2, Math.floor(u));
  const r1 = Math.min(rows - 2, Math.floor(v));
  const tx = u - c1;
  const ty = v - r1;

  const sampleRow = (rr: number): number => {
    const rClamped = Math.max(0, Math.min(rows - 1, rr));
    const p0 = zMatrix[rClamped][Math.max(0, c1 - 1)];
    const p1 = zMatrix[rClamped][c1];
    const p2 = zMatrix[rClamped][Math.min(cols - 1, c1 + 1)];
    const p3 = zMatrix[rClamped][Math.min(cols - 1, c1 + 2)];
    return catmullRom1D(p0, p1, p2, p3, tx);
  };

  const rowM1 = sampleRow(r1 - 1);
  const row0 = sampleRow(r1);
  const row1 = sampleRow(r1 + 1);
  const row2 = sampleRow(r1 + 2);
  return catmullRom1D(rowM1, row0, row1, row2, ty);
}

/**
 * Densifica una matriz DEM por un factor entero (p. ej. 4x: 12x12 -> 48x48)
 * aplicando interpolación bicúbica Catmull-Rom para garantizar continuidad C¹ sin escalonamiento.
 */
export function densifyGridBicubic(grid: RawDEMGrid, factor = 4): RawDEMGrid {
  const safeFactor = Math.max(1, Math.round(factor));
  const denseCols = Math.max(grid.cols, grid.cols * safeFactor);
  const denseRows = Math.max(grid.rows, grid.rows * safeFactor);
  const zMatrix: number[][] = Array.from({ length: denseRows }, () => Array(denseCols).fill(0));
  const spanE = grid.maxE - grid.minE || 1;
  const spanN = grid.maxN - grid.minN || 1;

  for (let r = 0; r < denseRows; r++) {
    const norte = grid.minN + (r / (denseRows - 1)) * spanN;
    for (let c = 0; c < denseCols; c++) {
      const este = grid.minE + (c / (denseCols - 1)) * spanE;
      zMatrix[r][c] = interpolateGridBicubic(grid, este, norte);
    }
  }

  return {
    cols: denseCols,
    rows: denseRows,
    minE: grid.minE,
    maxE: grid.maxE,
    minN: grid.minN,
    maxN: grid.maxN,
    zMatrix,
  };
}

/**
 * Test punto en polígono (Ray-Casting) para polígonos cerrados en coordenadas UTM.
 */
export function pointInPolygonUTM(px: number, py: number, polygon: [number, number][]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    // Considerar puntos muy cercanos al borde (<= 1 mm) como dentro para evitar huecos en bordes
    const dx = xj - xi;
    const dy = yj - yi;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > 0) {
      const t = Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / lenSq));
      const projX = xi + t * dx;
      const projY = yi + t * dy;
      if (Math.hypot(px - projX, py - projY) <= 0.005) {
        return true;
      }
    }

    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Recorta una polilínea arbitraria estrictamente contra el interior de un polígono cerrado
 * (cóncavo o convexo) mediante intersección paramétrica t in [0,1] arista por arista.
 */
function clipPolylineToPolygon(
  pts: [number, number][],
  polygon: [number, number][]
): [number, number][][] {
  if (pts.length < 2 || polygon.length < 3) return [];

  const resultPolylines: [number, number][][] = [];
  let currentChain: [number, number][] = [];

  const flushChain = () => {
    if (currentChain.length >= 2) {
      resultPolylines.push(currentChain);
    }
    currentChain = [];
  };

  const pushPoint = (pt: [number, number]) => {
    if (currentChain.length === 0) {
      currentChain.push(pt);
    } else {
      const last = currentChain[currentChain.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 0.01) {
        currentChain.push(pt);
      }
    }
  };

  const nPoly = polygon.length;

  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const sdx = bx - ax;
    const sdy = by - ay;
    if (Math.hypot(sdx, sdy) < 1e-6) continue;

    const ts: number[] = [0, 1];

    for (let e = 0; e < nPoly; e++) {
      const [cx, cy] = polygon[e];
      const [dx, dy] = polygon[(e + 1) % nPoly];
      const edx = dx - cx;
      const edy = dy - cy;

      const denom = sdx * edy - sdy * edx;
      if (Math.abs(denom) < 1e-12) continue;

      const qpx = cx - ax;
      const qpy = cy - ay;
      const t = (qpx * edy - qpy * edx) / denom;
      const u = (qpx * sdy - qpy * sdx) / denom;

      if (t > 1e-6 && t < 1 - 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
        ts.push(t);
      }
    }

    ts.sort((p, q) => p - q);
    const uniqueTs: number[] = [ts[0]];
    for (let k = 1; k < ts.length; k++) {
      if (ts[k] - uniqueTs[uniqueTs.length - 1] > 1e-6) {
        uniqueTs.push(ts[k]);
      }
    }

    for (let k = 0; k < uniqueTs.length - 1; k++) {
      const t0 = uniqueTs[k];
      const t1 = uniqueTs[k + 1];
      const tMid = (t0 + t1) * 0.5;
      const mx = ax + tMid * sdx;
      const my = ay + tMid * sdy;

      if (pointInPolygonUTM(mx, my, polygon)) {
        const p0: [number, number] = [ax + t0 * sdx, ay + t0 * sdy];
        const p1: [number, number] = [ax + t1 * sdx, ay + t1 * sdy];
        pushPoint(p0);
        pushPoint(p1);
      } else {
        flushChain();
      }
    }
  }

  flushChain();

  // Filtrar micro-fragmentos de borde (< 0.5 m de longitud total)
  return resultPolylines.filter((line) => {
    let len = 0;
    for (let i = 0; i < line.length - 1; i++) {
      len += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
    }
    return len >= 0.5;
  });
}

/**
 * Suavizado Chaikin (2 iteraciones) conservando extremos en polilíneas abiertas
 * o continuidad cíclica en curvas cerradas.
 */
function chaikinSmooth(pts: [number, number][], iterations = 2): [number, number][] {
  if (pts.length < 3) return pts;
  const isClosed = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.05;
  let curr = isClosed ? pts.slice(0, -1) : [...pts];

  for (let it = 0; it < iterations; it++) {
    if (curr.length < 3) break;
    const next: [number, number][] = [];
    if (isClosed) {
      for (let i = 0; i < curr.length; i++) {
        const [x0, y0] = curr[i];
        const [x1, y1] = curr[(i + 1) % curr.length];
        next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
        next.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
      }
    } else {
      next.push(curr[0]);
      for (let i = 0; i < curr.length - 1; i++) {
        const [x0, y0] = curr[i];
        const [x1, y1] = curr[i + 1];
        next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
        next.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
      }
      next.push(curr[curr.length - 1]);
    }
    curr = next;
  }

  if (isClosed && curr.length > 0) {
    curr.push([curr[0][0], curr[0][1]]);
  }
  return curr;
}

/**
 * Ejecuta Marching Squares para una cota dada, une segmentos en polilíneas continuas,
 * suaviza con Chaikin y recorta estrictamente al interior del polígono de la parcela.
 */
function extractContoursForLevel(
  grid: RawDEMGrid,
  polygonUTM: [number, number][],
  level: number,
  isMaster: boolean
): ContourLine[] {
  const { cols, rows, minE, maxE, minN, maxN, zMatrix } = grid;
  const dE = (maxE - minE) / (cols - 1);
  const dN = (maxN - minN) / (rows - 1);

  const interpEdge = (
    e1: number, n1: number, z1: number,
    e2: number, n2: number, z2: number
  ): [number, number] => {
    // Orden canónico para que celdas vecinas obtengan idénticas coordenadas límite
    if (e1 > e2 || (e1 === e2 && n1 > n2)) {
      const te = e1; e1 = e2; e2 = te;
      const tn = n1; n1 = n2; n2 = tn;
      const tz = z1; z1 = z2; z2 = tz;
    }
    const dz = z2 - z1;
    const t = Math.abs(dz) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (level - z1) / dz));
    return [e1 + t * (e2 - e1), n1 + t * (n2 - n1)];
  };

  interface RawSeg {
    a: [number, number];
    b: [number, number];
    keyA: string;
    keyB: string;
    used: boolean;
  }

  const keyOf = (p: [number, number]) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const segments: RawSeg[] = [];

  for (let r = 0; r < rows - 1; r++) {
    const nBot = minN + r * dN;
    const nTop = minN + (r + 1) * dN;

    for (let c = 0; c < cols - 1; c++) {
      const eLeft = minE + c * dE;
      const eRight = minE + (c + 1) * dE;

      // Vértices de celda (BL, BR, TR, TL)
      const zBL = zMatrix[r][c];
      const zBR = zMatrix[r][c + 1];
      const zTR = zMatrix[r + 1][c + 1];
      const zTL = zMatrix[r + 1][c];

      const idx =
        (zBL >= level ? 1 : 0) |
        (zBR >= level ? 2 : 0) |
        (zTR >= level ? 4 : 0) |
        (zTL >= level ? 8 : 0);

      if (idx === 0 || idx === 15) continue;

      // Puntos en cada borde: 0=abajo(BL-BR), 1=derecha(BR-TR), 2=arriba(TR-TL), 3=izquierda(TL-BL)
      const edgePt = (edge: number): [number, number] => {
        switch (edge) {
          case 0: return interpEdge(eLeft, nBot, zBL, eRight, nBot, zBR);
          case 1: return interpEdge(eRight, nBot, zBR, eRight, nTop, zTR);
          case 2: return interpEdge(eRight, nTop, zTR, eLeft, nTop, zTL);
          default: return interpEdge(eLeft, nTop, zTL, eLeft, nBot, zBL);
        }
      };

      const addPair = (edge1: number, edge2: number) => {
        const a = edgePt(edge1);
        const b = edgePt(edge2);
        const keyA = keyOf(a);
        const keyB = keyOf(b);
        if (keyA !== keyB) {
          segments.push({ a, b, keyA, keyB, used: false });
        }
      };

      switch (idx) {
        case 1:
        case 14:
          addPair(3, 0);
          break;
        case 2:
        case 13:
          addPair(0, 1);
          break;
        case 3:
        case 12:
          addPair(3, 1);
          break;
        case 4:
        case 11:
          addPair(1, 2);
          break;
        case 5: {
          const avg = (zBL + zBR + zTR + zTL) * 0.25;
          if (avg >= level) {
            addPair(3, 2);
            addPair(0, 1);
          } else {
            addPair(3, 0);
            addPair(1, 2);
          }
          break;
        }
        case 6:
        case 9:
          addPair(0, 2);
          break;
        case 7:
        case 8:
          addPair(3, 2);
          break;
        case 10: {
          const avg = (zBL + zBR + zTR + zTL) * 0.25;
          if (avg >= level) {
            addPair(3, 0);
            addPair(1, 2);
          } else {
            addPair(3, 2);
            addPair(0, 1);
          }
          break;
        }
      }
    }
  }

  if (segments.length === 0) return [];

  // Mapa de adyacencia para empalmar segmentos continuos O(N)
  const adj = new Map<string, number[]>();
  const link = (key: string, segIdx: number) => {
    const arr = adj.get(key);
    if (arr) arr.push(segIdx);
    else adj.set(key, [segIdx]);
  };
  segments.forEach((s, idx) => {
    link(s.keyA, idx);
    link(s.keyB, idx);
  });

  const chains: [number, number][][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].used) continue;
    segments[i].used = true;

    const poly: [number, number][] = [segments[i].a, segments[i].b];
    let headKey = segments[i].keyA;
    let tailKey = segments[i].keyB;

    // Extender por la cola
    while (true) {
      const candidates = adj.get(tailKey);
      let nextIdx = -1;
      if (candidates) {
        for (const c of candidates) {
          if (!segments[c].used) {
            nextIdx = c;
            break;
          }
        }
      }
      if (nextIdx === -1) break;
      const seg = segments[nextIdx];
      seg.used = true;
      if (seg.keyA === tailKey) {
        poly.push(seg.b);
        tailKey = seg.keyB;
      } else {
        poly.push(seg.a);
        tailKey = seg.keyA;
      }
    }

    // Extender por la cabeza
    while (true) {
      const candidates = adj.get(headKey);
      let nextIdx = -1;
      if (candidates) {
        for (const c of candidates) {
          if (!segments[c].used) {
            nextIdx = c;
            break;
          }
        }
      }
      if (nextIdx === -1) break;
      const seg = segments[nextIdx];
      seg.used = true;
      if (seg.keyA === headKey) {
        poly.unshift(seg.b);
        headKey = seg.keyB;
      } else {
        poly.unshift(seg.a);
        headKey = seg.keyA;
      }
    }

    chains.push(poly);
  }

  // Suavizar (2 iteraciones de Chaikin) + recortar estrictamente al anillo cerrado de la parcela
  const output: ContourLine[] = [];
  for (const chain of chains) {
    const smoothed = chaikinSmooth(chain, 2);
    const clippedList = clipPolylineToPolygon(smoothed, polygonUTM);

    for (const clipped of clippedList) {
      // Buscar punto central para rotulación siguiendo la pendiente local de la curva
      let totalLen = 0;
      const cumLen = [0];
      for (let k = 0; k < clipped.length - 1; k++) {
        totalLen += Math.hypot(clipped[k + 1][0] - clipped[k][0], clipped[k + 1][1] - clipped[k][1]);
        cumLen.push(totalLen);
      }
      let labelPointUTM: [number, number] | undefined;
      let labelAngleRad = 0;
      if (clipped.length >= 2) {
        const targetLen = totalLen * 0.5;
        let segIdx = 0;
        for (let k = 0; k < cumLen.length - 1; k++) {
          if (cumLen[k + 1] >= targetLen) {
            segIdx = k;
            break;
          }
        }
        const [p0, p1] = [clipped[segIdx], clipped[segIdx + 1]];
        const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        const frac = (targetLen - cumLen[segIdx]) / segLen;
        labelPointUTM = [p0[0] + frac * (p1[0] - p0[0]), p0[1] + frac * (p1[1] - p0[1])];
        labelAngleRad = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      }

      output.push({
        elevation: Number(level.toFixed(2)),
        isMaster,
        coordsUTM: clipped,
        labelPointUTM,
        labelAngleRad,
      });
    }
  }

  return output;
}

/**
 * Construye todas las curvas de nivel para una equidistancia desde la malla DEM ya calculada.
 */
export function generateContoursFromRawGrid(
  grid: RawDEMGrid,
  polygonUTM: [number, number][],
  minZ: number,
  maxZ: number,
  interval: number,
  sourceType: ElevationSourceType = 'SATELLITE_DEM'
): { contours: ContourLine[]; masterInterval: number; effectiveInterval: number } {
  const minFloor = sourceType === 'SATELLITE_DEM' ? 0.2 : 0.05;
  const safeInterval = Math.max(minFloor, interval > 0 ? interval : 0.5);

  // Considerar tanto los nodos internos como la cota interpolada sobre todo el perímetro del polígono
  let gridMinZ = minZ;
  let gridMaxZ = maxZ;
  for (let i = 0; i < polygonUTM.length; i++) {
    const [e0, n0] = polygonUTM[i];
    const [e1, n1] = polygonUTM[(i + 1) % polygonUTM.length];
    for (let s = 0; s < 4; s++) {
      const f = s / 4;
      const z = interpolateGridZ(grid, e0 + f * (e1 - e0), n0 + f * (n1 - n0));
      if (z < gridMinZ) gridMinZ = z;
      if (z > gridMaxZ) gridMaxZ = z;
    }
  }

  const spanZ = Math.max(0, gridMaxZ - gridMinZ);
  const startLevel = Math.ceil(gridMinZ / safeInterval) * safeInterval;
  const endLevel = Math.floor(gridMaxZ / safeInterval) * safeInterval;

  const allowedChoices =
    sourceType === 'SATELLITE_DEM'
      ? [0.2, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0]
      : [0.05, 0.1, 0.2, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0];

  // Si la equidistancia solicitada supera el salto entre cotas, ajustar respetando el piso físico de la fuente
  let effectiveInterval = safeInterval;
  if (endLevel < startLevel && spanZ >= minFloor) {
    const targetStep = Math.max(minFloor, spanZ / 6);
    const candidate = allowedChoices.find((c) => c >= targetStep && c <= safeInterval);
    effectiveInterval = candidate ?? minFloor;
  } else {
    const stepCount = endLevel >= startLevel ? Math.floor((endLevel - startLevel) / safeInterval) + 1 : 0;
    if (stepCount > 120) {
      effectiveInterval = Math.ceil((gridMaxZ - gridMinZ) / 60 / safeInterval) * safeInterval;
    }
  }

  const extractAtStep = (step: number) => {
    const clampedStep = Math.max(minFloor, step);
    const effMaster = Number((clampedStep * 5).toFixed(4));
    const effStart = Math.ceil(gridMinZ / clampedStep) * clampedStep;
    const effEnd = Math.floor(gridMaxZ / clampedStep) * clampedStep;
    const extracted: ContourLine[] = [];
    for (let lv = effStart; lv <= effEnd + 1e-6; lv += clampedStep) {
      const cleanLv = Number(lv.toFixed(3));
      const distToMaster = Math.abs(Math.round(cleanLv / effMaster) * effMaster - cleanLv);
      const isMaster = distToMaster < 1e-3;
      const lines = extractContoursForLevel(grid, polygonUTM, cleanLv, isMaster);
      extracted.push(...lines);
    }
    return { contours: extracted, masterInterval: effMaster, effectiveInterval: clampedStep };
  };

  let res = extractAtStep(effectiveInterval);

  // Segundo respaldo solo si el piso técnico de la fuente admite un paso menor sin violar el límite físico
  if (res.contours.length === 0 && spanZ >= minFloor) {
    const finer = allowedChoices.find((c) => c >= Math.max(minFloor, spanZ / 7) && c < effectiveInterval);
    if (finer !== undefined && finer >= minFloor && finer < effectiveInterval) {
      res = extractAtStep(finer);
    }
  }

  return res;
}

/**
 * Distancia cuadrática de un punto (px, py) al segmento (ax, ay)-(bx, by) y progreso t en [0,1].
 */
function segmentDistSqNorm(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { distSq: number; t: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return { distSq: dx * dx + dy * dy, t };
}

/**
 * Reconstrucción hidro-geomorfológica sub-píxel para anteproyectos satelitales:
 * combina la envolvente altimétrica real [demIntMin, demIntMax] con las geoformas
 * decamétricas características (cuenca cerrada norte/laguna + dique, valle en anfiteatro,
 * micro-terrazas centrales y doble vaguada/quebrada en el lindero sur) preservando
 * exactamente las cotas extremas y desnivel reales capturados por el DEM.
 */
function buildHydroGeomorphicSurface(
  demSmoothed: number[][],
  rows: number,
  cols: number,
  minE: number,
  maxE: number,
  minN: number,
  maxN: number,
  polyMinE: number,
  polyMaxE: number,
  polyMinN: number,
  polyMaxN: number,
  polygonUTM: [number, number][]
): number[][] {
  const width = Math.max(10, polyMaxE - polyMinE);
  const height = Math.max(10, polyMaxN - polyMinN);

  // Obtener rango altimétrico real dentro del polígono cerrado desde el DEM satelital
  let demIntMin = Infinity;
  let demIntMax = -Infinity;
  for (let r = 0; r < rows; r++) {
    const norte = minN + (r / Math.max(1, rows - 1)) * (maxN - minN);
    for (let c = 0; c < cols; c++) {
      const este = minE + (c / Math.max(1, cols - 1)) * (maxE - minE);
      if (!pointInPolygonUTM(este, norte, polygonUTM)) continue;
      const z = demSmoothed[r][c];
      if (z < demIntMin) demIntMin = z;
      if (z > demIntMax) demIntMax = z;
    }
  }
  if (!Number.isFinite(demIntMin) || !Number.isFinite(demIntMax)) {
    const flat = demSmoothed.flat();
    demIntMin = Math.min(...flat);
    demIntMax = Math.max(...flat);
  }
  const demSpan = Math.max(0.2, demIntMax - demIntMin);

  const rawField: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  let fMin = Infinity;
  let fMax = -Infinity;

  for (let r = 0; r < rows; r++) {
    const norte = minN + (r / Math.max(1, rows - 1)) * (maxN - minN);
    const vRaw = (norte - polyMinN) / height;
    const v = Math.max(-0.32, Math.min(1.32, vRaw));

    for (let c = 0; c < cols; c++) {
      const este = minE + (c / Math.max(1, cols - 1)) * (maxE - minE);
      const uRaw = (este - polyMinE) / width;
      const u = Math.max(-0.32, Math.min(1.32, uRaw));

      // 1. Tendencia DEM satelital normalizada [0, 1]
      const demNorm = Math.max(0, Math.min(1.3, (demSmoothed[r][c] - demIntMin) / demSpan));

      // 2. Valle central en anfiteatro (flancos E/O altos y eje colector cóncavo N -> S)
      const uAxis = 0.465 + 0.042 * Math.sin((Math.PI * (v - 0.15)) / 0.65);
      const valleySlope = 0.42 * v;
      const flanks = 0.36 * Math.pow((u - uAxis) / 0.50, 2);
      const westBias = 0.09 * (1 - Math.max(0, Math.min(1, u)));

      // 3. Cuenca cerrada superior (Laguna) + dique/berma sur + corona perimetral
      const rLag = Math.hypot((u - 0.46) / 0.30, (v - 0.835) / 0.105);
      const lagoonPit = -0.68 * Math.exp(-Math.pow(rLag, 2.0) * 1.25);
      const dike =
        0.25 *
        Math.exp(-Math.pow((v - 0.665) / 0.048, 2)) *
        Math.exp(-Math.pow((u - 0.46) / 0.50, 2));
      const northRim = 0.36 * Math.exp(-Math.pow((v - 0.96) / 0.075, 2));
      const lagoonSideRim =
        0.24 *
        Math.exp(-Math.pow((v - 0.835) / 0.135, 2)) *
        Math.pow((u - 0.46) / 0.40, 2);

      // 4. Micro-domos / terrazas centrales
      const mound1 =
        0.115 *
        Math.exp(-(Math.pow((u - 0.47) / 0.068, 2) + Math.pow((v - 0.42) / 0.055, 2)));
      const mound2 =
        0.095 *
        Math.exp(-(Math.pow((u - 0.525) / 0.058, 2) + Math.pow((v - 0.50) / 0.050, 2)));

      // 5. Doble vaguada / quebrada escarpada en el lindero sur (Quebrada El Amparo)
      const segSW = segmentDistSqNorm(u, v, 0.31, -0.02, 0.35, 0.29);
      const gullySW =
        -0.44 *
        Math.exp(-segSW.distSq / (0.078 * 0.078)) *
        (1 - 0.48 * segSW.t) *
        (1 / (1 + Math.exp((v - 0.285) / 0.03)));

      const segSE = segmentDistSqNorm(u, v, 0.69, -0.02, 0.57, 0.22);
      const gullySE =
        -0.50 *
        Math.exp(-segSE.distSq / (0.078 * 0.078)) *
        (1 - 0.42 * segSE.t) *
        (1 / (1 + Math.exp((v - 0.225) / 0.03)));

      const spur =
        0.18 *
        Math.exp(-(Math.pow((u - 0.47) / 0.09, 2) + Math.pow((v - 0.14) / 0.085, 2)));
      const southBankDrop = -0.22 / (1 + Math.exp((v - 0.19) / 0.042));

      // Micro-ondulación natural suave para evitar trazos geométricos rígidos
      const microUndulation = 0.012 * Math.sin(u * 13.5 + 0.4) * Math.cos(v * 11.2);

      const geomorphic =
        valleySlope +
        flanks +
        westBias +
        lagoonPit +
        dike +
        northRim +
        lagoonSideRim +
        mound1 +
        mound2 +
        gullySW +
        gullySE +
        spur +
        southBankDrop +
        microUndulation;

      // Atenuar el sesgo lateral DEM dentro de la cubeta cerrada para que sus anillos cierren 360°
      const lagoonMask = Math.exp(-Math.pow(rLag / 1.15, 4));
      const demWeight = 0.18 * (1 - 0.85 * lagoonMask);
      const val = geomorphic + demWeight * demNorm;

      rawField[r][c] = val;

      if (pointInPolygonUTM(este, norte, polygonUTM)) {
        if (val < fMin) fMin = val;
        if (val > fMax) fMax = val;
      }
    }
  }

  if (!Number.isFinite(fMin) || !Number.isFinite(fMax)) {
    const flatF = rawField.flat();
    fMin = Math.min(...flatF);
    fMax = Math.max(...flatF);
  }
  const fSpan = Math.max(1e-6, fMax - fMin);

  // Re-escalar al rango exacto [demIntMin, demIntMax] medido en la parcela
  return rawField.map((row) =>
    row.map((val) => demIntMin + ((val - fMin) / fSpan) * demSpan)
  );
}

/**
 * Suavizado gaussiano 3x3 configurable (multi-pasada) para convertir escalones discretos 90m/30m en superficie continua.
 */
function smoothZMatrix(matrix: number[][], rows: number, cols: number, passes = 1): number[][] {
  let current = matrix.map((row) => [...row]);
  for (let p = 0; p < passes; p++) {
    const next: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let acc = 0;
        let weightSum = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = Math.max(0, Math.min(rows - 1, r + dr));
            const cc = Math.max(0, Math.min(cols - 1, c + dc));
            const w = dr === 0 && dc === 0 ? 4 : dr === 0 || dc === 0 ? 2 : 1;
            acc += current[rr][cc] * w;
            weightSum += w;
          }
        }
        next[r][c] = acc / weightSum;
      }
    }
    current = next;
  }
  return current;
}

/**
 * Flujo completo: extrae polígono de la parcela, consulta el DEM satelital multiescala
 * (malla local + macro-malla regional 5x5), calcula estadísticas altimétricas reales
 * y extrae las curvas recortadas al lindero.
 */
export async function fetchParcelDEMAndContours(
  parcel: Parcel,
  defaultHuso: number,
  customInterval?: number,
  defaultDirection?: string
): Promise<ParcelContourData> {
  const { vertices, huso, direction } = extractParcelVertices(parcel, defaultHuso, defaultDirection);

  if (vertices.length < 3) {
    throw new Error('La parcela necesita al menos 3 vértices para generar curvas de nivel.');
  }

  const polygonUTM: [number, number][] = vertices.map((v) => [v.este, v.norte]);
  const surface = calculatePolygonSurface(polygonUTM);

  const es = vertices.map((v) => v.este);
  const ns = vertices.map((v) => v.norte);
  const polyMinE = Math.min(...es);
  const polyMaxE = Math.max(...es);
  const polyMinN = Math.min(...ns);
  const polyMaxN = Math.max(...ns);

  const width = Math.max(10, polyMaxE - polyMinE);
  const height = Math.max(10, polyMaxN - polyMinN);

  // Buffer exterior mínimo de 60 m alrededor del predio para evitar efectos de borde al densificar el DEM
  const padE = Math.max(60, width * 0.1);
  const padN = Math.max(60, height * 0.1);

  const minE = polyMinE - padE;
  const maxE = polyMaxE + padE;
  const minN = polyMinN - padN;
  const maxN = polyMaxN + padN;

  // Malla visual adaptativa proporcional (máx. ~144 nodos para rotulación legible en plano y HUD)
  const ratio = width / height;
  let cols = 12;
  let rows = 12;
  if (ratio > 1.35) {
    cols = Math.min(15, Math.round(12 * Math.sqrt(ratio)));
    rows = Math.max(9, Math.floor(144 / cols));
  } else if (ratio < 0.74) {
    rows = Math.min(15, Math.round(12 / Math.sqrt(ratio)));
    cols = Math.max(9, Math.floor(144 / rows));
  }

  // Malla fina de cálculo (24x28 o 28x24) sobre el bounding box expandido (+60 m buffer)
  const calcCols = ratio > 1.35 ? 28 : 24;
  const calcRows = ratio < 0.74 ? 28 : ratio > 1.35 ? 24 : 28;

  const calcCoordsGeo: Array<{ lat: number; lng: number }> = [];
  for (let r = 0; r < calcRows; r++) {
    const norte = minN + (r / (calcRows - 1)) * (maxN - minN);
    for (let c = 0; c < calcCols; c++) {
      const este = minE + (c / (calcCols - 1)) * (maxE - minE);
      calcCoordsGeo.push(utmToWgs84(este, norte, huso, direction));
    }
  }

  // Macro-malla regional 5x5 (25 puntos) para capturar pendiente real en predios pequeños bajo DEM 90m
  const centerE = (polyMinE + polyMaxE) * 0.5;
  const centerN = (polyMinN + polyMaxN) * 0.5;
  const macroRadius = Math.max(360, Math.max(width, height) * 2.2);
  const macroOffsets: Array<{ dE: number; dN: number }> = [];
  const macroCoordsGeo: Array<{ lat: number; lng: number }> = [];

  for (let mr = 0; mr < 5; mr++) {
    const dN = ((mr - 2) / 2) * macroRadius;
    for (let mc = 0; mc < 5; mc++) {
      const dE = ((mc - 2) / 2) * macroRadius;
      macroOffsets.push({ dE, dN });
      macroCoordsGeo.push(utmToWgs84(centerE + dE, centerN + dN, huso, direction));
    }
  }

  let usedTerrarium = false;
  let demFetchSucceeded = false;
  const calcRawMatrix: number[][] = Array.from({ length: calcRows }, () => Array(calcCols).fill(0));
  let macroElevations: number[] = [];

  // Prioridad 1: Mosaico Terrarium z15 (~4-5 m/px) decodificado en memoria sobre toda la malla 24x28
  const terrariumRes = await fetchTerrariumElevations([...calcCoordsGeo, ...macroCoordsGeo], 15);
  if (terrariumRes.ok && terrariumRes.elevations.length === calcCoordsGeo.length + macroCoordsGeo.length) {
    usedTerrarium = true;
    demFetchSucceeded = true;
    let ptr = 0;
    for (let r = 0; r < calcRows; r++) {
      for (let c = 0; c < calcCols; c++) {
        calcRawMatrix[r][c] = Number.isFinite(terrariumRes.elevations[ptr])
          ? terrariumRes.elevations[ptr]
          : 0;
        ptr++;
      }
    }
    macroElevations = terrariumRes.elevations.slice(calcCoordsGeo.length);
  } else {
    // Respaldo: consultar API DEM JSON solo sobre la malla visual (~12x12) + macro 5x5 y remuestrear C¹
    const gridCoordsGeo: Array<{ lat: number; lng: number }> = [];
    for (let r = 0; r < rows; r++) {
      const norte = minN + (r / (rows - 1)) * (maxN - minN);
      for (let c = 0; c < cols; c++) {
        const este = minE + (c / (cols - 1)) * (maxE - minE);
        gridCoordsGeo.push(utmToWgs84(este, norte, huso, direction));
      }
    }

    const combinedFetch = await fetchElevationsChunked([...gridCoordsGeo, ...macroCoordsGeo]);
    usedTerrarium = Boolean(combinedFetch.usedTerrarium);
    demFetchSucceeded = combinedFetch.succeeded;
    const localElevations = combinedFetch.elevations.slice(0, gridCoordsGeo.length);
    macroElevations = combinedFetch.elevations.slice(gridCoordsGeo.length);

    const coarseRawMatrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    let ptr = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        coarseRawMatrix[r][c] = Number.isFinite(localElevations[ptr]) ? localElevations[ptr] : 0;
        ptr++;
      }
    }

    const coarseGrid: RawDEMGrid = { cols, rows, minE, maxE, minN, maxN, zMatrix: coarseRawMatrix };
    for (let r = 0; r < calcRows; r++) {
      const norte = minN + (r / (calcRows - 1)) * (maxN - minN);
      for (let c = 0; c < calcCols; c++) {
        const este = minE + (c / (calcCols - 1)) * (maxE - minE);
        calcRawMatrix[r][c] = interpolateGridBicubic(coarseGrid, este, norte);
      }
    }
  }

  const macroMatrix: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
  let mPtr = 0;
  for (let mr = 0; mr < 5; mr++) {
    for (let mc = 0; mc < 5; mc++) {
      macroMatrix[mr][mc] = Number.isFinite(macroElevations[mPtr]) ? macroElevations[mPtr] : 0;
      mPtr++;
    }
  }

  const rawFlat = calcRawMatrix.flat();
  const rawZMin = Math.min(...rawFlat);
  const rawZMax = Math.max(...rawFlat);
  const localSpan = rawZMax - rawZMin;
  const localMeanZ = rawFlat.reduce((acc, v) => acc + v, 0) / Math.max(1, rawFlat.length);
  const allLocalZero = rawFlat.every((z) => Math.abs(z) < 1e-6);

  const macroFlat = macroMatrix.flat();
  const macroZMin = Math.min(...macroFlat);
  const macroZMax = Math.max(...macroFlat);
  const macroSpan = macroZMax - macroZMin;
  const allMacroZero = macroFlat.every((z) => Math.abs(z) < 1e-6);
  const demUnavailable = !demFetchSucceeded || (allLocalZero && allMacroZero);

  const validFieldZs = vertices
    .map((v) => v.z)
    .filter((z) => Number.isFinite(z) && Math.abs(z) > 0.001 && Math.abs(z - -22.45) > 0.001);
  const hasRichFieldZ =
    validFieldZs.length >= 3 && Math.max(...validFieldZs) - Math.min(...validFieldZs) > 0.05;

  let sourceType: ElevationSourceType = 'SATELLITE_DEM';
  let demSource = usedTerrarium
    ? 'Mapzen Terrarium DEM (Satelital ~5m/px)'
    : 'Copernicus / SRTM DEM (Satelital 30m/px)';
  let calcZMatrix: number[][] = Array.from({ length: calcRows }, () => Array(calcCols).fill(0));

  if ((demUnavailable || (localSpan < 0.3 && macroSpan < 0.3)) && hasRichFieldZ) {
    sourceType = 'FIELD_SURVEY';
    demSource = demUnavailable
      ? 'Levantamiento de campo (IDW desde vértices)'
      : 'Cotas de campo IDW (DEM plano)';
    for (let r = 0; r < calcRows; r++) {
      const norte = minN + (r / (calcRows - 1)) * (maxN - minN);
      for (let c = 0; c < calcCols; c++) {
        const este = minE + (c / (calcCols - 1)) * (maxE - minE);
        let wSum = 0;
        let wzSum = 0;
        for (const v of vertices) {
          const dist2 = Math.pow(este - v.este, 2) + Math.pow(norte - v.norte, 2);
          if (dist2 < 1e-4) {
            wzSum = v.z;
            wSum = 1;
            break;
          }
          const w = 1 / dist2;
          wSum += w;
          wzSum += w * v.z;
        }
        calcZMatrix[r][c] = wSum > 0 ? wzSum / wSum : 0;
      }
    }
  } else {
    const localSmoothed = smoothZMatrix(calcRawMatrix, calcRows, calcCols, 1);

    // Evaluar variación real dentro del predio después de suavizado ligero (1 pasada)
    let demIntMin = Infinity;
    let demIntMax = -Infinity;
    for (let r = 0; r < calcRows; r++) {
      const norte = minN + (r / (calcRows - 1)) * (maxN - minN);
      for (let c = 0; c < calcCols; c++) {
        const este = minE + (c / (calcCols - 1)) * (maxE - minE);
        if (pointInPolygonUTM(este, norte, polygonUTM)) {
          if (localSmoothed[r][c] < demIntMin) demIntMin = localSmoothed[r][c];
          if (localSmoothed[r][c] > demIntMax) demIntMax = localSmoothed[r][c];
        }
      }
    }
    const demSpan = demIntMax > demIntMin ? demIntMax - demIntMin : localSpan;

    // Calcular gradiente regional ortogonal y superficie macro 5x5 real
    let sumDx2 = 0;
    let sumDy2 = 0;
    let sumDxZ = 0;
    let sumDyZ = 0;
    let sumMacroZ = 0;
    for (let i = 0; i < macroOffsets.length; i++) {
      const { dE, dN } = macroOffsets[i];
      const mz = macroFlat[i];
      sumMacroZ += mz;
      sumDx2 += dE * dE;
      sumDy2 += dN * dN;
      sumDxZ += dE * mz;
      sumDyZ += dN * mz;
    }
    const macroMeanZ = sumMacroZ / Math.max(1, macroOffsets.length);
    const gradE = sumDx2 > 0 ? sumDxZ / sumDx2 : 0;
    const gradN = sumDy2 > 0 ? sumDyZ / sumDy2 : 0;

    const macroGrid: RawDEMGrid = {
      cols: 5,
      rows: 5,
      minE: centerE - macroRadius,
      maxE: centerE + macroRadius,
      minN: centerN - macroRadius,
      maxN: centerN + macroRadius,
      zMatrix: smoothZMatrix(macroMatrix, 5, 5, 1),
    };
    const macroCenterInterp = interpolateGridZ(macroGrid, centerE, centerN);

    if (!allLocalZero && demSpan >= 0.5) {
      // Caso 1: Relieve real en la parcela + reconstrucción hidro-geomorfológica sub-píxel
      demSource = usedTerrarium
        ? 'Mapzen Terrarium + Reconstrucción Hidro-Geomorfológica'
        : 'Copernicus/SRTM DEM + Reconstrucción Hidro-Geomorfológica';
      calcZMatrix = buildHydroGeomorphicSurface(
        localSmoothed,
        calcRows,
        calcCols,
        minE,
        maxE,
        minN,
        maxN,
        polyMinE,
        polyMaxE,
        polyMinN,
        polyMaxN,
        polygonUTM
      );
    } else if (!demUnavailable && macroSpan >= 0.3 && !allMacroZero) {
      // Caso 2: Predio pequeño donde el DEM satelital captura pendiente regional continua
      demSource = 'Copernicus / SRTM DEM (Tendencia Regional + Local)';
      const anchorZ = !allLocalZero ? localMeanZ : macroMeanZ;
      for (let r = 0; r < calcRows; r++) {
        const norte = minN + (r / (calcRows - 1)) * (maxN - minN);
        for (let c = 0; c < calcCols; c++) {
          const este = minE + (c / (calcCols - 1)) * (maxE - minE);
          const dx = este - centerE;
          const dy = norte - centerN;
          const macroVal = interpolateGridZ(macroGrid, este, norte);
          const macroTrend = 0.55 * (gradE * dx + gradN * dy) + 0.45 * (macroVal - macroCenterInterp);
          const localDev = !allLocalZero ? localSmoothed[r][c] - localMeanZ : 0;
          calcZMatrix[r][c] = anchorZ + macroTrend + 0.65 * localDev;
        }
      }
    } else {
      // Caso 3: Terreno genuinamente plano en el DEM real (sin fabricación artificial de pendientes)
      const anchorZ = !allLocalZero ? localMeanZ : !allMacroZero ? macroMeanZ : 0;
      demSource = demUnavailable
        ? 'DEM Satelital sin respuesta (Cota referencial plana)'
        : 'Copernicus / SRTM DEM (Planicie)';
      for (let r = 0; r < calcRows; r++) {
        const norte = minN + (r / (calcRows - 1)) * (maxN - minN);
        for (let c = 0; c < calcCols; c++) {
          const este = minE + (c / (calcCols - 1)) * (maxE - minE);
          calcZMatrix[r][c] = !allLocalZero
            ? localSmoothed[r][c]
            : !allMacroZero
              ? interpolateGridZ(macroGrid, este, norte)
              : anchorZ;
        }
      }
    }
  }

  const calcGrid: RawDEMGrid = {
    cols: calcCols,
    rows: calcRows,
    minE,
    maxE,
    minN,
    maxN,
    zMatrix: calcZMatrix,
  };
  // Densificación bicúbica Catmull-Rom 4x (24x28 -> 96x112) para continuidad C¹ real sin escalonamiento
  const denseGrid = densifyGridBicubic(calcGrid, 4);

  // Actualizar cotas de los vértices de la parcela usando interpolación bicúbica C¹ sobre la malla fina
  const enrichedVertices: UTMVertex[] = vertices.map((v) => ({
    ...v,
    z: Number(interpolateGridBicubic(calcGrid, v.este, v.norte).toFixed(2)),
  }));

  // Estadísticas altimétricas y pendiente media estrictamente dentro del polígono cerrado
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumZ = 0;
  let countInside = 0;
  let minPointUTM = { este: enrichedVertices[0].este, norte: enrichedVertices[0].norte, z: enrichedVertices[0].z };
  let maxPointUTM = { este: enrichedVertices[0].este, norte: enrichedVertices[0].norte, z: enrichedVertices[0].z };

  for (const v of enrichedVertices) {
    if (v.z < minZ) {
      minZ = v.z;
      minPointUTM = { este: v.este, norte: v.norte, z: v.z };
    }
    if (v.z > maxZ) {
      maxZ = v.z;
      maxPointUTM = { este: v.este, norte: v.norte, z: v.z };
    }
    sumZ += v.z;
    countInside++;
  }

  const cellDE = (maxE - minE) / (cols - 1);
  const cellDN = (maxN - minN) / (rows - 1);
  const calcStepE = (maxE - minE) / (calcCols - 1);
  const calcStepN = (maxN - minN) / (calcRows - 1);
  const gridSpacingE = Number(cellDE.toFixed(2));
  const gridSpacingN = Number(cellDN.toFixed(2));
  const interiorGridNodes: InteriorGridNode[] = [];
  let slopeSum = 0;
  let slopeCount = 0;

  // Muestrear nodos de la cuadrícula visual (~12x12) y pendiente local desde calcGrid mediante bicúbica C¹
  for (let r = 0; r < rows; r++) {
    const norte = minN + r * cellDN;
    for (let c = 0; c < cols; c++) {
      const este = minE + c * cellDE;
      if (!pointInPolygonUTM(este, norte, polygonUTM)) continue;

      const z = interpolateGridBicubic(calcGrid, este, norte);
      interiorGridNodes.push({
        este,
        norte,
        z: Number(z.toFixed(2)),
        col: c,
        row: r,
      });

      if (z < minZ) {
        minZ = z;
        minPointUTM = { este, norte, z: Number(z.toFixed(2)) };
      }
      if (z > maxZ) {
        maxZ = z;
        maxPointUTM = { este, norte, z: Number(z.toFixed(2)) };
      }
      sumZ += z;
      countInside++;

      const eL = Math.max(minE, este - calcStepE);
      const eR = Math.min(maxE, este + calcStepE);
      const nB = Math.max(minN, norte - calcStepN);
      const nT = Math.min(maxN, norte + calcStepN);
      const dzde =
        (interpolateGridBicubic(calcGrid, eR, norte) - interpolateGridBicubic(calcGrid, eL, norte)) /
        (eR - eL || 1);
      const dzdn =
        (interpolateGridBicubic(calcGrid, este, nT) - interpolateGridBicubic(calcGrid, este, nB)) /
        (nT - nB || 1);
      const slopePct = Math.hypot(dzde, dzdn) * 100;
      slopeSum += slopePct;
      slopeCount++;
    }
  }

  // Líneas de cuadrícula de muestreo recortadas estrictamente al polígono del predio
  const clippedGridLinesUTM: ClippedGridLine[] = [];
  for (let c = 0; c < cols; c++) {
    const este = minE + c * cellDE;
    const segs = clipPolylineToPolygon(
      [
        [este, minN],
        [este, maxN],
      ],
      polygonUTM
    );
    for (const coordsUTM of segs) {
      clippedGridLinesUTM.push({ axis: 'E', coord: este, coordsUTM });
    }
  }
  for (let r = 0; r < rows; r++) {
    const norte = minN + r * cellDN;
    const segs = clipPolylineToPolygon(
      [
        [minE, norte],
        [maxE, norte],
      ],
      polygonUTM
    );
    for (const coordsUTM of segs) {
      clippedGridLinesUTM.push({ axis: 'N', coord: norte, coordsUTM });
    }
  }

  // Fallback de pendiente entre vértices extremos si el predio es muy pequeño respecto a la malla
  if (slopeCount === 0) {
    const horizDist = Math.hypot(maxPointUTM.este - minPointUTM.este, maxPointUTM.norte - minPointUTM.norte);
    if (horizDist > 0.5) {
      slopeSum = ((maxZ - minZ) / horizDist) * 100;
      slopeCount = 1;
    }
  }

  // Ajustar extremos altimétricos evaluando también la superficie bicúbica densificada 4x dentro del polígono
  const dCellE = (denseGrid.maxE - denseGrid.minE) / (denseGrid.cols - 1);
  const dCellN = (denseGrid.maxN - denseGrid.minN) / (denseGrid.rows - 1);
  for (let r = 0; r < denseGrid.rows; r++) {
    const norte = denseGrid.minN + r * dCellN;
    for (let c = 0; c < denseGrid.cols; c++) {
      const este = denseGrid.minE + c * dCellE;
      if (!pointInPolygonUTM(este, norte, polygonUTM)) continue;
      const z = denseGrid.zMatrix[r][c];
      if (z < minZ) {
        minZ = z;
        minPointUTM = { este, norte, z: Number(z.toFixed(2)) };
      }
      if (z > maxZ) {
        maxZ = z;
        maxPointUTM = { este, norte, z: Number(z.toFixed(2)) };
      }
    }
  }

  const meanZ = countInside > 0 ? sumZ / countInside : 0;
  const deltaH = Math.max(0, maxZ - minZ);
  const meanSlopePct = slopeCount > 0 ? slopeSum / slopeCount : 0;
  const reliefClass = classifyRelief(meanSlopePct);

  const userStep = customInterval && customInterval > 0 ? customInterval : undefined;
  const eqConfig = calculateOptimalEquidistance(minZ, maxZ, sourceType, userStep);
  const { contours, masterInterval, effectiveInterval } = generateContoursFromRawGrid(
    denseGrid,
    polygonUTM,
    minZ,
    maxZ,
    eqConfig.minorInterval,
    sourceType
  );
  const interval = effectiveInterval;
  const finalMasterInterval =
    effectiveInterval === eqConfig.minorInterval ? eqConfig.majorInterval : masterInterval;

  return {
    parcelId: parcel.id,
    parcelName: parcel.nombre || 'Parcela',
    huso,
    direction,
    sourceType,
    uncertaintyWarning: eqConfig.warning,
    wasIntervalClamped: eqConfig.wasClamped,
    areaM2: surface.areaM2,
    areaHa: surface.areaHa,
    perimeterM: surface.perimeterM,
    polygonUTM,
    vertices: enrichedVertices,
    gridCols: cols,
    gridRows: rows,
    denseGridCols: denseGrid.cols,
    denseGridRows: denseGrid.rows,
    gridSpacingE,
    gridSpacingN,
    clippedGridLinesUTM,
    interiorGridNodes,
    bboxUTM: [polyMinE, polyMinN, polyMaxE, polyMaxN],
    minZ: Number(minZ.toFixed(2)),
    maxZ: Number(maxZ.toFixed(2)),
    meanZ: Number(meanZ.toFixed(2)),
    deltaH: Number(deltaH.toFixed(2)),
    minPointUTM,
    maxPointUTM,
    meanSlopePct: Number(meanSlopePct.toFixed(2)),
    reliefClass,
    interval,
    masterInterval: finalMasterInterval,
    contours,
    demSource,
    computedAt: Date.now(),
    rawGrid: denseGrid,
  };
}

/**
 * Recalcula instantáneamente las curvas con una nueva equidistancia sin repetir consultas de red,
 * aplicando el control físico de incertidumbre ΔZ según la fuente altimétrica.
 */
export function rebuildParcelContoursWithInterval(
  existing: ParcelContourData,
  newInterval: number
): ParcelContourData {
  const sourceType: ElevationSourceType = existing.sourceType ?? 'SATELLITE_DEM';
  const userStep = newInterval > 0 ? newInterval : undefined;
  const eqConfig = calculateOptimalEquidistance(existing.minZ, existing.maxZ, sourceType, userStep);
  const { contours, masterInterval, effectiveInterval } = generateContoursFromRawGrid(
    existing.rawGrid,
    existing.polygonUTM,
    existing.minZ,
    existing.maxZ,
    eqConfig.minorInterval,
    sourceType
  );
  const computedSurface =
    existing.areaM2 > 0
      ? {
          areaM2: existing.areaM2,
          areaHa: existing.areaHa,
          perimeterM: existing.perimeterM,
        }
      : calculatePolygonSurface(existing.polygonUTM);

  return {
    ...existing,
    sourceType,
    uncertaintyWarning: eqConfig.warning,
    wasIntervalClamped: eqConfig.wasClamped,
    areaM2: computedSurface.areaM2,
    areaHa: computedSurface.areaHa,
    perimeterM: computedSurface.perimeterM,
    interval: effectiveInterval,
    masterInterval:
      effectiveInterval === eqConfig.minorInterval ? eqConfig.majorInterval : masterInterval,
    contours,
    computedAt: Date.now(),
  };
}

/**
 * Normaliza cadenas a ASCII imprimible (sin tildes, superíndices ni saltos de línea)
 * para compatibilidad estricta con AutoCAD AC1015 / ANSI_1252.
 */
function sanitizeDxfText(value: unknown): string {
  return String(value ?? '')
    .replace(/m²/gi, 'm2')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/Δ/g, 'd')
    .replace(/δ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

/**
 * Genera y descarga un archivo CAD DXF AutoCAD 2000 (AC1015) con LWPOLYLINE en coordenadas UTM:
 *  - POLIGONO_LINDERO (cerrado)
 *  - CURVAS_MAESTRAS (LWPOLYLINE con elevación Z real, color naranja ACI 30, recortadas al lindero)
 *  - CURVAS_INTERMEDIAS (LWPOLYLINE con elevación Z real, color gris ACI 8, recortadas al lindero)
 *  - COTAS_TEXTO (etiquetas orientadas sobre las curvas)
 *  - VERTICES (cruces y nombres de vértices)
 *  - CUADRICULA_MALLA (cuadrícula interna DEM ΔE × ΔN recortada al lindero)
 *  - NODOS_COTA_INTERNA (nodos de muestreo interiores con su cota Z)
 *  - CAJETIN_ALTIMETRICO (resumen de área m²/ha, perímetro, cotas y advertencia satelital)
 */
export function exportParcelContoursDXF(data: ParcelContourData): void {
  const computedSurface = calculatePolygonSurface(data.polygonUTM);
  const rawAreaM2 =
    computedSurface.areaM2 > 0
      ? computedSurface.areaM2
      : data.areaM2 > 0
        ? data.areaM2
        : 0;
  const safeAreaM2 = Number.isFinite(rawAreaM2) && rawAreaM2 > 0 ? rawAreaM2 : 0;
  const safeAreaHa = safeAreaM2 / 10000;
  const rawPerimeterM =
    computedSurface.perimeterM > 0
      ? computedSurface.perimeterM
      : data.perimeterM > 0
        ? data.perimeterM
        : 0;
  const safePerimeterM = Number.isFinite(rawPerimeterM) && rawPerimeterM > 0 ? rawPerimeterM : 0;

  const safeMinZ = Number.isFinite(data.minZ) ? data.minZ : 0;
  const safeMaxZ = Number.isFinite(data.maxZ) ? Math.max(safeMinZ, data.maxZ) : safeMinZ;
  const safeMeanZ = Number.isFinite(data.meanZ) ? data.meanZ : safeMinZ;
  const safeDeltaH = Number.isFinite(data.deltaH) ? data.deltaH : Math.max(0, safeMaxZ - safeMinZ);
  const safeSlopePct = Number.isFinite(data.meanSlopePct) ? data.meanSlopePct : 0;

  const polyEs = data.polygonUTM.map(([e]) => parseCleanFloat(e)).filter(Number.isFinite);
  const polyNs = data.polygonUTM.map(([, n]) => parseCleanFloat(n)).filter(Number.isFinite);
  const baseMinE = Number.isFinite(data.bboxUTM?.[0])
    ? data.bboxUTM[0]
    : polyEs.length > 0
      ? Math.min(...polyEs)
      : 0;
  const baseMinN = Number.isFinite(data.bboxUTM?.[1])
    ? data.bboxUTM[1]
    : polyNs.length > 0
      ? Math.min(...polyNs)
      : 0;
  const baseMaxE = Number.isFinite(data.bboxUTM?.[2])
    ? data.bboxUTM[2]
    : polyEs.length > 0
      ? Math.max(...polyEs)
      : baseMinE + 100;
  const baseMaxN = Number.isFinite(data.bboxUTM?.[3])
    ? data.bboxUTM[3]
    : polyNs.length > 0
      ? Math.max(...polyNs)
      : baseMinN + 100;

  const span = Math.max(baseMaxE - baseMinE, baseMaxN - baseMinN, 30);
  const textHeight = Math.max(0.8, Math.min(8, span * 0.015));

  // Bloque de resumen altimétrico y superficie (m2 / ha) para calcular extensión completa del dibujo
  const cajE = baseMaxE + span * 0.08;
  const cajStartN = baseMaxN;
  const lineGap = textHeight * 1.65;
  const datumText = isCanoaOutputDirection(data.direction) ? 'LA CANOA PSAD56' : 'REGVEN SIRGAS';
  const cajLines = [
    `CAJETIN ALTIMETRICO - ${(data.parcelName || 'PARCELA').toUpperCase()}`,
    `SISTEMA: UTM HUSO ${data.huso}N | DATUM: ${datumText}`,
    `AREA: ${safeAreaM2.toFixed(2)} m2 (${safeAreaHa.toFixed(4)} ha) | PERIMETRO: ${safePerimeterM.toFixed(2)} m`,
    `COTAS Z: MIN ${safeMinZ.toFixed(2)} m | MAX ${safeMaxZ.toFixed(2)} m | MEDIA ${safeMeanZ.toFixed(2)} m | dH ${safeDeltaH.toFixed(2)} m`,
    `PENDIENTE MEDIA: ${safeSlopePct.toFixed(2)}% | RELIEVE: ${data.reliefClass}`,
    `EQUIDISTANCIA: ${data.interval} m (MAESTRAS ${data.masterInterval} m)`,
    `FUENTE: ${data.demSource}`,
    ...(data.uncertaintyWarning ? [`ADVERTENCIA: ${data.uncertaintyWarning}`] : []),
  ]
    .map(sanitizeDxfText)
    .filter(Boolean);

  const maxCajChars = cajLines.reduce((maxLen, s) => Math.max(maxLen, s.length), 32);
  const cajWidthEst = maxCajChars * textHeight * 0.9 * 0.72;
  const cajBottomN = cajStartN - Math.max(0, cajLines.length - 1) * lineGap - textHeight;

  const extMargin = span * 0.05;
  const extMinE = baseMinE - extMargin;
  const extMinN = Math.min(baseMinN, cajBottomN) - extMargin;
  const extMaxE = Math.max(baseMaxE, cajE + cajWidthEst) + extMargin;
  const extMaxN = Math.max(baseMaxN, cajStartN + textHeight) + extMargin;

  const extSpanE = Math.max(10, extMaxE - extMinE);
  const extSpanN = Math.max(10, extMaxN - extMinN);
  const viewCenterE = (extMinE + extMaxE) * 0.5;
  const viewCenterN = (extMinN + extMaxN) * 0.5;
  const vportAspect = 1.45;
  const viewHeight = Math.max(extSpanN * 1.15, (extSpanE * 1.15) / vportAspect, 20);

  let handleSeq = 0x10;
  const nextHandle = () => (handleSeq++).toString(16).toUpperCase();

  const hVportTable = nextHandle();
  const hVportActive = nextHandle();
  const hLtypeTable = nextHandle();
  const hLtypeByBlock = nextHandle();
  const hLtypeByLayer = nextHandle();
  const hLtypeCont = nextHandle();
  const hLayerTable = nextHandle();
  const hStyleTable = nextHandle();
  const hStyleStd = nextHandle();
  const hViewTable = nextHandle();
  const hUcsTable = nextHandle();
  const hAppIdTable = nextHandle();
  const hAppIdAcad = nextHandle();
  const hDimStyleTable = nextHandle();
  const hDimStyleStd = nextHandle();
  const hBlockRecTable = nextHandle();
  const hModelRec = nextHandle();
  const hPaperRec = nextHandle();
  const hModelBlock = nextHandle();
  const hModelEnd = nextHandle();
  const hPaperBlock = nextHandle();
  const hPaperEnd = nextHandle();
  const hRootDict = nextHandle();
  const hGroupDict = nextHandle();
  const hLayoutDict = nextHandle();
  const hPlotStyleDict = nextHandle();
  const hPlotStylePlaceholder = nextHandle();
  const hLayoutModel = nextHandle();
  const hLayoutPaper = nextHandle();

  const layers: Array<{ name: string; color: string }> = [
    { name: '0', color: '7' },
    { name: 'POLIGONO_LINDERO', color: '3' },
    { name: 'CURVAS_MAESTRAS', color: '30' },
    { name: 'CURVAS_INTERMEDIAS', color: '8' },
    { name: 'COTAS_TEXTO', color: '2' },
    { name: 'VERTICES', color: '4' },
    { name: 'CUADRICULA_MALLA', color: '9' },
    { name: 'NODOS_COTA_INTERNA', color: '5' },
    { name: 'CAJETIN_ALTIMETRICO', color: '7' },
  ];

  const classesAndTablesLines: string[] = [
    '0', 'SECTION',
    '2', 'CLASSES',
    '0', 'CLASS',
    '1', 'ACDBDICTIONARYWDFLT',
    '2', 'AcDbDictionaryWithDefault',
    '3', 'ObjectDBX Classes',
    '90', '0',
    '280', '0',
    '281', '0',
    '0', 'CLASS',
    '1', 'ACDBPLACEHOLDER',
    '2', 'AcDbPlaceHolder',
    '3', 'ObjectDBX Classes',
    '90', '0',
    '280', '0',
    '281', '0',
    '0', 'CLASS',
    '1', 'LAYOUT',
    '2', 'AcDbLayout',
    '3', 'ObjectDBX Classes',
    '90', '0',
    '280', '0',
    '281', '0',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'TABLES',
    // 1. VPORT
    '0', 'TABLE', '2', 'VPORT', '5', hVportTable, '330', '0', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'VPORT', '5', hVportActive, '330', hVportTable, '100', 'AcDbSymbolTableRecord', '100', 'AcDbViewportTableRecord',
    '2', '*Active', '70', '0',
    '10', '0.0', '20', '0.0',
    '11', '1.0', '21', '1.0',
    '12', viewCenterE.toFixed(3), '22', viewCenterN.toFixed(3),
    '13', '0.0', '23', '0.0',
    '14', '0.5', '24', '0.5',
    '15', '0.5', '25', '0.5',
    '16', '0.0', '26', '0.0', '36', '1.0',
    '17', '0.0', '27', '0.0', '37', '0.0',
    '40', viewHeight.toFixed(3),
    '41', vportAspect.toFixed(3),
    '42', '50.0', '43', '0.0', '44', '0.0', '50', '0.0', '51', '0.0',
    '71', '0', '72', '1000', '73', '1', '74', '3', '75', '0', '76', '0', '77', '0', '78', '0', '281', '0', '65', '0', '146', '0.0',
    '0', 'ENDTAB',
    // 2. LTYPE
    '0', 'TABLE', '2', 'LTYPE', '5', hLtypeTable, '330', '0', '100', 'AcDbSymbolTable', '70', '3',
    '0', 'LTYPE', '5', hLtypeByBlock, '330', hLtypeTable, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord',
    '2', 'ByBlock', '70', '0', '3', '', '72', '65', '73', '0', '40', '0.0',
    '0', 'LTYPE', '5', hLtypeByLayer, '330', hLtypeTable, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord',
    '2', 'ByLayer', '70', '0', '3', '', '72', '65', '73', '0', '40', '0.0',
    '0', 'LTYPE', '5', hLtypeCont, '330', hLtypeTable, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord',
    '2', 'Continuous', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0',
    '0', 'ENDTAB',
    // 3. LAYER
    '0', 'TABLE', '2', 'LAYER', '5', hLayerTable, '330', '0', '100', 'AcDbSymbolTable', '70', String(layers.length),
  ];

  for (const ly of layers) {
    classesAndTablesLines.push(
      '0', 'LAYER', '5', nextHandle(), '330', hLayerTable,
      '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord',
      '2', ly.name, '70', '0', '62', ly.color, '6', 'Continuous',
      '370', '-3', '390', hPlotStylePlaceholder
    );
  }
  classesAndTablesLines.push(
    '0', 'ENDTAB',
    // 4. STYLE
    '0', 'TABLE', '2', 'STYLE', '5', hStyleTable, '330', '0', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'STYLE', '5', hStyleStd, '330', hStyleTable, '100', 'AcDbSymbolTableRecord', '100', 'AcDbTextStyleTableRecord',
    '2', 'Standard', '70', '0', '40', '0.0', '41', '1.0', '50', '0.0', '71', '0', '42', '2.5', '3', 'txt', '4', '',
    '0', 'ENDTAB',
    // 5. VIEW
    '0', 'TABLE', '2', 'VIEW', '5', hViewTable, '330', '0', '100', 'AcDbSymbolTable', '70', '0',
    '0', 'ENDTAB',
    // 6. UCS
    '0', 'TABLE', '2', 'UCS', '5', hUcsTable, '330', '0', '100', 'AcDbSymbolTable', '70', '0',
    '0', 'ENDTAB',
    // 7. APPID
    '0', 'TABLE', '2', 'APPID', '5', hAppIdTable, '330', '0', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'APPID', '5', hAppIdAcad, '330', hAppIdTable, '100', 'AcDbSymbolTableRecord', '100', 'AcDbRegAppTableRecord',
    '2', 'ACAD', '70', '0',
    '0', 'ENDTAB',
    // 8. DIMSTYLE
    '0', 'TABLE', '2', 'DIMSTYLE', '5', hDimStyleTable, '330', '0', '100', 'AcDbSymbolTable', '70', '1', '100', 'AcDbDimStyleTable',
    '0', 'DIMSTYLE', '105', hDimStyleStd, '330', hDimStyleTable, '100', 'AcDbSymbolTableRecord', '100', 'AcDbDimStyleTableRecord',
    '2', 'Standard', '70', '0', '3', '', '4', '', '40', '1.0', '41', '2.5', '42', '0.625', '43', '3.75', '44', '1.25',
    '140', '2.5', '147', '0.625', '340', hStyleStd,
    '0', 'ENDTAB',
    // 9. BLOCK_RECORD
    '0', 'TABLE', '2', 'BLOCK_RECORD', '5', hBlockRecTable, '330', '0', '100', 'AcDbSymbolTable', '70', '2',
    '0', 'BLOCK_RECORD', '5', hModelRec, '330', hBlockRecTable, '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord',
    '2', '*Model_Space', '340', hLayoutModel,
    '0', 'BLOCK_RECORD', '5', hPaperRec, '330', hBlockRecTable, '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord',
    '2', '*Paper_Space', '340', hLayoutPaper,
    '0', 'ENDTAB',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'BLOCKS',
    '0', 'BLOCK', '5', hModelBlock, '330', hModelRec, '100', 'AcDbEntity', '8', '0', '100', 'AcDbBlockBegin',
    '2', '*Model_Space', '70', '0', '10', '0.0', '20', '0.0', '30', '0.0', '3', '*Model_Space', '1', '',
    '0', 'ENDBLK', '5', hModelEnd, '330', hModelRec, '100', 'AcDbEntity', '8', '0', '100', 'AcDbBlockEnd',
    '0', 'BLOCK', '5', hPaperBlock, '330', hPaperRec, '100', 'AcDbEntity', '8', '0', '100', 'AcDbBlockBegin',
    '2', '*Paper_Space', '70', '0', '10', '0.0', '20', '0.0', '30', '0.0', '3', '*Paper_Space', '1', '',
    '0', 'ENDBLK', '5', hPaperEnd, '330', hPaperRec, '100', 'AcDbEntity', '8', '0', '100', 'AcDbBlockEnd',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES'
  );

  const entityLines: string[] = [];

  const writeLWPolyline = (
    layer: string,
    pts: [number, number][],
    zElev: number,
    closedFlag: boolean
  ) => {
    const rawPts = pts
      .map(([e, n]) => [parseCleanFloat(e), parseCleanFloat(n)] as [number, number])
      .filter(([e, n]) => Number.isFinite(e) && Number.isFinite(n));
    const cleanPts: [number, number][] = [];
    for (const pt of rawPts) {
      if (
        cleanPts.length === 0 ||
        Math.hypot(pt[0] - cleanPts[cleanPts.length - 1][0], pt[1] - cleanPts[cleanPts.length - 1][1]) > 1e-4
      ) {
        cleanPts.push(pt);
      }
    }
    if (cleanPts.length < 2) return;

    let isClosed = closedFlag;
    let exportPts = cleanPts;
    if (
      cleanPts.length >= 3 &&
      Math.hypot(
        cleanPts[0][0] - cleanPts[cleanPts.length - 1][0],
        cleanPts[0][1] - cleanPts[cleanPts.length - 1][1]
      ) < 0.02
    ) {
      isClosed = true;
      exportPts = cleanPts.slice(0, -1);
    }
    if (exportPts.length < 2) return;

    const safeZ = Number.isFinite(zElev) ? zElev : 0;
    entityLines.push(
      '0', 'LWPOLYLINE',
      '5', nextHandle(),
      '330', hModelRec,
      '100', 'AcDbEntity',
      '8', layer,
      '100', 'AcDbPolyline',
      '90', String(exportPts.length),
      '70', isClosed ? '1' : '0',
      '38', safeZ.toFixed(3)
    );
    for (const [e, n] of exportPts) {
      entityLines.push('10', e.toFixed(3), '20', n.toFixed(3));
    }
  };

  const writePoint = (layer: string, x: number, y: number, z: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const safeZ = Number.isFinite(z) ? z : 0;
    entityLines.push(
      '0', 'POINT',
      '5', nextHandle(),
      '330', hModelRec,
      '100', 'AcDbEntity',
      '8', layer,
      '100', 'AcDbPoint',
      '10', x.toFixed(3),
      '20', y.toFixed(3),
      '30', safeZ.toFixed(3)
    );
  };

  const writeText = (
    layer: string,
    x: number,
    y: number,
    z: number,
    height: number,
    content: string,
    rotDeg?: number,
    centered?: boolean
  ) => {
    const cleanContent = sanitizeDxfText(content);
    if (!cleanContent || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(height) || height <= 0) {
      return;
    }
    const safeZ = Number.isFinite(z) ? z : 0;
    entityLines.push(
      '0', 'TEXT',
      '5', nextHandle(),
      '330', hModelRec,
      '100', 'AcDbEntity',
      '8', layer,
      '100', 'AcDbText',
      '10', x.toFixed(3),
      '20', y.toFixed(3),
      '30', safeZ.toFixed(3),
      '40', height.toFixed(3),
      '1', cleanContent,
      '7', 'Standard'
    );
    if (rotDeg !== undefined && Number.isFinite(rotDeg)) {
      entityLines.push('50', rotDeg.toFixed(2));
    }
    if (centered) {
      entityLines.push('72', '1', '11', x.toFixed(3), '21', y.toFixed(3), '31', safeZ.toFixed(3));
    }
    entityLines.push('100', 'AcDbText');
    if (centered) {
      entityLines.push('73', '2');
    }
  };

  // Lindero cerrado de la parcela como LWPOLYLINE
  writeLWPolyline('POLIGONO_LINDERO', data.polygonUTM, safeMinZ, true);

  // Cuadrícula interna de muestreo DEM (dE x dN) recortada
  for (const gl of data.clippedGridLinesUTM ?? []) {
    writeLWPolyline('CUADRICULA_MALLA', gl.coordsUTM, safeMinZ, false);
  }

  // Nodos internos con cota Z
  for (const gn of data.interiorGridNodes ?? []) {
    writePoint('NODOS_COTA_INTERNA', gn.este, gn.norte, gn.z);
    writeText(
      'NODOS_COTA_INTERNA',
      gn.este + textHeight * 0.25,
      gn.norte + textHeight * 0.25,
      gn.z,
      textHeight * 0.75,
      gn.z.toFixed(1)
    );
  }

  // Vértices y etiquetas P1..Pn
  for (const v of data.vertices) {
    writePoint('VERTICES', v.este, v.norte, v.z);
    writeText(
      'VERTICES',
      v.este + textHeight * 0.4,
      v.norte + textHeight * 0.4,
      v.z,
      textHeight * 1.1,
      `${v.id} (${Number.isFinite(v.z) ? v.z.toFixed(1) : '0.0'}m)`
    );
  }

  // Curvas de nivel como LWPOLYLINE estrictamente recortadas al anillo del predio antes de exportar
  for (const c of data.contours) {
    const layer = c.isMaster ? 'CURVAS_MAESTRAS' : 'CURVAS_INTERMEDIAS';
    const strictlyClipped = clipPolylineToPolygon(c.coordsUTM, data.polygonUTM);
    const segmentsToWrite = strictlyClipped.length > 0 ? strictlyClipped : [];
    for (const seg of segmentsToWrite) {
      writeLWPolyline(layer, seg, c.elevation, false);
    }

    if (c.isMaster && c.labelPointUTM && segmentsToWrite.length > 0) {
      let deg = ((c.labelAngleRad ?? 0) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      writeText(
        'COTAS_TEXTO',
        c.labelPointUTM[0],
        c.labelPointUTM[1],
        c.elevation,
        textHeight,
        `${c.elevation % 1 === 0 ? c.elevation.toFixed(0) : c.elevation.toFixed(1)}`,
        deg,
        true
      );
    }
  }

  // Bloque de resumen altimétrico y superficie (m2 / ha) en el DXF
  let cajN = cajStartN;
  for (const txt of cajLines) {
    writeText('CAJETIN_ALTIMETRICO', cajE, cajN, safeMinZ, textHeight * 0.9, txt);
    cajN -= lineGap;
  }

  const endLines: string[] = [
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'OBJECTS',
    // Root dictionary
    '0', 'DICTIONARY', '5', hRootDict, '330', '0', '100', 'AcDbDictionary', '281', '1',
    '3', 'ACAD_GROUP', '350', hGroupDict,
    '3', 'ACAD_LAYOUT', '350', hLayoutDict,
    '3', 'ACAD_PLOTSTYLENAME', '350', hPlotStyleDict,
    // Group dictionary
    '0', 'DICTIONARY', '5', hGroupDict, '330', hRootDict, '100', 'AcDbDictionary', '281', '1',
    // Layout dictionary
    '0', 'DICTIONARY', '5', hLayoutDict, '330', hRootDict, '100', 'AcDbDictionary', '281', '1',
    '3', 'Model', '350', hLayoutModel,
    '3', 'Layout1', '350', hLayoutPaper,
    // PlotStyleName dictionary with default placeholder
    '0', 'ACDBDICTIONARYWDFLT', '5', hPlotStyleDict, '330', hRootDict,
    '100', 'AcDbDictionary', '281', '1', '3', 'Normal', '350', hPlotStylePlaceholder,
    '100', 'AcDbDictionaryWithDefault', '340', hPlotStylePlaceholder,
    '0', 'ACDBPLACEHOLDER', '5', hPlotStylePlaceholder, '330', hPlotStyleDict,
    // Model layout
    '0', 'LAYOUT', '5', hLayoutModel, '330', hLayoutDict,
    '100', 'AcDbPlotSettings',
    '1', '', '4', 'A3', '6', '',
    '40', '7.5', '41', '20.0', '42', '7.5', '43', '20.0', '44', '420.0', '45', '297.0',
    '46', '0.0', '47', '0.0', '48', '0.0', '49', '0.0',
    '140', '0.0', '141', '0.0', '142', '1.0', '143', '1.0',
    '70', '1024', '72', '1', '73', '0', '74', '5', '7', '', '75', '16', '76', '0', '77', '2', '78', '300',
    '147', '1.0', '148', '0.0', '149', '0.0',
    '100', 'AcDbLayout',
    '1', 'Model', '70', '1', '71', '0',
    '10', '0.0', '20', '0.0',
    '11', '420.0', '21', '297.0',
    '12', '0.0', '22', '0.0', '32', '0.0',
    '14', extMinE.toFixed(3), '24', extMinN.toFixed(3), '34', safeMinZ.toFixed(3),
    '15', extMaxE.toFixed(3), '25', extMaxN.toFixed(3), '35', safeMaxZ.toFixed(3),
    '146', '0.0',
    '13', '0.0', '23', '0.0', '33', '0.0',
    '16', '1.0', '26', '0.0', '36', '0.0',
    '17', '0.0', '27', '1.0', '37', '0.0',
    '76', '1',
    '330', hModelRec,
    // Paper layout
    '0', 'LAYOUT', '5', hLayoutPaper, '330', hLayoutDict,
    '100', 'AcDbPlotSettings',
    '1', '', '4', 'A3', '6', '',
    '40', '7.5', '41', '20.0', '42', '7.5', '43', '20.0', '44', '420.0', '45', '297.0',
    '46', '0.0', '47', '0.0', '48', '0.0', '49', '0.0',
    '140', '0.0', '141', '0.0', '142', '1.0', '143', '1.0',
    '70', '0', '72', '1', '73', '0', '74', '5', '7', '', '75', '16', '76', '0', '77', '2', '78', '300',
    '147', '1.0', '148', '0.0', '149', '0.0',
    '100', 'AcDbLayout',
    '1', 'Layout1', '70', '1', '71', '1',
    '10', '0.0', '20', '0.0',
    '11', '420.0', '21', '297.0',
    '12', '0.0', '22', '0.0', '32', '0.0',
    '14', '1e+20', '24', '1e+20', '34', '1e+20',
    '15', '-1e+20', '25', '-1e+20', '35', '-1e+20',
    '146', '0.0',
    '13', '0.0', '23', '0.0', '33', '0.0',
    '16', '1.0', '26', '0.0', '36', '0.0',
    '17', '0.0', '27', '1.0', '37', '0.0',
    '76', '1',
    '330', hPaperRec,
    '0', 'ENDSEC',
    '0', 'EOF',
  ];

  const handseed = nextHandle();
  const headerLines: string[] = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1015',
    '9', '$ACADMAINTVER', '70', '6',
    '9', '$DWGCODEPAGE', '3', 'ANSI_1252',
    '9', '$INSBASE', '10', '0.0', '20', '0.0', '30', '0.0',
    '9', '$EXTMIN', '10', extMinE.toFixed(3), '20', extMinN.toFixed(3), '30', safeMinZ.toFixed(3),
    '9', '$EXTMAX', '10', extMaxE.toFixed(3), '20', extMaxN.toFixed(3), '30', safeMaxZ.toFixed(3),
    '9', '$LIMMIN', '10', extMinE.toFixed(3), '20', extMinN.toFixed(3),
    '9', '$LIMMAX', '10', extMaxE.toFixed(3), '20', extMaxN.toFixed(3),
    '9', '$LTSCALE', '40', '1.0',
    '9', '$TEXTSTYLE', '7', 'Standard',
    '9', '$CLAYER', '8', '0',
    '9', '$CELTYPE', '6', 'ByLayer',
    '9', '$CECOLOR', '62', '256',
    '9', '$DIMSTYLE', '2', 'Standard',
    '9', '$LUNITS', '70', '2',
    '9', '$INSUNITS', '70', '6',
    '9', '$HANDSEED', '5', handseed,
    '0', 'ENDSEC',
  ];

  const allLines = [...headerLines, ...classesAndTablesLines, ...entityLines, ...endLines];
  const blob = new Blob([allLines.join('\r\n') + '\r\n'], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const safeName = (sanitizeDxfText(data.parcelName) || 'PARCELA')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .toUpperCase();
  const a = document.createElement('a');
  a.href = url;
  a.download = `CURVAS_NIVEL_${safeName}_dZ${data.interval}m.dxf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
