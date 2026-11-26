import ExcelJS from 'exceljs';
import { useAppStore } from './store';
import { GeoEngine, GRS80 } from './geo-engine';
import { ElevationService } from './elevation-service';

export interface GeoPoint {
  id: string;
  parcel?: string;
  e: number;
  n: number;
  h: number;
  desc: string;
}

export interface DXFVertex {
  e: number;
  n: number;
  lat?: number;
  lng?: number;
  result?: any;
}

export interface DXFPolygon {
  id: string;
  layer: string;
  vertices: DXFVertex[];
  closed: boolean;
  entityType: string;
  color: string;
  /** Huso UTM detectado del archivo DXF (18-21). Necesario para reproyectar correctamente a EPSG:3857. */
  huso: number;
  /** True si los vértices vienen en grados geográficos (Lon/Lat) en lugar de metros UTM. */
  isGeographic?: boolean;
  /** Código EPSG de las coordenadas transformadas cuando están en dxfPreview. */
  resultEpsg?: string;
}

const LAYER_COLORS = [
  '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#e11d48', '#0ea5e9', '#a855f7', '#d946ef', '#22c55e',
];

export function colorByLayer(layer: string): string {
  let hash = 0;
  for (let i = 0; i < layer.length; i++) {
    hash = layer.charCodeAt(i) + ((hash << 5) - hash);
  }
  return LAYER_COLORS[Math.abs(hash) % LAYER_COLORS.length];
}

export function autoDetectHuso(avgE: number): number {
  // Si las coordenadas corresponden a longitud geográfica (ej. entre -78° y -54°)
  if (avgE < 0 && avgE > -180) {
    if (avgE >= -78 && avgE < -72) return 18;
    if (avgE >= -72 && avgE < -66) return 19;
    if (avgE >= -66 && avgE < -60) return 20;
    if (avgE >= -60 && avgE < -54) return 21;
  }

  // Para coordenadas proyectadas UTM, heredamos por defecto el huso del espacio de trabajo activo
  try {
    const storeHuso = useAppStore.getState().huso;
    if (storeHuso) return storeHuso;
  } catch (err) {
    // Silent fallback
  }

  return 19; // Por defecto Huso 19 en Venezuela
}

// ─── Utilidades de parseo robusto de coordenadas ─────────────────────────────

/**
 * Convierte un texto numérico a número tolerando formatos regionales:
 *  - "411773.26" / "411773,26" (decimal con coma, Excel en español)
 *  - "1.320.182,53" / "1,320,182.53" (separadores de miles)
 * Devuelve NaN si el texto no es estrictamente numérico ("P01", "12abc", "" → NaN).
 */
export function parseCoordNumber(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (raw == null) return NaN;
  let s = String(raw).trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
  if (!s) return NaN;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    // Ambos presentes: el último es el separador decimal, el otro es de miles
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const commas = (s.match(/,/g) || []).length;
    s = commas > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot !== -1) {
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1) s = s.replace(/\./g, '');
  }

  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
  return parseFloat(s);
}

type Delimiter = '\t' | ';' | ',' | 'ws';

/** Detecta el separador de columnas a partir de las primeras líneas. */
function detectDelimiter(lines: string[]): Delimiter {
  const sample = lines.slice(0, 10);
  if (sample.some(l => l.includes('\t'))) return '\t';
  if (sample.some(l => l.includes(';'))) return ';';
  if (sample.some(l => l.includes(','))) {
    // "411773,26 1320182,53" → separado por espacios con decimal de coma
    const looksWsDecimalComma = !sample.some(l => l.includes('"')) && sample.every(l => {
      const tokens = l.trim().split(/\s+/);
      return tokens.length >= 2 && tokens.every(t =>
        (t.match(/,/g) || []).length <= 1 && !t.startsWith(',') && !t.endsWith(',')
      );
    });
    return looksWsDecimalComma ? 'ws' : ',';
  }
  return 'ws';
}

/** Divide una línea respetando campos entre comillas ("1,320,182.53"). Conserva celdas vacías. */
function splitLine(line: string, delim: Delimiter): string[] {
  if (delim === 'ws') return line.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = !inQuotes; }
      continue;
    }
    if (ch === delim && !inQuotes) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

type ColRole = 'id' | 'n' | 'e' | 'h' | 'desc';

/** Clasifica una celda de encabezado por coincidencia de nombre de columna (no por subcadena libre). */
function classifyHeader(raw: string): { role: ColRole | null; geo: boolean } {
  const trimmed = raw.trim();
  if (/^(n\s*[°º]|nro\.?|no\.|#)$/i.test(trimmed)) return { role: 'id', geo: false };
  const c = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  if (!c) return { role: null, geo: false };
  if (/^(lat|phi)/.test(c)) return { role: 'n', geo: true };
  if (/^(lon|lng|lambda)/.test(c)) return { role: 'e', geo: true };
  if (/^(n|y|ny|coordy|coordenaday)$/.test(c) || c.startsWith('norte') || c.startsWith('north')) return { role: 'n', geo: false };
  if (/^(e|x|ex|coordx|coordenadax)$/.test(c) || c.startsWith('este') || c.startsWith('east')) return { role: 'e', geo: false };
  if (/^(z|h|cota|alt|elev|height)/.test(c)) return { role: 'h', geo: false };
  if (/^(desc|obs|codigo|code|nota|detalle)/.test(c)) return { role: 'desc', geo: false };
  if (/^(id|pto|punto|point|pt|nombre|name|vert|estacion|num|numero|nro)/.test(c)) return { role: 'id', geo: false };
  return { role: null, geo: false };
}

const isGeographicPair = (a: number, b: number) =>
  Math.abs(a) <= 180 && Math.abs(b) <= 180 && (Math.abs(a) < 90 || Math.abs(b) < 90);

/** Normaliza un par geográfico a [lat, lng] para Venezuela (lat pequeña positiva, lng negativa). */
function normalizeVenezuelaLatLng(latIn: number, lngIn: number): [number, number] {
  let lat = latIn;
  let lng = lngIn;
  // Columnas intercambiadas (lat ~ -66, lng ~ 10)
  if (Math.abs(lat) >= 50 && Math.abs(lng) <= 15) { const t = lat; lat = lng; lng = t; }
  if (Math.abs(lat) <= 15 && Math.abs(lng) >= 50) { lat = Math.abs(lat); lng = -Math.abs(lng); }
  else if (lng > 0) { lng = -lng; }
  return [lat, lng];
}

export const FileService = {
  /**
   * Parse Text/CSV/TSV content con detección inteligente de columnas,
   * soporte para listas de solo 2 coordenadas (sin ID), y prevención de inversión N/E.
   *
   * Robustez:
   *  - Números regionales (decimal con coma, separadores de miles) y campos entre comillas.
   *  - El encabezado solo se detecta si la 1ª fila NO contiene coordenadas numéricas
   *    (antes "P01, x, y, 10, Lindero Norte" se tomaba como encabezado y se perdía).
   *  - Encabezados Latitud/Longitud se devuelven con la convención e=lat, n=lng.
   *  - Filas sin dos coordenadas numéricas válidas se descartan (antes generaban puntos 0,0).
   */
  parseText(text: string, forceInverted: boolean = false, coordType: 'utm' | 'geo' | 'cart' = 'utm'): GeoPoint[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];

    const delim = detectDelimiter(lines);
    const rows = lines.map(l => splitLine(l, delim));

    // ── Encabezado: 1ª fila con texto y menos de 2 celdas numéricas ──
    const firstRow = rows[0];
    const firstNumericCount = firstRow.filter(c => Number.isFinite(parseCoordNumber(c))).length;
    const hasHeader = firstNumericCount < 2 && firstRow.some(c => /[a-záéíóúñ]/i.test(c));

    let headerIdIdx = -1, headerNorthIdx = -1, headerEastIdx = -1, headerHIdx = -1, headerDescIdx = -1;
    if (hasHeader) {
      firstRow.forEach((col, idx) => {
        const { role } = classifyHeader(col);
        if (role === 'id' && headerIdIdx === -1) headerIdIdx = idx;
        else if (role === 'n' && headerNorthIdx === -1) headerNorthIdx = idx;
        else if (role === 'e' && headerEastIdx === -1) headerEastIdx = idx;
        else if (role === 'h' && headerHIdx === -1) headerHIdx = idx;
        else if (role === 'desc' && headerDescIdx === -1) headerDescIdx = idx;
      });
    }
    const useHeaderMap = hasHeader && headerNorthIdx !== -1 && headerEastIdx !== -1;

    const dataRows = hasHeader ? rows.slice(1) : rows;
    const resultPoints: GeoPoint[] = [];

    for (let idx = 0; idx < dataRows.length; idx++) {
      const cols = dataRows[idx];
      let id = `P${idx + 1}`;
      let h = 0;
      let desc = '';
      let e = 0;
      let n = 0;

      if (useHeaderMap) {
        // ── Columnas identificadas por encabezado ──
        const rawN = parseCoordNumber(cols[headerNorthIdx]);
        const rawE = parseCoordNumber(cols[headerEastIdx]);
        if (!Number.isFinite(rawN) || !Number.isFinite(rawE) || (rawN === 0 && rawE === 0)) continue;
        if (headerIdIdx !== -1 && cols[headerIdIdx]) id = cols[headerIdIdx];
        if (headerHIdx !== -1) h = parseCoordNumber(cols[headerHIdx]) || 0;
        if (headerDescIdx !== -1 && cols[headerDescIdx]) desc = cols[headerDescIdx];

        if (isGeographicPair(rawN, rawE) && (coordType === 'geo' || Math.abs(rawE) > 15 || Math.abs(rawN) > 15)) {
          // Convención del proyecto para geo: e = Latitud, n = Longitud
          [e, n] = normalizeVenezuelaLatLng(rawN, rawE);
        } else {
          e = rawE;
          n = rawN;
        }

        resultPoints.push({ id, parcel: id.length >= 5 ? id.substring(0, 5) : id, e, n, h, desc });
        continue;
      }

      // ── Mapeo posicional ──
      const cells = cols.filter(c => c !== '');
      if (cells.length < 2) continue;
      const nums = cells.map(parseCoordNumber);

      // ¿La 1ª celda es un ID? (texto, o entero pequeño seguido de ≥2 números)
      let start = 0;
      if (!Number.isFinite(nums[0])) {
        id = cells[0];
        start = 1;
      } else if (
        /^\d+$/.test(cells[0].replace(/^["']+|["']+$/g, '')) &&
        Math.abs(nums[0]) < 100000 &&
        Number.isFinite(nums[1]) && Number.isFinite(nums[2])
      ) {
        id = cells[0];
        start = 1;
      }

      const valA = nums[start];
      const valB = nums[start + 1];
      if (!Number.isFinite(valA) || !Number.isFinite(valB) || (valA === 0 && valB === 0)) continue;

      let rest = start + 2;
      if (Number.isFinite(nums[rest])) { h = nums[rest]; rest++; }
      desc = cells.slice(rest).join(' ');

      // Heurística de coordenadas geográficas:
      // NUNCA tratar como geográficas si los valores son de escala métrica (> 1.000m)
      const esMetrico = Math.abs(valA) > 1000 || Math.abs(valB) > 1000;
      const isGeographic = !esMetrico && (coordType === 'geo' || isGeographicPair(valA, valB));

      if (isGeographic) {
        // En Venezuela:
        // Latitud: ~0.5° a 13.0° (magnitud pequeña, positiva)
        // Longitud: ~ -74.0° a -59.0° (magnitud entre 58 y 75, hemisferio W)
        // En BatchImport/GeoEngine para coordType === 'geo':
        // p.e almacena Latitud y p.n almacena Longitud según la convención del proyecto
        [e, n] = normalizeVenezuelaLatLng(valA, valB);
      } else {
        // Coordenadas proyectadas UTM / Cartesiano
        if (forceInverted) {
          // Usuario forzó expresamente Norte primero, Este segundo
          n = valA;
          e = valB;
        } else if (valA > 1000000 && valB < 1000000) {
          // valA es claramente Norte (> 1.000.000m en zona central/norte de Venezuela)
          n = valA;
          e = valB;
        } else if (valB > 1000000 && valA < 1000000) {
          // valB es claramente Norte
          n = valB;
          e = valA;
        } else {
          // En caso general: valA es Este, valB es Norte por defecto
          e = valA;
          n = valB;
        }
      }

      resultPoints.push({
        id,
        parcel: id.length >= 5 ? id.substring(0, 5) : id,
        e,
        n,
        h,
        desc
      });
    }

    return resultPoints;
  },

  /**
   * Parse Excel File
   * Usa los valores numéricos CRUDOS de las celdas (no el texto formateado), evitando que
   * formatos como "1,320,182.53" o decimales con coma rompan las columnas.
   */
  async parseExcel(
    file: File,
    forceInverted: boolean = false,
    coordType: 'utm' | 'geo' | 'cart' = 'utm'
  ): Promise<GeoPoint[]> {
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    const rows: (string | number | null)[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      let rawValues: any[] = [];
      if (Array.isArray(row.values)) {
        rawValues = row.values.slice(1);
      } else if (typeof row.values === 'object' && row.values !== null) {
        rawValues = Object.values(row.values);
      }

      const cleanRow = rawValues.map((val: any) => {
        if (val == null) return '';
        if (typeof val === 'object') {
          if ('result' in val) return val.result ?? '';
          if ('text' in val) return val.text ?? '';
          if (val instanceof Date) return val.toISOString();
        }
        return val;
      });
      rows.push(cleanRow);
    });

    const tsv = rows
      .map(row => row.map(cell => (cell == null ? '' : String(cell).replace(/[\t\r\n]+/g, ' '))).join('\t'))
      .filter(line => line.trim())
      .join('\n');
    return this.parseText(tsv, forceInverted, coordType);
  },

  // --- PROJECT MANAGEMENT ---

  exportProjectJSON(meta: { nombre: string; notas: string }, parcels: any[]) {
    const data = {
      version: '4.0',
      exportDate: new Date().toISOString(),
      meta,
      parcels
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GeoTrans_${meta.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  async importProjectJSON(file: File): Promise<any> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const data = JSON.parse(content);

          // Backwards compatibility for V2.0 .geo files
          if (!data.parcels && data.poligonos) {
            data.parcels = data.poligonos;
          }

          if (!data.meta || !data.parcels) {
            reject(new Error("El archivo JSON no tiene el formato de proyecto válido de GeoGIS6."));
            return;
          }

          // Sanitize duplicate parcel IDs
          const seenIds = new Set<string>();
          data.parcels = data.parcels.map((p: any) => {
            let safeId = p.id;
            while (!safeId || seenIds.has(safeId)) {
              safeId = `POL-${Math.random().toString(36).substring(2, 9)}`;
            }
            seenIds.add(safeId);
            return { ...p, id: safeId };
          });

          resolve(data);
        } catch (err) {
          reject(new Error("Error leyendo el archivo del proyecto: formato JSON inválido."));
        }
      };

      reader.onerror = () => {
        reject(new Error("Error leyendo el archivo."));
      };

      reader.readAsText(file);
    });
  },

  /**
   * Parse DXF (Points, Vertices & LWPOLYLINE)
   */
  async parseDXF(file: File): Promise<GeoPoint[]> {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    const points: GeoPoint[] = [];
    let i = 0;
    let entityType = '';
    let x: number | null = null, y: number | null = null, z: number | null = null, name: string | null = null;
    let pointIdx = 1;

    const flush = () => {
      if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0)) {
        points.push({
          id: name || `P${pointIdx++}`,
          e: x,
          n: y,
          h: z ?? 0,
          desc: entityType
        });
        x = null; y = null; z = null; name = null;
      }
    };

    while (i < lines.length) {
      const code = parseInt(lines[i]?.trim(), 10);
      const val = lines[i + 1]?.trim();

      if (code === 0) {
        flush();
        entityType = val?.toUpperCase() || '';
      } else if ((entityType === 'POINT' || entityType === 'VERTEX' || entityType === 'LWPOLYLINE') && !isNaN(code)) {
        if (code === 10) {
          if (entityType === 'LWPOLYLINE' && x !== null && y !== null) {
            flush();
          }
          x = parseFloat(val);
        } else if (code === 20) y = parseFloat(val);
        else if (code === 30 || code === 38) z = parseFloat(val);
        else if (code === 1 || code === 400) name = val;
      }
      i += 2;
    }
    flush();
    return points;
  },

  /**
   * Parse DXF polygons (LWPOLYLINE con bulge, POLYLINE, LINE encadenadas, ARC, CIRCLE, SPLINE, SOLID, INSERT)
   */
  parseDXFPolygons(dxfText: string): { polygons: DXFPolygon[]; huso: number } {
    const DxfParser = require('dxf-parser').default || require('dxf-parser');
    const parser = new DxfParser();
    const dxf = parser.parseSync(dxfText);
    const entities = dxf?.entities || [];
    const blocks = dxf?.blocks || {};

    type Pt2 = { x: number; y: number };
    interface RawShape {
      verts: Pt2[];
      closed: boolean;
      layer: string;
      entityType: string;
    }
    interface RawLineSeg {
      a: Pt2;
      b: Pt2;
      layer: string;
      used: boolean;
    }
    interface InsertXform {
      ox: number;
      oy: number;
      sx: number;
      sy: number;
      rotRad: number;
    }

    const IDENTITY_XFORM: InsertXform = { ox: 0, oy: 0, sx: 1, sy: 1, rotRad: 0 };

    const applyXform = (pt: Pt2, xf: InsertXform): Pt2 => {
      const lx = pt.x * xf.sx;
      const ly = pt.y * xf.sy;
      if (Math.abs(xf.rotRad) < 1e-9) {
        return { x: xf.ox + lx, y: xf.oy + ly };
      }
      const c = Math.cos(xf.rotRad);
      const s = Math.sin(xf.rotRad);
      return {
        x: xf.ox + lx * c - ly * s,
        y: xf.oy + lx * s + ly * c,
      };
    };

    const tessellateBulge = (p1: Pt2, p2: Pt2, bulge: number): Pt2[] => {
      if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-6) return [];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const chord = Math.hypot(dx, dy);
      if (chord < 1e-6) return [];
      const theta = 4 * Math.atan(bulge);
      const denomSin = Math.sin(Math.abs(theta) / 2);
      if (denomSin < 1e-9) return [];
      const radius = chord / (2 * denomSin);
      const sagittaFactor = (1 - bulge * bulge) / (2 * bulge);
      const mx = (p1.x + p2.x) * 0.5;
      const my = (p1.y + p2.y) * 0.5;
      const nx = -dy / chord;
      const ny = dx / chord;
      const cx = mx + nx * (chord * 0.5 * sagittaFactor);
      const cy = my + ny * (chord * 0.5 * sagittaFactor);
      const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
      const steps = Math.max(2, Math.min(16, Math.ceil((Math.abs(theta) / (2 * Math.PI)) * 36)));
      const extra: Pt2[] = [];
      for (let k = 1; k < steps; k++) {
        const a = startAngle + (theta * k) / steps;
        extra.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
      }
      return extra;
    };

    const rawShapes: RawShape[] = [];
    const rawLines: RawLineSeg[] = [];

    const expandEntity = (entity: any, xf: InsertXform, parentLayer: string | null, depth: number) => {
      if (!entity || !entity.type) return;
      const layer = String(entity.layer && entity.layer !== '0' ? entity.layer : parentLayer || entity.layer || '0');

      switch (entity.type) {
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const rawV: any[] = Array.isArray(entity.vertices) ? entity.vertices : [];
          if (rawV.length < 2) break;
          const isClosed = Boolean(
            entity.shape === true ||
            entity.closed === true ||
            ((Number(entity.flags) || 0) & 1) === 1
          );
          const expanded: Pt2[] = [];
          for (let idx = 0; idx < rawV.length; idx++) {
            const v = rawV[idx];
            if (!Number.isFinite(v?.x) || !Number.isFinite(v?.y)) continue;
            const p1 = applyXform({ x: v.x, y: v.y }, xf);
            expanded.push(p1);
            const bulge = Number(v.bulge ?? 0);
            const hasNext = idx < rawV.length - 1 || isClosed;
            if (hasNext && Math.abs(bulge) > 1e-6) {
              const vNext = rawV[(idx + 1) % rawV.length];
              if (Number.isFinite(vNext?.x) && Number.isFinite(vNext?.y)) {
                const p2 = applyXform({ x: vNext.x, y: vNext.y }, xf);
                expanded.push(...tessellateBulge(p1, p2, bulge));
              }
            }
          }
          if (expanded.length >= 2) {
            rawShapes.push({ verts: expanded, closed: isClosed, layer, entityType: entity.type });
          }
          break;
        }
        case 'LINE': {
          const s = entity.vertices?.[0] ?? entity.start;
          const e = entity.vertices?.[1] ?? entity.end;
          if (!Number.isFinite(s?.x) || !Number.isFinite(s?.y) || !Number.isFinite(e?.x) || !Number.isFinite(e?.y)) {
            break;
          }
          const a = applyXform({ x: s.x, y: s.y }, xf);
          const b = applyXform({ x: e.x, y: e.y }, xf);
          if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-4) {
            rawLines.push({ a, b, layer, used: false });
          }
          break;
        }
        case 'ARC': {
          const cx = entity.center?.x;
          const cy = entity.center?.y;
          const r = entity.radius;
          if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) break;
          const a0 = Number(entity.startAngle ?? 0);
          const a1 = Number(entity.endAngle ?? Math.PI * 2);
          let sweep = a1 - a0;
          if (sweep <= 0) sweep += Math.PI * 2;
          const steps = Math.max(8, Math.min(36, Math.ceil((sweep / (Math.PI * 2)) * 36)));
          const pts: Pt2[] = [];
          for (let k = 0; k <= steps; k++) {
            const ang = a0 + (sweep * k) / steps;
            pts.push(applyXform({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) }, xf));
          }
          rawShapes.push({ verts: pts, closed: false, layer, entityType: 'ARC' });
          break;
        }
        case 'CIRCLE': {
          const cx = entity.center?.x;
          const cy = entity.center?.y;
          const r = entity.radius ?? 1;
          if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) break;
          const pts: Pt2[] = [];
          const segments = 36;
          for (let k = 0; k < segments; k++) {
            const a = (2 * Math.PI * k) / segments;
            pts.push(applyXform({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }, xf));
          }
          rawShapes.push({ verts: pts, closed: true, layer, entityType: 'CIRCLE' });
          break;
        }
        case 'SPLINE': {
          const srcPts: any[] =
            (Array.isArray(entity.fitPoints) && entity.fitPoints.length >= 2)
              ? entity.fitPoints
              : (Array.isArray(entity.controlPoints) ? entity.controlPoints : []);
          const pts: Pt2[] = srcPts
            .filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
            .map((p) => applyXform({ x: p.x, y: p.y }, xf));
          if (pts.length >= 2) {
            const isClosed = Boolean(entity.closed || ((Number(entity.flags) || 0) & 1) === 1);
            rawShapes.push({ verts: pts, closed: isClosed, layer, entityType: 'SPLINE' });
          }
          break;
        }
        case 'SOLID':
        case '3DFACE': {
          const corners: any[] = Array.isArray(entity.points) ? entity.points : [];
          const pts: Pt2[] = [];
          for (const p of corners) {
            if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
            const mappedPt = applyXform({ x: p.x, y: p.y }, xf);
            if (pts.length === 0 || Math.hypot(mappedPt.x - pts[pts.length - 1].x, mappedPt.y - pts[pts.length - 1].y) > 1e-4) {
              pts.push(mappedPt);
            }
          }
          if (pts.length >= 3) {
            rawShapes.push({ verts: pts, closed: true, layer, entityType: entity.type });
          }
          break;
        }
        case 'INSERT': {
          if (depth >= 4 || !entity.name) break;
          const block = blocks[entity.name];
          if (!block || !Array.isArray(block.entities) || block.entities.length === 0) break;
          const pos = entity.position || { x: 0, y: 0 };
          const bx = Number.isFinite(pos.x) ? pos.x : 0;
          const by = Number.isFinite(pos.y) ? pos.y : 0;
          const worldOrigin = applyXform({ x: bx, y: by }, xf);
          const childXf: InsertXform = {
            ox: worldOrigin.x,
            oy: worldOrigin.y,
            sx: xf.sx * (Number.isFinite(entity.xScale) ? entity.xScale : 1),
            sy: xf.sy * (Number.isFinite(entity.yScale) ? entity.yScale : 1),
            rotRad: xf.rotRad + ((Number.isFinite(entity.rotation) ? entity.rotation : 0) * Math.PI) / 180,
          };
          for (const sub of block.entities) {
            expandEntity(sub, childXf, layer, depth + 1);
          }
          break;
        }
      }
    };

    for (const entity of entities) {
      expandEntity(entity, IDENTITY_XFORM, null, 0);
    }

    // Encadenar segmentos LINE conectados de una misma capa en polilíneas/polígonos continuos
    const STITCH_TOL = 0.05;
    const linesByLayer = new Map<string, RawLineSeg[]>();
    for (const seg of rawLines) {
      if (!linesByLayer.has(seg.layer)) linesByLayer.set(seg.layer, []);
      linesByLayer.get(seg.layer)!.push(seg);
    }

    linesByLayer.forEach((segs, layer) => {
      for (let i = 0; i < segs.length; i++) {
        if (segs[i].used) continue;
        segs[i].used = true;
        const chain: Pt2[] = [segs[i].a, segs[i].b];

        let extended = true;
        while (extended) {
          extended = false;
          const tail = chain[chain.length - 1];
          for (let j = 0; j < segs.length; j++) {
            if (segs[j].used) continue;
            if (Math.hypot(segs[j].a.x - tail.x, segs[j].a.y - tail.y) <= STITCH_TOL) {
              segs[j].used = true;
              chain.push(segs[j].b);
              extended = true;
              break;
            }
            if (Math.hypot(segs[j].b.x - tail.x, segs[j].b.y - tail.y) <= STITCH_TOL) {
              segs[j].used = true;
              chain.push(segs[j].a);
              extended = true;
              break;
            }
          }
          if (extended) continue;
          const head = chain[0];
          for (let j = 0; j < segs.length; j++) {
            if (segs[j].used) continue;
            if (Math.hypot(segs[j].b.x - head.x, segs[j].b.y - head.y) <= STITCH_TOL) {
              segs[j].used = true;
              chain.unshift(segs[j].a);
              extended = true;
              break;
            }
            if (Math.hypot(segs[j].a.x - head.x, segs[j].a.y - head.y) <= STITCH_TOL) {
              segs[j].used = true;
              chain.unshift(segs[j].b);
              extended = true;
              break;
            }
          }
        }

        const first = chain[0];
        const last = chain[chain.length - 1];
        const closedChain = chain.length >= 3 && Math.hypot(first.x - last.x, first.y - last.y) <= STITCH_TOL;
        rawShapes.push({
          verts: closedChain ? chain.slice(0, -1) : chain,
          closed: closedChain,
          layer,
          entityType: closedChain ? 'LINE_POLY' : 'LINE',
        });
      }
    });

    // Filtrar geometrías nulas (0,0) o artefactos de espacio papel cuando el plano tiene coordenadas métricas UTM
    const nonDegenerate = rawShapes.filter((s) => {
      if (s.verts.length < 2) return false;
      return s.verts.some((v) => Math.abs(v.x) > 1e-4 || Math.abs(v.y) > 1e-4);
    });

    const hasUtmScale = nonDegenerate.some((s) =>
      s.verts.some((v) => Math.abs(v.x) > 10000 || Math.abs(v.y) > 10000)
    );

    const filteredShapes = hasUtmScale
      ? nonDegenerate.filter((s) => s.verts.some((v) => Math.abs(v.x) >= 500 || Math.abs(v.y) >= 500))
      : nonDegenerate;

    const polygons: DXFPolygon[] = [];

    for (const shape of filteredShapes) {
      const verts = shape.verts;
      let closed = shape.closed;

      const isGeographic =
        verts.every((v) => Math.abs(v.x) <= 180 && Math.abs(v.y) <= 90) &&
        verts.some((v) => Math.abs(v.x) > 1e-6 || Math.abs(v.y) > 1e-6);

      let mapped: DXFVertex[];
      if (isGeographic) {
        const avgX = verts.reduce((s, v) => s + v.x, 0) / verts.length;
        const avgY = verts.reduce((s, v) => s + v.y, 0) / verts.length;
        // En CAD estándar X=Lon (-73..-59 en VE), Y=Lat (0.5..13); detectar si viene invertido
        const swappedGeo = Math.abs(avgX) <= 15 && Math.abs(avgY) >= 50;
        mapped = verts.map((v) => ({
          e: swappedGeo ? v.y : v.x,
          n: swappedGeo ? v.x : v.y,
        }));
      } else {
        const avgX = verts.reduce((s, v) => s + v.x, 0) / verts.length;
        const avgY = verts.reduce((s, v) => s + v.y, 0) / verts.length;
        // En CAD/DXF estándar: X = Este, Y = Norte. Solo invierte si X > 1.000.000 e Y < 1.000.000
        const isCADInvertido = Math.abs(avgX) > 1000000 && Math.abs(avgY) < 1000000;
        mapped = verts.map((v) => ({
          n: isCADInvertido ? v.x : v.y,
          e: isCADInvertido ? v.y : v.x,
        }));
      }

      const EPS = isGeographic ? 1e-6 : 0.01;
      while (mapped.length >= 3) {
        const first = mapped[0];
        const last = mapped[mapped.length - 1];
        if (Math.hypot(first.e - last.e, first.n - last.n) <= EPS) {
          closed = true;
          mapped = mapped.slice(0, -1);
        } else {
          break;
        }
      }

      if (mapped.length < 2) continue;

      const avgEPoly = mapped.reduce((s, v) => s + v.e, 0) / mapped.length;
      const husoPoly = autoDetectHuso(avgEPoly);

      polygons.push({
        id: `DXF-${polygons.length + 1}`,
        layer: shape.layer,
        vertices: mapped,
        closed,
        entityType: shape.entityType,
        color: colorByLayer(shape.layer),
        huso: husoPoly,
        isGeographic,
      });
    }

    let globalAvgHuso = autoDetectHuso(0);
    if (polygons.length > 0) {
      let totalE = 0;
      let count = 0;
      for (const p of polygons) {
        for (const v of p.vertices) {
          totalE += v.e;
          count++;
        }
      }
      globalAvgHuso = autoDetectHuso(count > 0 ? totalE / count : 0);
    }
    return { polygons, huso: globalAvgHuso };
  },

  /**
   * Export to KML
   */
  exportKML(results: any[], projectName: string = 'PARCELA') {
    const coords = results.map(r => `${r.result.lng?.toFixed(8)},${r.result.lat?.toFixed(8)},0`).join(' ');

    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${projectName} — GeoGIS6</name>
    <Placemark>
      <name>${projectName}</name>
      <Polygon>
        <outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

    this._download(kml, `${projectName}.kml`, 'application/vnd.google-earth.kml+xml');
  },

  _download(content: string, fileName: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Export to TXT (Comma Separated: ID,Este,Norte,H/Z)
   * Compatible with GeoGIS6 import format (UTM Coordinates + Satellite Elevation)
   */
  async exportTXT(results: any[], projectName: string = 'PARCELA', fetchSatelliteElevation: boolean = true) {
    let processedResults = results;
    if (fetchSatelliteElevation && results && results.length > 0) {
      try {
        processedResults = await ElevationService.enrichPointsWithSatelliteElevation(results);
      } catch (err) {
        console.warn('[FileService.exportTXT] Error enriqueciendo elevaciones satelitales:', err);
      }
    }

    let txt = ``;
    processedResults.forEach((r, idx) => {
      const id = r.id || r.name || String(idx + 1);
      let este = r.result?.este ?? r.este ?? r.e ?? r.x ?? r.result?.x ?? r.input?.este ?? r.input?.x ?? null;
      let norte = r.result?.norte ?? r.norte ?? r.n ?? r.y ?? r.result?.y ?? r.input?.norte ?? r.input?.y ?? null;
      const h = r.result?.h ?? r.result?.alt ?? r.result?.z ?? r.input?.alt ?? r.input?.z ?? r.h ?? r.alt ?? r.z ?? 0;

      // Si no tiene Este/Norte directo pero tiene lat/lng, convertir de Geográficas a UTM
      if (este == null || norte == null || !Number.isFinite(Number(este)) || !Number.isFinite(Number(norte))) {
        const lat = r.result?.lat ?? r.lat ?? r.latitude ?? r.input?.lat ?? null;
        const lng = r.result?.lng ?? r.lng ?? r.lon ?? r.longitude ?? r.input?.lng ?? null;
        if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
          const huso = r.input?.huso ?? r.huso ?? autoDetectHuso(Number(lng));
          const utm = GeoEngine.geoToUTM(Number(lat), Number(lng), Number(huso), GRS80);
          este = utm.este;
          norte = utm.norte;
        }
      }

      if (este == null || norte == null || !Number.isFinite(Number(este)) || !Number.isFinite(Number(norte))) return;

      txt += `${id},${Number(este).toFixed(3)},${Number(norte).toFixed(3)},${Number(h).toFixed(3)}\n`;
    });
    this._download(txt, `${projectName}.txt`, 'text/plain');
  },

  /**
   * Export to TXT in WGS84 Geographic Coordinates with Satellite Elevation
   * Format: punto,Latitud,Longitud,Altitud
   */
  async exportTXT_WGS84(results: any[], projectName: string = 'PARCELA', fetchSatelliteElevation: boolean = true) {
    let processedResults = results;
    if (fetchSatelliteElevation && results && results.length > 0) {
      try {
        processedResults = await ElevationService.enrichPointsWithSatelliteElevation(results);
      } catch (err) {
        console.warn('[FileService.exportTXT_WGS84] Error enriqueciendo elevaciones satelitales:', err);
      }
    }

    let txt = ``;
    processedResults.forEach((r, idx) => {
      const id = r.id || r.name || String(idx + 1);
      let lat = r.result?.lat ?? r.lat ?? r.latitude ?? r.input?.lat ?? null;
      let lng = r.result?.lng ?? r.lng ?? r.lon ?? r.longitude ?? r.input?.lng ?? null;
      const h = r.result?.h ?? r.result?.alt ?? r.result?.z ?? r.input?.alt ?? r.input?.z ?? r.h ?? r.alt ?? r.z ?? 0;

      // Si no tiene lat/lng directo, derivar de coordenadas UTM usando GeoEngine (GRS80/WGS84)
      if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        const este = r.result?.este ?? r.este ?? r.e ?? r.x ?? r.result?.x ?? r.input?.este ?? r.input?.x ?? null;
        const norte = r.result?.norte ?? r.norte ?? r.n ?? r.y ?? r.result?.y ?? r.input?.norte ?? r.input?.y ?? null;
        if (este != null && norte != null && Number.isFinite(Number(este)) && Number.isFinite(Number(norte))) {
          const huso = r.input?.huso ?? r.huso ?? autoDetectHuso(Number(este));
          const geo = GeoEngine.utmToGeo(Number(este), Number(norte), Number(huso), false, GRS80);
          lat = geo.lat;
          lng = geo.lng;
        }
      }

      if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;

      txt += `${id},${Number(lat).toFixed(8)},${Number(lng).toFixed(8)},${Number(h).toFixed(3)}\n`;
    });
    this._download(txt, `${projectName}_WGS84.txt`, 'text/plain');
  },

  /**
   * Export to CSV (Comma Separated) with full coordinate info and satellite elevation
   */
  async exportCSV(results: any[], projectName: string = 'PARCELA', fetchSatelliteElevation: boolean = true) {
    let processedResults = results;
    if (fetchSatelliteElevation && results && results.length > 0) {
      try {
        processedResults = await ElevationService.enrichPointsWithSatelliteElevation(results);
      } catch (err) {
        console.warn('[FileService.exportCSV] Error enriqueciendo elevaciones satelitales:', err);
      }
    }

    let csv = "Punto,Este(X),Norte(Y),Alt(H),Latitud,Longitud,Dist_Lineal\n";
    processedResults.forEach((r, idx) => {
      const id = r.id || r.name || String(idx + 1);
      let este = r.result?.este ?? r.este ?? r.e ?? r.x ?? r.result?.x ?? r.input?.este ?? r.input?.x ?? null;
      let norte = r.result?.norte ?? r.norte ?? r.n ?? r.y ?? r.result?.y ?? r.input?.norte ?? r.input?.y ?? null;
      let lat = r.result?.lat ?? r.lat ?? r.latitude ?? r.input?.lat ?? null;
      let lng = r.result?.lng ?? r.lng ?? r.lon ?? r.longitude ?? r.input?.lng ?? null;
      const h = r.result?.h ?? r.result?.alt ?? r.result?.z ?? r.input?.alt ?? r.input?.z ?? r.h ?? r.alt ?? r.z ?? 0;
      const dLineal = r.result?.dLineal ?? r.dLineal ?? 0;

      // Calcular UTM si falta
      if ((este == null || norte == null) && lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        const huso = r.input?.huso ?? r.huso ?? autoDetectHuso(Number(lng));
        const utm = GeoEngine.geoToUTM(Number(lat), Number(lng), Number(huso), GRS80);
        este = utm.este;
        norte = utm.norte;
      }
      // Calcular Geo si falta
      if ((lat == null || lng == null) && este != null && norte != null && Number.isFinite(Number(este)) && Number.isFinite(Number(norte))) {
        const huso = r.input?.huso ?? r.huso ?? autoDetectHuso(Number(este));
        const geo = GeoEngine.utmToGeo(Number(este), Number(norte), Number(huso), false, GRS80);
        lat = geo.lat;
        lng = geo.lng;
      }

      if (este == null || norte == null || !Number.isFinite(Number(este)) || !Number.isFinite(Number(norte))) return;

      const latStr = Number.isFinite(Number(lat)) ? Number(lat).toFixed(8) : '';
      const lngStr = Number.isFinite(Number(lng)) ? Number(lng).toFixed(8) : '';
      csv += `${id},${Number(este).toFixed(3)},${Number(norte).toFixed(3)},${Number(h).toFixed(3)},${latStr},${lngStr},${Number(dLineal).toFixed(4)}\n`;
    });
    this._download(csv, `${projectName}.csv`, 'text/csv');
  },

  /**
   * Area/Perimeter Calculation (Shoelace Algorithm)
   */
  calculateGeometry(pts: { e: number, n: number }[]) {
    if (pts.length < 3) return { area: 0, perim: 0 };

    let area = 0;
    let perim = 0;
    const n = pts.length;

    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      area += (p1.e * p2.n) - (p2.e * p1.n);
      const dx = p2.e - p1.e;
      const dy = p2.n - p1.n;
      perim += Math.sqrt(dx * dx + dy * dy);
    }

    return { area: Math.abs(area) / 2, perim };
  }
};
