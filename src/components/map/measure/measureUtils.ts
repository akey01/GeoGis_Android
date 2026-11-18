/**
 * measureUtils.ts — Cálculo puro de mediciones (sin OpenLayers ni React).
 *
 * Las coordenadas de entrada están en EPSG:3857 (la proyección de la vista), pero
 * NUNCA se mide sobre ellas: Web Mercator distorsiona ~1.5 % las distancias y ~3 % las
 * áreas a las latitudes de Venezuela. En su lugar:
 *   - Si todos los vértices caen en el mismo huso UTM → cálculo planar en UTM (WGS84/REGVEN),
 *     coherente con el resto del sistema.
 *   - Si la geometría cruza husos → respaldo geodésico esférico (haversine / exceso esférico).
 */

import proj4 from 'proj4';

export type Coord = [number, number];
export type MeasureKind = 'distance' | 'area' | 'circle' | 'bearing' | 'point';
export type DistanceUnit = 'auto' | 'm' | 'km' | 'ft' | 'mi';
export type AreaUnit = 'auto' | 'm2' | 'ha' | 'km2' | 'ac';

export interface MeasureUnits {
  distance: DistanceUnit;
  area: AreaUnit;
}

export interface MeasureReading {
  kind: MeasureKind;
  /** Método de cálculo empleado. */
  method: 'utm' | 'geodesic';
  /** Huso UTM usado (solo si method === 'utm'). */
  zone?: number;
  vertices: number;
  /** Longitud total (distancia) o distancia entre extremos (rumbo). */
  lengthM?: number;
  areaM2?: number;
  perimeterM?: number;
  radiusM?: number;
  /** Azimut de cuadrícula 0-360° desde el Norte, sentido horario. */
  azimuthDeg?: number;
  lon?: number;
  lat?: number;
  easting?: number;
  northing?: number;
}

export interface ReadingRow {
  label: string;
  value: string;
}

// ── Constantes ───────────────────────────────────────────────────────────────
const R_MERCATOR = 6378137;
const R_MEAN = 6371008.8;
const DEG = Math.PI / 180;
const FT = 0.3048;
const MI = 1609.344;
const ACRE = 4046.8564224;

// ── Web Mercator ⇄ lon/lat ───────────────────────────────────────────────────
export function mercatorToLonLat(c: Coord): Coord {
  const lon = (c[0] / R_MERCATOR) / DEG;
  const lat = (2 * Math.atan(Math.exp(c[1] / R_MERCATOR)) - Math.PI / 2) / DEG;
  return [lon, lat];
}

export function lonLatToMercator(c: Coord): Coord {
  const x = c[0] * DEG * R_MERCATOR;
  const y = Math.log(Math.tan(Math.PI / 4 + (c[1] * DEG) / 2)) * R_MERCATOR;
  return [x, y];
}

// ── UTM ──────────────────────────────────────────────────────────────────────
interface UtmConverter {
  forward(c: number[]): number[];
  inverse(c: number[]): number[];
}

const converterCache = new Map<string, UtmConverter>();

function getConverter(zone: number, south: boolean): UtmConverter {
  const key = `${zone}${south ? 'S' : 'N'}`;
  let conv = converterCache.get(key);
  if (!conv) {
    conv = proj4(
      `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`
    ) as unknown as UtmConverter;
    converterCache.set(key, conv);
  }
  return conv;
}

export function utmZoneForLon(lon: number): number {
  return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
}

type Projected =
  | { method: 'utm'; zone: number; pts: Coord[] }
  | { method: 'geodesic'; ll: Coord[] };

function projectPath(coords3857: Coord[]): Projected {
  const ll = coords3857.map(mercatorToLonLat);
  if (ll.length === 0) return { method: 'geodesic', ll };
  const zone0 = utmZoneForLon(ll[0][0]);
  const south0 = ll[0][1] < 0;
  const sameZone = ll.every((p) => utmZoneForLon(p[0]) === zone0 && (p[1] < 0) === south0);
  if (!sameZone) return { method: 'geodesic', ll };
  const conv = getConverter(zone0, south0);
  return { method: 'utm', zone: zone0, pts: ll.map((p) => conv.forward(p) as Coord) };
}

// ── Geodésica esférica (respaldo) ────────────────────────────────────────────
function haversine(a: Coord, b: Coord): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MEAN * Math.asin(Math.min(1, Math.sqrt(s)));
}

function geodesicBearing(a: Coord, b: Coord): number {
  const φ1 = a[1] * DEG;
  const φ2 = b[1] * DEG;
  const Δλ = (b[0] - a[0]) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(Math.atan2(y, x) / DEG);
}

function sphericalRingArea(ll: Coord[]): number {
  let sum = 0;
  for (let i = 0; i < ll.length; i++) {
    const p1 = ll[i];
    const p2 = ll[(i + 1) % ll.length];
    sum += (p2[0] - p1[0]) * DEG * (2 + Math.sin(p1[1] * DEG) + Math.sin(p2[1] * DEG));
  }
  return Math.abs((sum * R_MEAN * R_MEAN) / 2);
}

function normalizeDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

// ── Primitivas de medida ─────────────────────────────────────────────────────
function pathLength(p: Projected, closed: boolean): number {
  const n = p.method === 'utm' ? p.pts.length : p.ll.length;
  let total = 0;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    if (p.method === 'utm') {
      total += Math.hypot(p.pts[j][0] - p.pts[i][0], p.pts[j][1] - p.pts[i][1]);
    } else {
      total += haversine(p.ll[i], p.ll[j]);
    }
  }
  return total;
}

function ringArea(p: Projected): number {
  if (p.method === 'geodesic') return p.ll.length < 3 ? 0 : sphericalRingArea(p.ll);
  const pts = p.pts;
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

function dropClosing(coords: Coord[]): Coord[] {
  if (coords.length > 1) {
    const a = coords[0];
    const b = coords[coords.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return coords.slice(0, -1);
  }
  return coords;
}

/**
 * Calcula la lectura de una medición.
 * @param coords3857 Vértices en EPSG:3857. Para 'circle': [centro, punto del borde].
 */
export function computeReading(kind: MeasureKind, coords3857: Coord[]): MeasureReading {
  const method = (p: Projected) => ({
    method: p.method,
    zone: p.method === 'utm' ? p.zone : undefined,
  });

  switch (kind) {
    case 'distance': {
      const p = projectPath(coords3857);
      return { kind, ...method(p), vertices: coords3857.length, lengthM: pathLength(p, false) };
    }
    case 'area': {
      const ring = dropClosing(coords3857);
      const p = projectPath(ring);
      return {
        kind,
        ...method(p),
        vertices: ring.length,
        areaM2: ringArea(p),
        perimeterM: ring.length >= 2 ? pathLength(p, true) : 0,
      };
    }
    case 'circle': {
      const p = projectPath(coords3857.slice(0, 2));
      const r = pathLength(p, false);
      return {
        kind,
        ...method(p),
        vertices: 2,
        radiusM: r,
        areaM2: Math.PI * r * r,
        perimeterM: 2 * Math.PI * r,
      };
    }
    case 'bearing': {
      const p = projectPath(coords3857.slice(0, 2));
      const len = pathLength(p, false);
      let az: number | undefined;
      if (len > 0) {
        az =
          p.method === 'utm'
            ? normalizeDeg(Math.atan2(p.pts[1][0] - p.pts[0][0], p.pts[1][1] - p.pts[0][1]) / DEG)
            : geodesicBearing(p.ll[0], p.ll[1]);
      }
      return { kind, ...method(p), vertices: 2, lengthM: len, azimuthDeg: az };
    }
    case 'point':
    default: {
      const c = coords3857[0];
      const p = projectPath([c]);
      const ll = mercatorToLonLat(c);
      return {
        kind: 'point',
        ...method(p),
        vertices: 1,
        lon: ll[0],
        lat: ll[1],
        easting: p.method === 'utm' ? p.pts[0][0] : undefined,
        northing: p.method === 'utm' ? p.pts[0][1] : undefined,
      };
    }
  }
}

/**
 * Anillo (EPSG:3857) de un círculo cuyo radio es una distancia real sobre el terreno
 * (UTM), no una distancia en unidades de Web Mercator.
 */
export function buildGroundCircle(center3857: Coord, edge3857: Coord, segments = 72): Coord[] {
  const cLL = mercatorToLonLat(center3857);
  const zone = utmZoneForLon(cLL[0]);
  const south = cLL[1] < 0;
  const conv = getConverter(zone, south);
  const c = conv.forward(cLL);
  const e = conv.forward(mercatorToLonLat(edge3857));
  const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
  const ring: Coord[] = [];
  for (let i = 0; i <= segments; i++) {
    const ang = (2 * Math.PI * i) / segments;
    const ll = conv.inverse([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
    ring.push(lonLatToMercator([ll[0], ll[1]]));
  }
  ring[ring.length - 1] = ring[0];
  return ring;
}

// ── Formato ──────────────────────────────────────────────────────────────────
export function formatDistance(meters: number, unit: DistanceUnit = 'auto'): string {
  if (!Number.isFinite(meters)) return '—';
  const u = unit === 'auto' ? (meters >= 1000 ? 'km' : 'm') : unit;
  switch (u) {
    case 'km':
      return `${(meters / 1000).toFixed(3)} km`;
    case 'ft':
      return `${(meters / FT).toFixed(2)} ft`;
    case 'mi':
      return `${(meters / MI).toFixed(4)} mi`;
    default:
      return `${meters.toFixed(2)} m`;
  }
}

export function formatArea(m2: number, unit: AreaUnit = 'auto'): string {
  if (!Number.isFinite(m2)) return '—';
  const u = unit === 'auto' ? (m2 >= 1e6 ? 'km2' : m2 >= 1e4 ? 'ha' : 'm2') : unit;
  switch (u) {
    case 'ha':
      return `${(m2 / 1e4).toFixed(4)} ha`;
    case 'km2':
      return `${(m2 / 1e6).toFixed(4)} km²`;
    case 'ac':
      return `${(m2 / ACRE).toFixed(4)} ac`;
    default:
      return `${m2.toFixed(2)} m²`;
  }
}

/** Grados, minutos y segundos: 45°30'12" */
export function formatAzimuth(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  const total = Math.round(normalizeDeg(deg) * 3600) % 1296000;
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`;
}

/** Rumbo cuadrantal: N 45°30'12" E */
export function formatQuadrantBearing(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  const az = normalizeDeg(deg);
  if (az === 0) return 'N';
  if (az === 90) return 'E';
  if (az === 180) return 'S';
  if (az === 270) return 'O';
  if (az < 90) return `N ${formatAzimuth(az)} E`;
  if (az < 180) return `S ${formatAzimuth(180 - az)} E`;
  if (az < 270) return `S ${formatAzimuth(az - 180)} O`;
  return `N ${formatAzimuth(360 - az)} O`;
}

function methodLabel(r: MeasureReading): string {
  return r.method === 'utm' ? `UTM REGVEN ${r.zone}N` : 'Geodésico (cruza husos)';
}

/** Filas para el panel de lectura. */
export function describeReading(r: MeasureReading, u: MeasureUnits): ReadingRow[] {
  const rows: ReadingRow[] = [];
  switch (r.kind) {
    case 'distance':
      rows.push({ label: 'Distancia', value: formatDistance(r.lengthM ?? NaN, u.distance) });
      break;
    case 'area':
      rows.push({ label: 'Área', value: formatArea(r.areaM2 ?? NaN, u.area) });
      rows.push({ label: 'Perímetro', value: formatDistance(r.perimeterM ?? NaN, u.distance) });
      break;
    case 'circle':
      rows.push({ label: 'Radio', value: formatDistance(r.radiusM ?? NaN, u.distance) });
      rows.push({ label: 'Circunf.', value: formatDistance(r.perimeterM ?? NaN, u.distance) });
      rows.push({ label: 'Área', value: formatArea(r.areaM2 ?? NaN, u.area) });
      break;
    case 'bearing':
      rows.push({ label: 'Azimut', value: r.azimuthDeg === undefined ? '—' : formatAzimuth(r.azimuthDeg) });
      rows.push({ label: 'Rumbo', value: r.azimuthDeg === undefined ? '—' : formatQuadrantBearing(r.azimuthDeg) });
      rows.push({ label: 'Distancia', value: formatDistance(r.lengthM ?? NaN, u.distance) });
      break;
    case 'point':
      if (r.easting !== undefined && r.northing !== undefined) {
        rows.push({ label: 'Este', value: `${r.easting.toFixed(2)} m` });
        rows.push({ label: 'Norte', value: `${r.northing.toFixed(2)} m` });
      }
      rows.push({ label: 'Lat', value: `${(r.lat ?? NaN).toFixed(6)}°` });
      rows.push({ label: 'Lon', value: `${(r.lon ?? NaN).toFixed(6)}°` });
      break;
  }
  rows.push({ label: 'Sistema', value: methodLabel(r) });
  return rows;
}

/** Texto corto para la etiqueta sobre el mapa. */
export function mapLabel(r: MeasureReading, u: MeasureUnits): string {
  switch (r.kind) {
    case 'distance':
      return formatDistance(r.lengthM ?? NaN, u.distance);
    case 'area':
      return `${formatArea(r.areaM2 ?? NaN, u.area)}\nP: ${formatDistance(r.perimeterM ?? NaN, u.distance)}`;
    case 'circle':
      return `r = ${formatDistance(r.radiusM ?? NaN, u.distance)}\n${formatArea(r.areaM2 ?? NaN, u.area)}`;
    case 'bearing':
      return `${r.azimuthDeg === undefined ? '—' : formatQuadrantBearing(r.azimuthDeg)}\n${formatDistance(r.lengthM ?? NaN, u.distance)}`;
    case 'point':
    default:
      return r.easting !== undefined && r.northing !== undefined
        ? `E ${r.easting.toFixed(1)}\nN ${r.northing.toFixed(1)}`
        : `${(r.lat ?? NaN).toFixed(5)}, ${(r.lon ?? NaN).toFixed(5)}`;
  }
}
