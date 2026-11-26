import proj4 from 'proj4';

export type GeoGis6ScreenId = 'auth' | 'mapa' | 'parcela' | 'localizacion' | 'satelites';
export type CrsMode = 'regven' | 'psad56';
export type GnssReceiverMode = 'external_rtk' | 'internal_l1l5';
export type BaseMapLayerId = 'esri_sat' | 'hybrid' | 'google_sat' | 'cad_dark';

export const PROD_API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://geogis6-android.onrender.com';
export const DESKTOP_FALLBACK_API_URL =
  'https://geotransformer-monolith-fniu.onrender.com';
export const APK_DOWNLOAD_URL =
  'https://github.com/akey01/GeoGis_Android/releases/latest/download/GeoGis6_Android.apk';
export const BUNDLE_DOWNLOAD_URL =
  'https://github.com/akey01/GeoGis_Android/releases/latest/download/geogis6-web-bundle.zip';
export const GITHUB_RELEASE_API_URL =
  'https://api.github.com/repos/akey01/GeoGis_Android/releases/latest';

// Stamped automatically by build-apk workflow (updated in production build)
export const APP_VERSION_CODE = 612;
export const APP_VERSION_NAME = '6.0.12';
export const APP_NATIVE_VERSION_CODE = 612;

// ── Registrar proyecciones oficiales IGVSB Venezuela (Zonas 18N a 21N) ───────
let projDefsRegistered = false;
export function ensureVenezuelaProjections() {
  if (projDefsRegistered) return;
  projDefsRegistered = true;

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

  // PSAD56 / La Canoa UTM (Husos 18N a 21N — equivalente Helmert exacto PATVEN-98 Badekas)
  const canoaParams =
    '+ellps=intl +towgs84=-197.4328,139.3852,-192.8019,5.266,1.238,-2.381,-5.109 +units=m +no_defs';
  proj4.defs('EPSG:24818', `+proj=utm +zone=18 ${canoaParams}`);
  proj4.defs('EPSG:24819', `+proj=utm +zone=19 ${canoaParams}`);
  proj4.defs('EPSG:24820', `+proj=utm +zone=20 ${canoaParams}`);
  proj4.defs('EPSG:24821', `+proj=utm +zone=21 ${canoaParams}`);
  proj4.defs('EPSG:24878', `+proj=utm +zone=18 ${canoaParams}`);
  proj4.defs('EPSG:24879', `+proj=utm +zone=19 ${canoaParams}`);
  proj4.defs('EPSG:24880', `+proj=utm +zone=20 ${canoaParams}`);
  proj4.defs('EPSG:24881', `+proj=utm +zone=21 ${canoaParams}`);
}

export interface CloudUser {
  id: string;
  username: string;
  nombre: string;
  email: string;
  rol: string;
}

export interface SyncedProject {
  id: string;
  name: string;
  crsLabel: string;
  crsBadgeColor: 'secondary' | 'tertiary';
  parcelsText: string;
  syncStatus: string;
  syncHighlight?: boolean;
  defaultCrs: CrsMode;
  activeParcelCode: string;
  sectorLabel: string;
  source: 'cloud' | 'local';
  syncState?: 'synced' | 'pending_push' | 'local_only';
  updatedAt?: string;
}

export interface ParcelVertex {
  id: string;
  shortId: string;
  code: string;
  description: string;
  esteRegven: number;
  norteRegven: number;
  estePsad56: number;
  nortePsad56: number;
  lat: number;
  lng: number;
  cota: number;
  segmentLengthToNext: number;
  azimuthToNext: string;
  mapX: number;
  mapY: number;
  miniX: number;
  miniY: number;
  stakeDist: number;
  stakeNorthDelta: number;
  stakeEastDelta: number;
  stakeCutFill: number;
  stakeAzimuthDeg: string;
  stakeAzimuthSec: string;
  roverOffsetX: number;
  roverOffsetY: number;
}

export interface FieldParcel {
  id: string;
  code: string;
  title: string;
  location: string;
  sector: string;
  zoneTag: string;
  owner: string;
  cadastralId: string;
  geoCenterText: string;
  areaDocumentalM2: number;
  areaGraficaM2: number;
  toleranceM2: number;
  perimeterM: number;
  linearClosureM: number;
  precisionRatio: string;
  angularError: string;
  orientationLabel: string;
  huso: number;
  geometryType?: 'cerrada' | 'abierta' | 'puntos';
  vertices: ParcelVertex[];
}

export interface LiveGnssFix {
  lat: number;
  lng: number;
  alt: number;
  accuracy: number;
  esteRegven: number;
  norteRegven: number;
  isLiveHardware: boolean;
  timestamp: number;
  heading?: number | null;
  speed?: number | null;
  altitudeAccuracy?: number | null;
}

export const ADICORA_RIGIDA02_SHIFT = {
  deltaEste: -204.33,
  deltaNorte: -311.54,
  cotaGeoidal: -22.45,
};

function formatDmsShort(deg: number, isLat: boolean): string {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mf = (abs - d) * 60;
  const m = Math.floor(mf);
  const s = Math.round((mf - m) * 60);
  const hemi = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
  return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"${hemi}`;
}

export function formatAzimuthDms(dx: number, dy: number): { degMin: string; sec: string; full: string } {
  let az = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (az < 0) az += 360;
  const d = Math.floor(az);
  const mf = (az - d) * 60;
  const m = Math.floor(mf);
  const s = Math.round((mf - m) * 60);
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return {
    degMin: `${dd}°${mm}'`,
    sec: `${ss}"`,
    full: `${dd}° ${mm}' ${ss}"`,
  };
}

/** Construye una FieldParcel georreferenciada real a partir de vértices REGVEN UTM */
export function buildFieldParcelFromVertices(input: {
  id: string;
  code: string;
  location: string;
  sector: string;
  zoneTag?: string;
  owner?: string;
  cadastralId?: string;
  huso?: number;
  areaDocumentalM2?: number;
  geometryType?: 'cerrada' | 'abierta' | 'puntos';
  rawVertices: Array<{
    id?: string;
    shortId?: string;
    code?: string;
    description?: string;
    esteRegven: number;
    norteRegven: number;
    estePsad56?: number;
    nortePsad56?: number;
    lat?: number;
    lng?: number;
    cota?: number;
  }>;
}): FieldParcel {
  ensureVenezuelaProjections();
  const huso = [18, 19, 20, 21].includes(Number(input.huso)) ? Number(input.huso) : 19;
  const regvenEpsg = `EPSG:220${huso - 17}`;
  const psadEpsg = `EPSG:248${huso}`;

  const enriched = input.rawVertices.map((rv, idx) => {
    let lat = rv.lat;
    let lng = rv.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      try {
        const [lonOut, latOut] = proj4(regvenEpsg, 'EPSG:4326', [rv.esteRegven, rv.norteRegven]);
        lng = lonOut;
        lat = latOut;
      } catch {
        lat = 11.945;
        lng = -69.805;
      }
    }

    let estePsad56 = rv.estePsad56;
    let nortePsad56 = rv.nortePsad56;
    if (typeof estePsad56 !== 'number' || typeof nortePsad56 !== 'number' || !Number.isFinite(estePsad56)) {
      try {
        const [pe, pn] = proj4(regvenEpsg, psadEpsg, [rv.esteRegven, rv.norteRegven]);
        estePsad56 = Math.round(pe * 1000) / 1000;
        nortePsad56 = Math.round(pn * 1000) / 1000;
      } catch {
        estePsad56 = Math.round((rv.esteRegven - ADICORA_RIGIDA02_SHIFT.deltaEste) * 1000) / 1000;
        nortePsad56 = Math.round((rv.norteRegven - ADICORA_RIGIDA02_SHIFT.deltaNorte) * 1000) / 1000;
      }
    }

    return {
      id: rv.id || `V-${String(idx + 1).padStart(2, '0')}`,
      shortId: rv.shortId || `V${idx + 1}`,
      code: rv.code || `Hito_${idx + 1}`,
      description: rv.description || `Vértice ${idx + 1} · REGVEN UTM ${huso}N`,
      esteRegven: Math.round(rv.esteRegven * 1000) / 1000,
      norteRegven: Math.round(rv.norteRegven * 1000) / 1000,
      estePsad56,
      nortePsad56,
      lat,
      lng,
      cota: typeof rv.cota === 'number' && Number.isFinite(rv.cota) ? rv.cota : 18.25,
    };
  });

  // Shoelace area & perimeter
  const n = enriched.length;
  let areaSum = 0;
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const cur = enriched[i];
    const nxt = enriched[(i + 1) % n];
    if (n >= 3) {
      areaSum += cur.esteRegven * nxt.norteRegven - nxt.esteRegven * cur.norteRegven;
    }
    if (n >= 2 && (input.geometryType !== 'abierta' || i < n - 1)) {
      perimeter += Math.hypot(nxt.esteRegven - cur.esteRegven, nxt.norteRegven - cur.norteRegven);
    }
  }
  const areaGraficaM2 = Math.round((Math.abs(areaSum) / 2) * 100) / 100;
  const perimeterM = Math.round(perimeter * 100) / 100;

  // Mini SVG projection (160x90 box with padding)
  const allE = enriched.map((v) => v.esteRegven);
  const allN = enriched.map((v) => v.norteRegven);
  const minE = Math.min(...allE);
  const maxE = Math.max(...allE);
  const minN = Math.min(...allN);
  const maxN = Math.max(...allN);
  const spanE = Math.max(maxE - minE, 1);
  const spanN = Math.max(maxN - minN, 1);
  const scaleMini = Math.min(116 / spanE, 60 / spanN);
  const centerE = (minE + maxE) / 2;
  const centerN = (minN + maxN) / 2;

  const avgLat = enriched.reduce((acc, v) => acc + v.lat, 0) / Math.max(1, n);
  const avgLng = enriched.reduce((acc, v) => acc + v.lng, 0) / Math.max(1, n);

  const vertices: ParcelVertex[] = enriched.map((v, idx) => {
    const nxt = enriched[(idx + 1) % n] || v;
    const segDx = nxt.esteRegven - v.esteRegven;
    const segDy = nxt.norteRegven - v.norteRegven;
    const segLen = Math.round(Math.hypot(segDx, segDy) * 100) / 100;
    const az = formatAzimuthDms(segDx, segDy);

    const miniX = Math.round((80 + (v.esteRegven - centerE) * scaleMini) * 10) / 10;
    const miniY = Math.round((45 - (v.norteRegven - centerN) * scaleMini) * 10) / 10;

    // Default simulated rover offset near vertex
    const seedAngle = ((idx * 97 + 31) % 360) * (Math.PI / 180);
    const simDist = Math.round((0.45 + ((idx % 4) * 0.35)) * 1000) / 1000;
    const dN = Math.round(Math.cos(seedAngle) * simDist * 1000) / 1000;
    const dE = Math.round(Math.sin(seedAngle) * simDist * 1000) / 1000;
    const stakeAz = formatAzimuthDms(dE, dN);

    return {
      ...v,
      segmentLengthToNext: segLen,
      azimuthToNext: az.full,
      mapX: Math.round(200 + (v.esteRegven - centerE) * 3),
      mapY: Math.round(310 - (v.norteRegven - centerN) * 3),
      miniX,
      miniY,
      stakeDist: simDist,
      stakeNorthDelta: dN,
      stakeEastDelta: dE,
      stakeCutFill: idx % 2 === 0 ? -0.024 : 0.015,
      stakeAzimuthDeg: stakeAz.degMin,
      stakeAzimuthSec: stakeAz.sec,
      roverOffsetX: Math.max(-62, Math.min(62, Math.round(dE * 42))),
      roverOffsetY: Math.max(-62, Math.min(62, Math.round(-dN * 42))),
    };
  });

  const areaDocumentalM2 =
    typeof input.areaDocumentalM2 === 'number' && input.areaDocumentalM2 > 0
      ? input.areaDocumentalM2
      : areaGraficaM2;

  return {
    id: input.id,
    code: input.code,
    title: `PARCELA ${input.code}`,
    location: input.location,
    sector: input.sector,
    zoneTag: input.zoneTag || 'Catastro',
    owner: input.owner || 'PROPIETARIO REGISTRADO',
    cadastralId: input.cadastralId || `VE-19N-${input.code}`,
    geoCenterText: `${formatDmsShort(avgLat, true)} · ${formatDmsShort(avgLng, false)}`,
    areaDocumentalM2,
    areaGraficaM2,
    toleranceM2: Math.max(1.5, Math.round(areaGraficaM2 * 0.002 * 10) / 10),
    perimeterM,
    linearClosureM: 0.002,
    precisionRatio: '1:45,000',
    angularError: `0° 00' 03"`,
    orientationLabel: 'N 00°E',
    huso,
    geometryType: input.geometryType || 'cerrada',
    vertices,
  };
}

/**
 * Parsea cualquier proyecto guardado desde GeoGIS6 Desktop o Mobile (PostgreSQL JSON)
 * convirtiendo todas sus parcelas (`content.parcels`) a geometrías georreferenciadas reales.
 */
export function parseCloudProjectParcels(rawContent: unknown, projectName: string): FieldParcel[] {
  ensureVenezuelaProjections();
  let parsed: any = rawContent;
  if (typeof rawContent === 'string') {
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const rawList: any[] = Array.isArray(parsed.parcels)
    ? parsed.parcels
    : Array.isArray(parsed.savedParcels)
      ? parsed.savedParcels
      : [];

  const metaLocation = String(parsed?.meta?.ubicacion || parsed?.meta?.notas || projectName || 'Venezuela');
  const results: FieldParcel[] = [];

  for (let pIdx = 0; pIdx < rawList.length; pIdx++) {
    const p = rawList[pIdx];
    if (!p || !Array.isArray(p.puntos) || p.puntos.length === 0) continue;

    // Detect huso from points
    const firstValid = p.puntos.find((pt: any) => pt?.result?.huso || pt?.input?.huso);
    const candidateHuso = Number(firstValid?.result?.huso ?? firstValid?.input?.huso ?? 19);
    const huso = [18, 19, 20, 21].includes(candidateHuso) ? candidateHuso : 19;
    const regvenEpsg = `EPSG:220${huso - 17}`;
    const psadEpsg = `EPSG:248${huso}`;

    const rawVertices: Array<{
      id: string;
      shortId: string;
      code: string;
      description: string;
      esteRegven: number;
      norteRegven: number;
      estePsad56?: number;
      nortePsad56?: number;
      lat?: number;
      lng?: number;
      cota?: number;
    }> = [];

    for (let i = 0; i < p.puntos.length; i++) {
      const pt = p.puntos[i];
      if (!pt) continue;
      const dir = String(pt.direction ?? pt.result?.direction ?? 'canoa_regven');
      const isResultCanoa = dir === 'regven_canoa';
      const isInputCanoa = dir === 'canoa_regven';

      let esteRegven: number | undefined;
      let norteRegven: number | undefined;
      let estePsad56: number | undefined;
      let nortePsad56: number | undefined;
      let lat: number | undefined;
      let lng: number | undefined;

      const rE = Number(pt.result?.este);
      const rN = Number(pt.result?.norte);
      const iE = Number(pt.input?.este);
      const iN = Number(pt.input?.norte);

      if (Number.isFinite(rE) && Number.isFinite(rN) && (rE > 1000 || rN > 1000)) {
        if (isResultCanoa) {
          estePsad56 = rE;
          nortePsad56 = rN;
          if (Number.isFinite(iE) && Number.isFinite(iN) && (iE > 1000 || iN > 1000)) {
            esteRegven = iE;
            norteRegven = iN;
          } else {
            try {
              const [re, rn] = proj4(psadEpsg, regvenEpsg, [rE, rN]);
              esteRegven = re;
              norteRegven = rn;
            } catch {}
          }
        } else {
          esteRegven = rE;
          norteRegven = rN;
          if (isInputCanoa && Number.isFinite(iE) && Number.isFinite(iN) && (iE > 1000 || iN > 1000)) {
            estePsad56 = iE;
            nortePsad56 = iN;
          }
        }
      } else if (Number.isFinite(iE) && Number.isFinite(iN) && (iE > 1000 || iN > 1000)) {
        if (isInputCanoa) {
          estePsad56 = iE;
          nortePsad56 = iN;
          try {
            const [re, rn] = proj4(psadEpsg, regvenEpsg, [iE, iN]);
            esteRegven = re;
            norteRegven = rn;
          } catch {}
        } else {
          esteRegven = iE;
          norteRegven = iN;
        }
      }

      // Geographic fallback
      const rLat = Number(pt.result?.lat ?? pt.input?.lat);
      const rLng = Number(pt.result?.lng ?? pt.input?.lng);
      if (
        Number.isFinite(rLat) &&
        Number.isFinite(rLng) &&
        Math.abs(rLat) <= 90 &&
        Math.abs(rLng) <= 180 &&
        (rLat !== 0 || rLng !== 0)
      ) {
        lat = rLat;
        lng = rLng;
        if (esteRegven === undefined || norteRegven === undefined) {
          try {
            const [re, rn] = proj4('EPSG:4326', regvenEpsg, [rLng, rLat]);
            esteRegven = re;
            norteRegven = rn;
          } catch {}
        }
      }

      if (esteRegven === undefined || norteRegven === undefined) continue;

      const ptLabel = String(pt.id || pt.input?.id || `V${i + 1}`);
      const cotaVal = Number(pt.result?.cota ?? pt.input?.alt ?? pt.input?.cota ?? 18.25);

      rawVertices.push({
        id: ptLabel.startsWith('V-') ? ptLabel : `V-${String(i + 1).padStart(2, '0')}`,
        shortId: ptLabel.length <= 5 ? ptLabel : `V${i + 1}`,
        code: String(pt.codigo || pt.code || `PT_${i + 1}`),
        description: `Vértice ${ptLabel} · Proyecto ${projectName}`,
        esteRegven,
        norteRegven,
        estePsad56,
        nortePsad56,
        lat,
        lng,
        cota: Number.isFinite(cotaVal) ? cotaVal : 18.25,
      });
    }

    if (rawVertices.length === 0) continue;

    const code = String(p.nombre || p.code || `PARCELA-${pIdx + 1}`).trim();
    const geomType: 'cerrada' | 'abierta' | 'puntos' =
      p.geometryType === 'abierta' || p.geometryType === 'puntos' ? p.geometryType : 'cerrada';

    results.push(
      buildFieldParcelFromVertices({
        id: String(p.id || `cloud-parcel-${pIdx + 1}`),
        code,
        location: projectName,
        sector: metaLocation,
        zoneTag: geomType === 'cerrada' ? 'Polígono' : geomType === 'abierta' ? 'Polilínea' : 'Puntos',
        owner: String(p.propietario || parsed?.meta?.cliente || projectName),
        cadastralId: String(p.codigoCatastral || p.id || code),
        huso,
        areaDocumentalM2: Number(p.area) > 0 ? Number(p.area) : undefined,
        geometryType: geomType,
        rawVertices,
      })
    );
  }

  return results;
}

export const VENEZUELA_DEFAULT_CENTER = {
  lat: 10.4806,
  lng: -66.9036,
  esteRegven: 729500,
  norteRegven: 1159200,
};

export function getOrCreateFieldDeviceId(): string {
  if (typeof window === 'undefined') return 'apk_server_ssr';
  let id = localStorage.getItem('gt_device_id');
  if (!id || id.length < 8) {
    id = `apk_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem('gt_device_id', id);
  }
  return id;
}

export function formatCoord(val: number): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function geoToUtmGrs80(latDeg: number, lngDeg: number, huso = 19) {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const lon0 = huso * 6 - 183;
  const latR = (latDeg * Math.PI) / 180;
  const lngR = (lngDeg * Math.PI) / 180;
  const lng0R = (lon0 * Math.PI) / 180;
  const sinLat = Math.sin(latR);
  const cosLat = Math.cos(latR);
  const tanLat = Math.tan(latR);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = ep2 * cosLat * cosLat;
  const A = cosLat * (lngR - lng0R);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M =
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latR -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latR) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latR) -
      ((35 * e6) / 3072) * Math.sin(6 * latR));
  const A2 = A * A;
  const A3 = A2 * A;
  const A4 = A3 * A;
  const A5 = A4 * A;
  const A6 = A5 * A;
  const este =
    k0 * N * (A + ((1 - T + C) * A3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5) / 120) +
    500000.0;
  let norte =
    k0 *
    (M +
      N *
        tanLat *
        (A2 / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6) / 720));
  if (latDeg < 0) norte += 10000000.0;
  return {
    este: Math.round(este * 1000) / 1000,
    norte: Math.round(norte * 1000) / 1000,
  };
}

export function buildCivilCadTxt(parcel: FieldParcel, crs: CrsMode): string {
  const header = `# GEOGIS6 MOBILE v${APP_VERSION_NAME} - PARCELA ${parcel.code} (${parcel.location})\n# DATUM: ${
    crs === 'regven' ? `REGVEN ${parcel.huso}N (RIGIDA02)` : `PSAD56 LA CANOA ${parcel.huso}N`
  }\n# ID,ESTE,NORTE,COTA,CODIGO`;
  const rows = parcel.vertices.map((v) => {
    const e = crs === 'regven' ? v.esteRegven : v.estePsad56;
    const n = crs === 'regven' ? v.norteRegven : v.nortePsad56;
    return `${v.shortId},${e.toFixed(3)},${n.toFixed(3)},${v.cota.toFixed(3)},${v.code}`;
  });
  return [header, ...rows].join('\n');
}

export function buildParcelDxf(parcel: FieldParcel, crs: CrsMode): string {
  const layer = `LINDEROS_${parcel.code.replace(/[^A-Z0-9_-]/gi, '_')}`;
  const lines = [
    '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'POLYLINE', '8', layer, '66', '1', '70', '1',
  ];
  for (const v of parcel.vertices) {
    const e = crs === 'regven' ? v.esteRegven : v.estePsad56;
    const n = crs === 'regven' ? v.norteRegven : v.nortePsad56;
    lines.push('0', 'VERTEX', '8', layer, '10', e.toFixed(3), '20', n.toFixed(3), '30', v.cota.toFixed(3));
  }
  lines.push('0', 'SEQEND', '0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}

export function buildParcelKml(parcel: FieldParcel): string {
  const ring = parcel.vertices.map((v) => `${v.lng.toFixed(8)},${v.lat.toFixed(8)},${v.cota.toFixed(2)}`);
  if (parcel.vertices.length >= 3) {
    const first = parcel.vertices[0];
    ring.push(`${first.lng.toFixed(8)},${first.lat.toFixed(8)},${first.cota.toFixed(2)}`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${parcel.code}</name><Placemark><name>${parcel.title}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring.join(
    ' '
  )}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
}
