import { FileService, type DXFPolygon, type GeoPoint } from './file-service';

const DWG_VERSION_LABELS: Record<string, string> = {
  AC1032: 'AutoCAD 2018–2024',
  AC1027: 'AutoCAD 2013–2017',
  AC1024: 'AutoCAD 2010–2012',
  AC1021: 'AutoCAD 2007–2009',
  AC1018: 'AutoCAD 2004–2006',
  AC1015: 'AutoCAD 2000–2002',
  AC1014: 'AutoCAD R14',
  AC1012: 'AutoCAD R13',
  AC1009: 'AutoCAD R11/R12',
};

function readHeaderAscii(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
  let out = '';
  for (let i = 0; i < 6 && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

export function isDwgBinaryBuffer(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength < 6) return false;
  return /^AC10\d\d$/.test(readHeaderAscii(buffer));
}

export function detectDwgVersionLabel(buffer: ArrayBuffer): string | null {
  if (!isDwgBinaryBuffer(buffer)) return null;
  const sig = readHeaderAscii(buffer);
  return DWG_VERSION_LABELS[sig] || `DWG (${sig})`;
}

let libreDwgPromise: Promise<any> | null = null;

async function getLibreDwg(): Promise<{ libredwg: any; dwgFileType: any }> {
  if (typeof window === 'undefined') {
    throw new Error('La decodificación DWG se ejecuta únicamente en el navegador.');
  }

  if (!libreDwgPromise) {
    libreDwgPromise = (async () => {
      const loadBrowserEsm = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
      const moduleUrl = `${window.location.origin}/wasm/dist/libredwg-web.js`;
      const mod: any = await loadBrowserEsm(moduleUrl);
      const LibreDwgClass = mod?.LibreDwg || mod?.default?.LibreDwg;
      const dwgFileType = mod?.Dwg_File_Type || mod?.default?.Dwg_File_Type;

      if (!LibreDwgClass || typeof LibreDwgClass.create !== 'function') {
        throw new Error('Módulo @mlightcad/libredwg-web no disponible.');
      }

      let instance: any = null;
      const attempts: Array<() => Promise<any>> = [
        () => LibreDwgClass.create('/wasm/wasm/'),
        () => LibreDwgClass.create('/wasm/'),
        () => LibreDwgClass.create('/wasm/wasm/libredwg-web.wasm'),
        () => LibreDwgClass.create(),
      ];

      let lastErr: any = null;
      for (const tryCreate of attempts) {
        try {
          instance = await tryCreate();
          if (instance) break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!instance) {
        throw new Error(
          lastErr?.message || 'No se pudo inicializar el motor WebAssembly de LibreDWG.'
        );
      }

      return { libredwg: instance, dwgFileType };
    })().catch((err) => {
      libreDwgPromise = null;
      throw err;
    });
  }

  return libreDwgPromise;
}

function toPt(raw: any): { x: number; y: number; z?: number } | null {
  if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  const pt: { x: number; y: number; z?: number } = { x: Number(raw.x), y: Number(raw.y) };
  if (Number.isFinite(raw.z)) pt.z = Number(raw.z);
  return pt;
}

function toRad(angle: any): number | undefined {
  const n = Number(angle);
  if (!Number.isFinite(n)) return undefined;
  return Math.abs(n) > Math.PI * 2 + 0.01 ? (n * Math.PI) / 180 : n;
}

function normalizeDwgEntity(raw: any): any | null {
  if (!raw || !raw.type) return null;
  if (raw.isInPaperSpace === true || raw.space === 1) return null;

  let type = String(raw.type).trim().toUpperCase();
  if (type === 'POLYLINE2D' || type === 'POLYLINE3D' || type === 'POLYLINE_2D' || type === 'POLYLINE_3D') {
    type = 'POLYLINE';
  }

  const layer = String(raw.layer ?? raw.layerName ?? '0');

  switch (type) {
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const srcVerts: any[] = Array.isArray(raw.vertices)
        ? raw.vertices
        : Array.isArray(raw.points)
          ? raw.points
          : [];
      const vertices = srcVerts
        .map((v) => {
          if (!Number.isFinite(v?.x) || !Number.isFinite(v?.y)) return null;
          return {
            x: Number(v.x),
            y: Number(v.y),
            z: Number.isFinite(v?.z)
              ? Number(v.z)
              : Number.isFinite(raw.elevation)
                ? Number(raw.elevation)
                : 0,
            bulge: Number.isFinite(v?.bulge) ? Number(v.bulge) : 0,
          };
        })
        .filter(Boolean);

      if (vertices.length < 2) return null;

      const flagVal = Number(raw.flag ?? raw.flags ?? 0) || 0;
      const closed = Boolean(
        raw.closed === true ||
        raw.isClosed === true ||
        raw.shape === true ||
        (flagVal & 1) === 1 ||
        (type === 'LWPOLYLINE' && (flagVal & 512) === 512)
      );

      return {
        type,
        layer,
        vertices,
        closed,
        flags: flagVal,
        elevation: Number.isFinite(raw.elevation) ? Number(raw.elevation) : 0,
      };
    }

    case 'LINE': {
      const s = toPt(raw.startPoint ?? raw.start ?? raw.vertices?.[0]);
      const e = toPt(raw.endPoint ?? raw.end ?? raw.vertices?.[1]);
      if (!s || !e) return null;
      return { type: 'LINE', layer, vertices: [s, e] };
    }

    case 'ARC': {
      const center = toPt(raw.center);
      const radius = Number(raw.radius);
      if (!center || !Number.isFinite(radius) || radius <= 0) return null;
      return {
        type: 'ARC',
        layer,
        center,
        radius,
        startAngle: toRad(raw.startAngle) ?? 0,
        endAngle: toRad(raw.endAngle) ?? Math.PI * 2,
      };
    }

    case 'CIRCLE': {
      const center = toPt(raw.center);
      const radius = Number(raw.radius);
      if (!center || !Number.isFinite(radius) || radius <= 0) return null;
      return { type: 'CIRCLE', layer, center, radius };
    }

    case 'ELLIPSE': {
      const center = toPt(raw.center);
      const majorAxisEndPoint = toPt(raw.majorAxisEndPoint ?? raw.majorAxis);
      const axisRatio = Number(raw.axisRatio ?? 1);
      if (!center || !majorAxisEndPoint || !Number.isFinite(axisRatio)) return null;
      return {
        type: 'ELLIPSE',
        layer,
        center,
        majorAxisEndPoint,
        axisRatio,
        startAngle: toRad(raw.startAngle) ?? 0,
        endAngle: toRad(raw.endAngle) ?? Math.PI * 2,
      };
    }

    case 'SPLINE': {
      const fitPoints = Array.isArray(raw.fitPoints) ? raw.fitPoints.map(toPt).filter(Boolean) : [];
      const controlPoints = Array.isArray(raw.controlPoints) ? raw.controlPoints.map(toPt).filter(Boolean) : [];
      const flagVal = Number(raw.flag ?? raw.flags ?? 0) || 0;
      const closed = Boolean(raw.closed === true || (flagVal & 1) === 1);
      return { type: 'SPLINE', layer, fitPoints, controlPoints, flags: flagVal, closed };
    }

    case 'SOLID':
    case '3DFACE': {
      const rawCorners: any[] = Array.isArray(raw.points)
        ? raw.points
        : [raw.corner1, raw.corner2, raw.corner3, raw.corner4].filter(Boolean);
      const corners = rawCorners.map(toPt).filter(Boolean) as Array<{ x: number; y: number; z?: number }>;
      if (corners.length < 3) return null;
      // AutoCAD SOLID con 4 esquinas usa orden 1, 2, 4, 3; reordenar a polígono convexo simple
      const ordered = type === 'SOLID' && corners.length === 4
        ? [corners[0], corners[1], corners[3], corners[2]]
        : corners;
      return { type, layer, points: ordered };
    }

    case 'INSERT': {
      const name = raw.name ?? raw.blockName;
      if (!name) return null;
      const position = toPt(raw.insertionPoint ?? raw.position) ?? { x: 0, y: 0 };
      const xScale = Number.isFinite(raw.xScale ?? raw.scale?.x) ? Number(raw.xScale ?? raw.scale?.x) : 1;
      const yScale = Number.isFinite(raw.yScale ?? raw.scale?.y) ? Number(raw.yScale ?? raw.scale?.y) : 1;
      const rawRot = Number(raw.rotation ?? 0) || 0;
      const rotationDeg = Math.abs(rawRot) <= Math.PI * 2 + 0.01 ? (rawRot * 180) / Math.PI : rawRot;
      return {
        type: 'INSERT',
        layer,
        name: String(name),
        position,
        xScale,
        yScale,
        rotation: rotationDeg,
      };
    }

    case 'POINT': {
      const position = toPt(raw.position ?? raw.point ?? raw);
      if (!position) return null;
      return {
        type: 'POINT',
        layer,
        position,
        name: raw.name ?? raw.text,
      };
    }

    default:
      return null;
  }
}

function collectBlockRecordEntries(db: any): any[] {
  const sources = [
    db?.tables?.BLOCK_RECORD?.entries,
    db?.blockRecords,
    db?.blocks,
  ];
  for (const src of sources) {
    if (!src) continue;
    if (Array.isArray(src)) return src;
    if (typeof src === 'object') {
      return Object.entries(src).map(([name, val]: [string, any]) => ({
        name: val?.name ?? name,
        ...(val && typeof val === 'object' ? val : {}),
      }));
    }
  }
  return [];
}

/**
 * Normaliza un DwgDatabase devuelto por @mlightcad/libredwg-web al formato de entidades de FileService.
 */
export function normalizeDwgDatabase(db: any): {
  entities: any[];
  blocks: Record<string, { entities: any[] }>;
} {
  const blocks: Record<string, { entities: any[] }> = {};
  const recordEntries = collectBlockRecordEntries(db);
  let modelSpaceRecordEntities: any[] = [];

  for (const entry of recordEntries) {
    if (!entry) continue;
    const rawName = String(entry.name || '');
    const lower = rawName.toLowerCase();
    const rawEnts = Array.isArray(entry.entities) ? entry.entities : [];
    const normEnts = rawEnts.map(normalizeDwgEntity).filter(Boolean);

    if (lower === '*model_space') {
      if (modelSpaceRecordEntities.length === 0) {
        modelSpaceRecordEntities = normEnts;
      }
      continue;
    }
    if (lower.startsWith('*paper_space')) {
      continue;
    }
    if (rawName) {
      blocks[rawName] = { entities: normEnts };
    }
  }

  const rootRaw = Array.isArray(db?.entities) ? db.entities : [];
  const rootEntities = rootRaw.map(normalizeDwgEntity).filter(Boolean);
  const entities = rootEntities.length > 0 ? rootEntities : modelSpaceRecordEntities;

  return { entities, blocks };
}

function tryFallbackAsAsciiDxf(buffer: ArrayBuffer): string | null {
  try {
    const sample = new TextDecoder('utf-8', { fatal: false }).decode(
      buffer.slice(0, Math.min(4096, buffer.byteLength))
    );
    if (/\bSECTION\b/i.test(sample) && /\bENTITIES\b/i.test(sample)) {
      return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    }
  } catch {
    // ignore decode failure
  }
  return null;
}

async function decodeDwgBuffer(buffer: ArrayBuffer): Promise<{
  entities: any[];
  blocks: Record<string, { entities: any[] }>;
  versionLabel: string | null;
}> {
  const versionLabel = detectDwgVersionLabel(buffer);
  const { libredwg, dwgFileType } = await getLibreDwg();
  const fileType = dwgFileType?.DWG ?? 0;

  let dwg: any = null;
  try {
    dwg = libredwg.dwg_read_data(buffer, fileType);
    if (!dwg) {
      throw new Error(
        'No se pudo decodificar el archivo DWG. Verifica que sea un DWG válido de AutoCAD (R13–R2024).'
      );
    }
    const db = libredwg.convert(dwg);
    const { entities, blocks } = normalizeDwgDatabase(db);
    return { entities, blocks, versionLabel };
  } finally {
    if (dwg) {
      try {
        libredwg.dwg_free(dwg);
      } catch {
        // Ignore WASM free error on cleanup
      }
    }
  }
}

export async function parseDWGPolygons(file: File): Promise<{
  polygons: DXFPolygon[];
  huso: number;
  versionLabel: string | null;
}> {
  const buffer = await file.arrayBuffer();

  if (!isDwgBinaryBuffer(buffer)) {
    const dxfText = tryFallbackAsAsciiDxf(buffer);
    if (dxfText) {
      const res = FileService.parseDXFPolygons(dxfText);
      return { ...res, versionLabel: 'DXF (extensión .dwg)' };
    }
    throw new Error(
      'El archivo no tiene una cabecera DWG binaria válida (AC10xx) ni estructura DXF.'
    );
  }

  const { entities, blocks, versionLabel } = await decodeDwgBuffer(buffer);
  const parsed = FileService.parseCADEntities(entities, blocks, 'DWG');
  return { ...parsed, versionLabel };
}

export async function parseDWGPoints(file: File): Promise<GeoPoint[]> {
  const buffer = await file.arrayBuffer();

  if (!isDwgBinaryBuffer(buffer)) {
    const dxfText = tryFallbackAsAsciiDxf(buffer);
    if (dxfText) {
      const fakeFile = new File([dxfText], file.name.replace(/\.dwg$/i, '.dxf'), {
        type: 'text/plain',
      });
      return FileService.parseDXF(fakeFile);
    }
    throw new Error(
      'El archivo no tiene una cabecera DWG binaria válida (AC10xx) ni estructura DXF.'
    );
  }

  const { entities, blocks } = await decodeDwgBuffer(buffer);
  return FileService.extractPointsFromCADEntities(entities, blocks);
}
