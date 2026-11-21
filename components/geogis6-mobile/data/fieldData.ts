export type GeoGis6ScreenId = 'auth' | 'mapa' | 'parcela' | 'localizacion' | 'satelites';
export type CrsMode = 'regven' | 'psad56';
export type GnssReceiverMode = 'external_rtk' | 'internal_l1l5';

export const PROD_API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://geogis6-android.onrender.com';
export const APK_DOWNLOAD_URL =
  'https://github.com/akey01/GeoGis_Android/releases/latest/download/GeoGis6_Android.apk';
export const GITHUB_RELEASE_API_URL =
  'https://api.github.com/repos/akey01/GeoGis_Android/releases/latest';

// Stamped automatically by build-apk workflow (updated in production build)
export const APP_VERSION_CODE = 610;
export const APP_VERSION_NAME = '6.0.10';

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
}

export interface SatellitePoint {
  prn: string;
  constellation: 'GPS' | 'GLONASS' | 'GALILEO' | 'BEIDOU';
  elevationDeg: number;
  azimuthDeg: number;
  snrDbHz: number;
  status: 'fixed' | 'tracked' | 'masked';
  topPx: number;
  leftPx: number;
  highlightRing?: boolean;
}

export interface ConstellationSummary {
  id: 'GPS' | 'GLONASS' | 'GALILEO' | 'BEIDOU';
  label: string;
  used: number;
  visible: number;
  percent: number;
  bands: string;
  avgSnr: number;
  accentHex: string;
  barHex: string;
}

export const ADICORA_RIGIDA02_SHIFT = {
  deltaEste: -204.33,
  deltaNorte: -311.54,
  cotaGeoidal: -22.45,
};

export const DEFAULT_SYNCED_PROJECTS: SyncedProject[] = [
  {
    id: 'prj-adicora-norte',
    name: 'Adícora Sector Norte',
    crsLabel: 'REGVEN 19N | RIGIDA02',
    crsBadgeColor: 'secondary',
    parcelsText: '12/12 Parcelas Almacenadas',
    syncStatus: 'Sync: hace 15m',
    defaultCrs: 'regven',
    activeParcelCode: '5371-JAR',
    sectorLabel: 'Sector Falcón · Urbano',
    source: 'local',
  },
  {
    id: 'prj-pueblo-nuevo',
    name: 'Pueblo Nuevo Catastro',
    crsLabel: 'PSAD56 La Canoa',
    crsBadgeColor: 'tertiary',
    parcelsText: '8 Parcelas Relevadas',
    syncStatus: 'Caché local activa',
    syncHighlight: true,
    defaultCrs: 'psad56',
    activeParcelCode: '5371-JAR',
    sectorLabel: 'Península de Paraguaná · Urbano',
    source: 'local',
  },
];

export const DEFAULT_PARCEL_5371_JAR: FieldParcel = {
  id: 'POL-5371-JAR',
  code: '5371-JAR',
  title: 'PARCELA 5371-JAR',
  location: 'Adícora',
  sector: 'Sector Falcón · Urbano',
  zoneTag: 'Urbano',
  owner: 'J. A. RODRÍGUEZ (ADÍCORA)',
  cadastralId: '11-06-01-U-5371-JAR',
  geoCenterText: `11°56'42"N · 69°48'19"W`,
  areaDocumentalM2: 1250.0,
  areaGraficaM2: 1249.85,
  toleranceM2: 2.5,
  perimeterM: 145.2,
  linearClosureM: 0.002,
  precisionRatio: '1:45,000',
  angularError: `0° 00' 03"`,
  orientationLabel: 'N 12°W',
  huso: 19,
  vertices: [
    {
      id: 'V-01',
      shortId: 'V1',
      code: 'Cerco_NO',
      description: 'Hito Lindero Principal · REGVEN UTM 19N',
      esteRegven: 398394.22,
      norteRegven: 1284882.41,
      estePsad56: 398598.55,
      nortePsad56: 1285193.95,
      lat: 11.94518,
      lng: -69.80548,
      cota: 18.25,
      segmentLengthToNext: 38.45,
      azimuthToNext: `54° 22' 10"`,
      mapX: 80,
      mapY: 225,
      miniX: 28,
      miniY: 26,
      stakeDist: 1.658,
      stakeNorthDelta: 1.42,
      stakeEastDelta: 0.855,
      stakeCutFill: -0.035,
      stakeAzimuthDeg: `31°04'`,
      stakeAzimuthSec: `15"`,
      roverOffsetX: 52,
      roverOffsetY: -68,
    },
    {
      id: 'V-02',
      shortId: 'V2',
      code: 'Cerco_NE',
      description: 'Esquina Noreste · Calle Marina Adícora',
      esteRegven: 398425.1,
      norteRegven: 1284904.55,
      estePsad56: 398629.43,
      nortePsad56: 1285216.09,
      lat: 11.94538,
      lng: -69.80519,
      cota: 18.31,
      segmentLengthToNext: 32.6,
      azimuthToNext: `171° 56' 40"`,
      mapX: 330,
      mapY: 205,
      miniX: 126,
      miniY: 14,
      stakeDist: 0.942,
      stakeNorthDelta: 0.78,
      stakeEastDelta: -0.528,
      stakeCutFill: 0.018,
      stakeAzimuthDeg: `325°54'`,
      stakeAzimuthSec: `08"`,
      roverOffsetX: -36,
      roverOffsetY: -50,
    },
    {
      id: 'V-03',
      shortId: 'V3',
      code: 'Hito_SE',
      description: 'Hito Concreto Sureste · Colindancia 5375',
      esteRegven: 398432.8,
      norteRegven: 1284850.12,
      estePsad56: 398637.13,
      nortePsad56: 1285161.66,
      lat: 11.94489,
      lng: -69.80512,
      cota: 18.42,
      segmentLengthToNext: 39.1,
      azimuthToNext: `235° 02' 18"`,
      mapX: 355,
      mapY: 420,
      miniX: 140,
      miniY: 68,
      stakeDist: 0.312,
      stakeNorthDelta: -0.24,
      stakeEastDelta: 0.2,
      stakeCutFill: -0.012,
      stakeAzimuthDeg: `140°11'`,
      stakeAzimuthSec: `40"`,
      roverOffsetX: 20,
      roverOffsetY: 22,
    },
    {
      id: 'V-04',
      shortId: 'V4',
      code: 'Hito_SO',
      description: 'Hito Suroeste · Límite Manzana MAN1',
      esteRegven: 398401.65,
      norteRegven: 1284828.3,
      estePsad56: 398605.98,
      nortePsad56: 1285139.84,
      lat: 11.94469,
      lng: -69.80541,
      cota: 18.19,
      segmentLengthToNext: 35.05,
      azimuthToNext: `352° 11' 05"`,
      mapX: 105,
      mapY: 445,
      miniX: 44,
      miniY: 78,
      stakeDist: 0.042,
      stakeNorthDelta: 0.03,
      stakeEastDelta: -0.029,
      stakeCutFill: 0.004,
      stakeAzimuthDeg: `315°58'`,
      stakeAzimuthSec: `22"`,
      roverOffsetX: -7,
      roverOffsetY: -6,
    },
  ],
};

export const ADICORA_SATELLITE_TILE_CENTER = { z: 17, x: 40120, y: 61155 };

export const ADJACENT_PARCELS = [
  { code: '5373', points: '40,90 170,75 195,190 75,205', labelX: 110, labelY: 145, areaM2: 1180.4 },
  { code: '5375', points: '205,80 365,65 385,195 230,210', labelX: 290, labelY: 140, areaM2: 1315.2 },
  { code: 'MAN1 - RESERVA', points: '50,470 360,450 375,560 65,580', labelX: 210, labelY: 520, areaM2: 3420.0 },
];

export const GNSS_SATELLITES: SatellitePoint[] = [
  { prn: 'G04', constellation: 'GPS', elevationDeg: 72, azimuthDeg: 34, snrDbHz: 48, status: 'fixed', topPx: 36, leftPx: 138, highlightRing: true },
  { prn: 'G12', constellation: 'GPS', elevationDeg: 58, azimuthDeg: 68, snrDbHz: 46, status: 'fixed', topPx: 72, leftPx: 154 },
  { prn: 'G18', constellation: 'GPS', elevationDeg: 44, azimuthDeg: 118, snrDbHz: 44, status: 'fixed', topPx: 130, leftPx: 160 },
  { prn: 'G24', constellation: 'GPS', elevationDeg: 81, azimuthDeg: 325, snrDbHz: 49, status: 'fixed', topPx: 92, leftPx: 104, highlightRing: true },
  { prn: 'R08', constellation: 'GLONASS', elevationDeg: 49, azimuthDeg: 318, snrDbHz: 44, status: 'fixed', topPx: 50, leftPx: 62 },
  { prn: 'R14', constellation: 'GLONASS', elevationDeg: 42, azimuthDeg: 224, snrDbHz: 43, status: 'fixed', topPx: 152, leftPx: 74 },
  { prn: 'R21', constellation: 'GLONASS', elevationDeg: 21, azimuthDeg: 158, snrDbHz: 34, status: 'tracked', topPx: 180, leftPx: 140 },
  { prn: 'E11', constellation: 'GALILEO', elevationDeg: 54, azimuthDeg: 274, snrDbHz: 46, status: 'fixed', topPx: 112, leftPx: 56 },
  { prn: 'E19', constellation: 'GALILEO', elevationDeg: 66, azimuthDeg: 308, snrDbHz: 47, status: 'fixed', topPx: 76, leftPx: 90 },
  { prn: 'E27', constellation: 'GALILEO', elevationDeg: 39, azimuthDeg: 196, snrDbHz: 42, status: 'fixed', topPx: 164, leftPx: 104 },
  { prn: 'C24', constellation: 'BEIDOU', elevationDeg: 76, azimuthDeg: 95, snrDbHz: 46, status: 'fixed', topPx: 104, leftPx: 132 },
  { prn: 'C30', constellation: 'BEIDOU', elevationDeg: 52, azimuthDeg: 146, snrDbHz: 44, status: 'fixed', topPx: 142, leftPx: 138 },
  { prn: 'C35', constellation: 'BEIDOU', elevationDeg: 11, azimuthDeg: 338, snrDbHz: 24, status: 'masked', topPx: 22, leftPx: 74 },
  { prn: 'G09', constellation: 'GPS', elevationDeg: 18, azimuthDeg: 205, snrDbHz: 31, status: 'tracked', topPx: 198, leftPx: 88 },
];

export const CONSTELLATION_SUMMARIES: ConstellationSummary[] = [
  { id: 'GPS', label: 'GPS (NAVSTAR)', used: 10, visible: 12, percent: 88, bands: 'L1/C/A + L5', avgSnr: 46, accentHex: '#4cd7f6', barHex: '#4cd7f6' },
  { id: 'GLONASS', label: 'GLONASS', used: 7, visible: 10, percent: 70, bands: 'G1 + G2 FDMA', avgSnr: 43, accentHex: '#ffb95f', barHex: '#ffb95f' },
  { id: 'GALILEO', label: 'GALILEO', used: 8, visible: 12, percent: 80, bands: 'E1 + E5a/b', avgSnr: 45, accentHex: '#4edea3', barHex: '#4edea3' },
  { id: 'BEIDOU', label: 'BEIDOU-3', used: 7, visible: 12, percent: 75, bands: 'B1I + B2a/B3I', avgSnr: 44, accentHex: '#acedff', barHex: '#06b6d4' },
];

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
