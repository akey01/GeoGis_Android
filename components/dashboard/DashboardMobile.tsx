'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeftRight,
  BatteryCharging,
  CheckCircle2,
  Cloud,
  Compass,
  Crosshair,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  HardDrive,
  Layers,
  LogIn,
  LogOut,
  Map as MapIcon,
  MapPin,
  Maximize2,
  Navigation,
  Package,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Satellite,
  Search,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Target,
  Trash2,
  User,
  UserCircle,
  Copy,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'react-hot-toast';
import { getOrCreateDeviceId, installGlobalDeviceFetchInterceptor } from '@/src/utils/device';
import {
  applyDynamicRoleConfig,
  hasPermission,
  isDemoRole,
  normalizeUserRole,
  ROLE_PERMISSIONS_MATRIX,
} from '@/src/types/auth';
import { GeoEngine, HAYFORD, GRS80, PATVEN98 } from '@/lib/geo-engine';
import { FileService } from '@/lib/file-service';
import { exportResultsToDXF } from '@/lib/exportDxf';
import { useAppStore, type Parcel, type TransformationResult } from '@/lib/store';

const MapViewer = dynamic(() => import('@/src/components/MapViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#060e20] flex flex-col items-center justify-center gap-2 text-[#4cd7f6] font-mono text-xs">
      <div className="w-7 h-7 border-2 border-[#4cd7f6]/30 border-t-[#4cd7f6] rounded-full animate-spin" />
      <span>Cargando Motor Satelital OpenLayers...</span>
    </div>
  ),
});

const ProfileModalLazy = dynamic(() => import('./ProfileModal'), { ssr: false });
const ParcelListLazy = dynamic(() => import('./ParcelList'), { ssr: false });
const ProjectManagerLazy = dynamic(() => import('./ProjectManager'), { ssr: false });

export type AndroidNavTab = 'map' | 'topographer' | 'locate' | 'parcels' | 'projects';
type EngineMethod = 'rigida02' | 'badekas' | 'rigida';
type TransformDir = 'canoa_regven' | 'regven_canoa';
type MapLayerMode = 'catastro' | 'satellite' | 'hybrid' | 'dtm';
type CanvasEngineMode = 'stitch' | 'openlayers';
type LocateInputMode = 'utm' | 'geo' | 'batch';
type LocateDatum = 'regven' | 'canoa';

export interface FieldVertex {
  id: string;
  lat: number;
  lng: number;
  z: number;
  rms: number;
  source: 'gps' | 'located' | 'sample';
}

interface GnssSample {
  lat: number;
  lng: number;
  alt: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
  isLiveHardware: boolean;
}

interface SatInfo {
  prn: string;
  sys: 'GPS' | 'GLO' | 'GAL' | 'BDS';
  el: number;
  az: number;
  snr: number;
}

const DEFAULT_PARCEL_GEO: FieldVertex[] = [
  { id: 'V-01', lat: 11.94385, lng: -69.81845, z: 12.4, rms: 0.008, source: 'sample' },
  { id: 'V-02', lat: 11.94418, lng: -69.81762, z: 13.1, rms: 0.009, source: 'sample' },
  { id: 'V-03', lat: 11.94352, lng: -69.81715, z: 14.0, rms: 0.011, source: 'sample' },
  { id: 'V-04', lat: 11.94285, lng: -69.81788, z: 13.3, rms: 0.01, source: 'sample' },
  { id: 'V-05', lat: 11.94321, lng: -69.81856, z: 11.9, rms: 0.012, source: 'sample' },
];

const CONSTELLATION_SATS: SatInfo[] = [
  { prn: 'G04', sys: 'GPS', el: 74, az: 35, snr: 44 },
  { prn: 'G12', sys: 'GPS', el: 52, az: 142, snr: 41 },
  { prn: 'G25', sys: 'GPS', el: 38, az: 265, snr: 38 },
  { prn: 'R07', sys: 'GLO', el: 66, az: 310, snr: 42 },
  { prn: 'R19', sys: 'GLO', el: 28, az: 78, snr: 34 },
  { prn: 'E11', sys: 'GAL', el: 59, az: 205, snr: 40 },
  { prn: 'E24', sys: 'GAL', el: 43, az: 118, snr: 37 },
  { prn: 'C08', sys: 'BDS', el: 48, az: 292, snr: 36 },
];

const LAYER_LABELS: Record<MapLayerMode, string> = {
  catastro: 'Catastro',
  satellite: 'Satélite',
  hybrid: 'Híbrido',
  dtm: 'LiDAR DTM',
};

function formatDms(deg: number, isLat: boolean): string {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(3);
  const hemi = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
  return `${String(d).padStart(2, '0')}°${String(m).padStart(2, '0')}'${String(s).padStart(6, '0')}"${hemi}`;
}

function formatRumboAzimut(dx: number, dy: number): { rumbo: string; azimutDeg: number } {
  let az = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (az < 0) az += 360;
  let ns = 'N';
  let ew = 'E';
  let rDeg = az;
  if (az <= 90) {
    ns = 'N';
    ew = 'E';
    rDeg = az;
  } else if (az <= 180) {
    ns = 'S';
    ew = 'E';
    rDeg = 180 - az;
  } else if (az <= 270) {
    ns = 'S';
    ew = 'W';
    rDeg = az - 180;
  } else {
    ns = 'N';
    ew = 'W';
    rDeg = 360 - az;
  }
  const d = Math.floor(rDeg);
  const mf = (rDeg - d) * 60;
  const m = Math.floor(mf);
  const s = Math.round((mf - m) * 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    azimutDeg: az,
    rumbo: `${ns} ${p(d)}°${p(m)}'${p(s)}" ${ew}`,
  };
}

/** Calcula Factor de Escala UTM (k) y Convergencia de Meridianos (γ en °) sobre GRS80 */
function computeUtmProjectionFactors(latDeg: number, lngDeg: number, este: number, huso: number) {
  const lon0 = huso * 6 - 183;
  const latR = GeoEngine.toRad(latDeg);
  const dLonDeg = lngDeg - lon0;
  const sinLat = Math.sin(latR);
  const N = GRS80.a / Math.sqrt(1 - GRS80.e2 * sinLat * sinLat);
  const rho = (GRS80.a * (1 - GRS80.e2)) / Math.pow(1 - GRS80.e2 * sinLat * sinLat, 1.5);
  const rMean = Math.sqrt(N * rho);
  const x = este - 500000.0;
  const k = 0.9996 * (1 + (x * x) / (2 * rMean * rMean * 0.9996 * 0.9996));
  const convergenceDeg = dLonDeg * sinLat;
  return { k, convergenceDeg };
}

/** Convierte coordenada geográfica WGS84/REGVEN a ambos datums UTM (REGVEN GRS80 y PSAD56 La Canoa) */
function computeDualUtmFromGeo(
  lat: number,
  lng: number,
  z: number,
  huso: number,
  method: EngineMethod
) {
  const regven = GeoEngine.geoToUTM(lat, lng, huso, GRS80);
  let canoaEste = regven.este;
  let canoaNorte = regven.norte;

  if (method === 'rigida02') {
    canoaEste = Math.round((regven.este - GeoEngine.RIGIDA02_DELTA_ESTE) * 1000) / 1000;
    canoaNorte = Math.round((regven.norte - GeoEngine.RIGIDA02_DELTA_NORTE) * 1000) / 1000;
  } else if (method === 'rigida') {
    const invRes = GeoEngine.transformRigida(regven.este, regven.norte, z, huso, true);
    canoaEste = invRes.este;
    canoaNorte = invRes.norte;
  } else {
    const cartR = GeoEngine.geoToCart(lat, lng, z, GRS80);
    const cartC = GeoEngine.badekas(cartR.X, cartR.Y, cartR.Z, true);
    const geoC = GeoEngine.cartToGeo(cartC.X, cartC.Y, cartC.Z, HAYFORD);
    const utmC = GeoEngine.geoToUTM(geoC.lat, geoC.lng, huso, HAYFORD);
    canoaEste = utmC.este;
    canoaNorte = utmC.norte;
  }

  return {
    regvenEste: regven.este,
    regvenNorte: regven.norte,
    canoaEste,
    canoaNorte,
  };
}

/** Proyecta puntos geográficos de la parcela al lienzo SVG 360x420 */
function projectVerticesToSvg(
  verts: Array<{ id: string; este: number; norte: number }>,
  rover?: { este: number; norte: number } | null
) {
  const allE = verts.map((v) => v.este);
  const allN = verts.map((v) => v.norte);
  if (rover) {
    allE.push(rover.este);
    allN.push(rover.norte);
  }
  const minE = Math.min(...allE);
  const maxE = Math.max(...allE);
  const minN = Math.min(...allN);
  const maxN = Math.max(...allN);
  const spanE = Math.max(maxE - minE, 20);
  const spanN = Math.max(maxN - minN, 20);
  const padX = 54;
  const padY = 66;
  const w = 360 - padX * 2;
  const h = 400 - padY * 2;
  const scale = Math.min(w / spanE, h / spanN);
  const offsetX = padX + (w - spanE * scale) / 2;
  const offsetY = padY + (h - spanN * scale) / 2;

  const project = (e: number, n: number) => ({
    sx: Math.round((offsetX + (e - minE) * scale) * 10) / 10,
    sy: Math.round((offsetY + (maxN - n) * scale) * 10) / 10,
  });

  return {
    vertices: verts.map((v) => ({ ...v, ...project(v.este, v.norte) })),
    roverSvg: rover ? project(rover.este, rover.norte) : null,
  };
}

export default function DashboardMobile({
  previewMode = false,
}: {
  previewMode?: boolean;
}) {
  const clearProjectWorkspace = useAppStore((s) => s.clearProjectWorkspace);
  const setUser = useAppStore((s) => s.setUser);
  const user = useAppStore((s) => s.user);
  const savedParcels = useAppStore((s) => s.savedParcels);
  const storeActiveParcelId = useAppStore((s) => s.activeParcelId);
  const projectMeta = useAppStore((s) => s.projectMeta);
  const setProjectMeta = useAppStore((s) => s.setProjectMeta);
  const setCurrentProjectId = useAppStore((s) => s.setCurrentProjectId);
  const importProject = useAppStore((s) => s.importProject);
  const setStoreResults = useAppStore((s) => s.setResults);
  const setStoreMethod = useAppStore((s) => s.setMethod);
  const setStoreDirection = useAppStore((s) => s.setDirection);
  const setStoreHuso = useAppStore((s) => s.setHuso);
  const setMapType = useAppStore((s) => s.setMapType);
  const centerOnAll = useAppStore((s) => s.centerOnAll);

  // Shell & Preview States
  const [activeTab, setActiveTab] = useState<AndroidNavTab>('map');
  const [parcelsSubTab, setParcelsSubTab] = useState<'parcels' | 'vertices'>('parcels');
  const [canvasEngine, setCanvasEngine] = useState<CanvasEngineMode>('stitch');
  const [layerMode, setLayerMode] = useState<MapLayerMode>('satellite');
  const [framePreview, setFramePreview] = useState<boolean>(previewMode);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // OTA Auto-Update APK States
  const installedVersionCode =
    typeof window !== 'undefined' && (window as any).__GEOGIS_APK_VERSION__?.versionCode
      ? Number((window as any).__GEOGIS_APK_VERSION__.versionCode)
      : 609;
  const installedVersionName =
    typeof window !== 'undefined' && (window as any).__GEOGIS_APK_VERSION__?.versionName
      ? String((window as any).__GEOGIS_APK_VERSION__.versionName)
      : '6.0.9';
  const [showOtaModal, setShowOtaModal] = useState(false);
  const [otaInfo, setOtaInfo] = useState({
    checking: false,
    hasUpdate: false,
    latestVersionCode: installedVersionCode,
    latestVersionName: installedVersionName,
    downloadUrl: 'https://github.com/akey01/GeoGis_Android/releases/latest/download/GeoGis6_Android.apk',
    notes: 'Versión oficial instalada y verificada.',
  });
  const lastSyncedParcelIdRef = useRef<string | null>(null);

  // Geodetic Config & Parcel State
  const [method, setMethod] = useState<EngineMethod>('rigida02');
  const [direction, setDirection] = useState<TransformDir>('canoa_regven');
  const [huso, setHuso] = useState<number>(19);
  const [parcelName, setParcelName] = useState<string>('PARCELA-09B');
  const [vertices, setVertices] = useState<FieldVertex[]>(DEFAULT_PARCEL_GEO);
  const [stakeTargetId, setStakeTargetId] = useState<string>('V-05');
  const [qaqcTimestamp, setQaqcTimestamp] = useState<string>('Validado ≤ 0.001 m');

  // Hardware GNSS / Mobile Topographer State
  const [gpsEnabled, setGpsEnabled] = useState<boolean>(true);
  const [gpsStatus, setGpsStatus] = useState<string>('Buscando señal GNSS...');
  const [gnss, setGnss] = useState<GnssSample>({
    lat: 11.94305,
    lng: -69.81868,
    alt: 11.8,
    accuracy: 3.2,
    speed: 0,
    heading: 18,
    timestamp: Date.now(),
    isLiveHardware: false,
  });
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [averagingActive, setAveragingActive] = useState<boolean>(false);
  const [averagingSamples, setAveragingSamples] = useState<
    Array<{ lat: number; lng: number; alt: number; este: number; norte: number }>
  >([]);

  // Parcel Coordinate Locator State
  const [locateMode, setLocateMode] = useState<LocateInputMode>('utm');
  const [locateDatum, setLocateDatum] = useState<LocateDatum>('canoa');
  const [locateHuso, setLocateHuso] = useState<number>(19);
  const [locateEste, setLocateEste] = useState<string>('409662.260');
  const [locateNorte, setLocateNorte] = useState<string>('1327653.220');
  const [locateZ, setLocateZ] = useState<string>('12.500');
  const [locateLat, setLocateLat] = useState<string>('11.943850');
  const [locateLng, setLocateLng] = useState<string>('-69.818450');
  const [locateBatch, setLocateBatch] = useState<string>(
    'B1,409662.260,1327653.220,12.4\nB2,409740.420,1327663.600,13.1\nB3,409775.240,1327612.140,14.0\nB4,409719.960,1327557.280,13.3'
  );

  // Session refs (only active when previewMode = false)
  const disconnectingRef = useRef(false);
  const meAbortRef = useRef<AbortController | null>(null);
  const lastUnloadBeaconRef = useRef<number>(0);
  const lastKnownUserIdRef = useRef<string>('');

  const canonicalRole = normalizeUserRole(user?.rol);
  const isDemo = isDemoRole(user?.rol);
  const roleInfo = ROLE_PERMISSIONS_MATRIX[canonicalRole];

  const forceDisconnect = useCallback(
    async (isSuspended = false, denyReason?: string) => {
      if (disconnectingRef.current || previewMode) return;
      disconnectingRef.current = true;
      if (meAbortRef.current) {
        meAbortRef.current.abort();
        meAbortRef.current = null;
      }
      const currentDeviceId = getOrCreateDeviceId();
      const currentUserId = useAppStore.getState().user?.id || lastKnownUserIdRef.current;
      try {
        clearProjectWorkspace();
        setUser(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('geotrans-offline-v1');
          localStorage.removeItem('transforven_project');
          localStorage.removeItem('gt_logged_in');
          localStorage.removeItem('gt_token');
          localStorage.removeItem('gt_current_user');
          sessionStorage.clear();
        }
        const q = `deviceId=${encodeURIComponent(currentDeviceId)}&userId=${encodeURIComponent(currentUserId || '')}`;
        await fetch(`/api/auth/logout?${q}`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'x-device-id': currentDeviceId,
          },
          body: JSON.stringify({ deviceId: currentDeviceId, userId: currentUserId }),
        }).catch(() => {});
      } finally {
        if (typeof window !== 'undefined') {
          if (isSuspended) {
            const reasonParam = denyReason ? `&reason=${encodeURIComponent(denyReason)}` : '';
            window.location.replace(`/login?suspended=1${reasonParam}`);
          } else {
            window.location.replace('/login?logout=1');
          }
        }
      }
    },
    [clearProjectWorkspace, previewMode, setUser]
  );

  useEffect(() => {
    installGlobalDeviceFetchInterceptor();
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('is-demo', isDemo);
    return () => {
      document.body.classList.remove('is-demo');
    };
  }, [isDemo]);

  // Session heartbeat (disabled during unauthenticated /preview-android)
  useEffect(() => {
    if (previewMode) return;
    let isMounted = true;
    let initialSynced = false;

    const sendDisconnectOnlySignal = () => {
      if (disconnectingRef.current) return;
      const now = Date.now();
      if (now - lastUnloadBeaconRef.current < 800) return;
      lastUnloadBeaconRef.current = now;
      try {
        const deviceId = getOrCreateDeviceId();
        const userId = useAppStore.getState().user?.id || lastKnownUserIdRef.current || '';
        if (!userId) return;
        const url = `/api/auth/logout?mode=disconnect_only&deviceId=${encodeURIComponent(deviceId)}&userId=${encodeURIComponent(userId)}`;
        const payload = JSON.stringify({ deviceId, userId });
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
        } else {
          void fetch(url, { method: 'POST', keepalive: true, body: payload }).catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    const verifySessionAndSync = async (isResume = false) => {
      if (!isMounted || disconnectingRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && initialSynced && !isResume) return;

      if (meAbortRef.current) meAbortRef.current.abort();
      const controller = new AbortController();
      meAbortRef.current = controller;

      try {
        const deviceId = getOrCreateDeviceId();
        const query = !initialSynced
          ? `/api/auth/me?includeProjects=1&t=${Date.now()}`
          : `/api/auth/me?t=${Date.now()}`;
        const res = await fetch(query, {
          cache: 'no-store',
          signal: controller.signal,
          headers: { Pragma: 'no-cache', 'x-device-id': deviceId },
        });
        const data = await res.json().catch(() => ({}));
        if (!isMounted || disconnectingRef.current || controller.signal.aborted) return;

        if (res.status === 401 || res.status === 403 || !data.success || !data.user || data.suspended || data.user.activo === false) {
          const suspended = Boolean(data?.suspended || res.status === 403 || data?.user?.activo === false);
          await forceDisconnect(suspended, data?.reason);
          return;
        }

        if (data.user.id) lastKnownUserIdRef.current = String(data.user.id);
        if (data.user.roleConfig) applyDynamicRoleConfig(data.user.rol, data.user.roleConfig);
        setUser(data.user);
        initialSynced = true;
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Session verify error:', err);
        }
      }
    };

    verifySessionAndSync(true);
    const intervalId = setInterval(() => verifySessionAndSync(false), 12000);
    const handleUnload = () => sendDisconnectOnlySignal();
    window.addEventListener('pagehide', handleUnload);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
      if (meAbortRef.current) meAbortRef.current.abort();
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [forceDisconnect, previewMode, setUser]);

  // Real Hardware GNSS Watch (navigator.geolocation.watchPosition)
  useEffect(() => {
    if (!gpsEnabled || typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('GPS simulado en modo banco de pruebas');
      return;
    }

    setGpsStatus('Enlazando hardware GNSS...');
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const detectedHuso = GeoEngine.detectHuso(c.longitude);
        setHuso((prev) => (prev >= 18 && prev <= 21 ? detectedHuso : prev));
        setGnss({
          lat: c.latitude,
          lng: c.longitude,
          alt: c.altitude ?? 0,
          accuracy: Math.round((c.accuracy || 5) * 100) / 100,
          speed: c.speed,
          heading: c.heading,
          timestamp: pos.timestamp,
          isLiveHardware: true,
        });
        setGpsStatus(`GNSS Hardware Activo (±${(c.accuracy || 5).toFixed(1)} m)`);
      },
      (err) => {
        setGpsStatus(`Sin fix de hardware (${err.message}). Modo demo activo.`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [gpsEnabled]);

  // Compass sensor listener
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOrientation = (ev: DeviceOrientationEvent) => {
      const webkitHeading = (ev as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof webkitHeading === 'number' && !Number.isNaN(webkitHeading)) {
        setCompassHeading(Math.round(webkitHeading * 10) / 10);
      } else if (typeof ev.alpha === 'number' && !Number.isNaN(ev.alpha)) {
        setCompassHeading(Math.round(((360 - ev.alpha) % 360) * 10) / 10);
      }
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, []);

  // Dual UTM + Projection Factors for live GNSS position
  const liveGnssUtm = useMemo(() => {
    const dual = computeDualUtmFromGeo(gnss.lat, gnss.lng, gnss.alt, huso, method);
    const factors = computeUtmProjectionFactors(gnss.lat, gnss.lng, dual.regvenEste, huso);
    return { ...dual, ...factors };
  }, [gnss.lat, gnss.lng, gnss.alt, huso, method]);

  // GNSS Epoch Averaging collector
  useEffect(() => {
    if (!averagingActive) return;
    const sample = {
      lat: gnss.lat,
      lng: gnss.lng,
      alt: gnss.alt,
      este: liveGnssUtm.regvenEste,
      norte: liveGnssUtm.regvenNorte,
    };
    setAveragingSamples((prev) => {
      if (prev.length >= 10) {
        setAveragingActive(false);
        return prev;
      }
      return [...prev, sample];
    });
  }, [averagingActive, gnss.timestamp, gnss.lat, gnss.lng, gnss.alt, liveGnssUtm.regvenEste, liveGnssUtm.regvenNorte]);

  // Transform all parcel vertices in active direction/method
  const computedVertices = useMemo(() => {
    const base = vertices.map((v) => {
      const dual = computeDualUtmFromGeo(v.lat, v.lng, v.z, huso, method);
      const activeEste = direction === 'canoa_regven' ? dual.regvenEste : dual.canoaEste;
      const activeNorte = direction === 'canoa_regven' ? dual.regvenNorte : dual.canoaNorte;
      return {
        ...v,
        regvenEste: dual.regvenEste,
        regvenNorte: dual.regvenNorte,
        canoaEste: dual.canoaEste,
        canoaNorte: dual.canoaNorte,
        este: activeEste,
        norte: activeNorte,
      };
    });

    return base.map((v, idx) => {
      const next = base[(idx + 1) % base.length];
      const dx = next.este - v.este;
      const dy = next.norte - v.norte;
      const { rumbo, azimutDeg } = formatRumboAzimut(dx, dy);
      return {
        ...v,
        rumbo,
        azimutDeg,
        dist: Math.hypot(dx, dy),
      };
    });
  }, [vertices, huso, method, direction]);

  const geom = useMemo(
    () => FileService.calculateGeometry(computedVertices.map((v) => ({ e: v.este, n: v.norte }))),
    [computedVertices]
  );

  const stakeTarget = useMemo(
    () => computedVertices.find((v) => v.id === stakeTargetId) || computedVertices[0],
    [computedVertices, stakeTargetId]
  );

  // Real-time Stakeout ("Drive Me") deltas from current Rover GNSS to Parcel Target Vertex
  const stakeoutMetrics = useMemo(() => {
    const roverE = direction === 'canoa_regven' ? liveGnssUtm.regvenEste : liveGnssUtm.canoaEste;
    const roverN = direction === 'canoa_regven' ? liveGnssUtm.regvenNorte : liveGnssUtm.canoaNorte;
    const dE = (stakeTarget?.este ?? roverE) - roverE;
    const dN = (stakeTarget?.norte ?? roverN) - roverN;
    const dZ = (stakeTarget?.z ?? gnss.alt) - gnss.alt;
    const distH = Math.hypot(dE, dN);
    const { rumbo, azimutDeg } = formatRumboAzimut(dE, dN);
    const relAngle = compassHeading !== null ? (azimutDeg - compassHeading + 360) % 360 : azimutDeg;
    return {
      roverE,
      roverN,
      dE,
      dN,
      dZ,
      distH,
      rumbo,
      azimutDeg,
      relAngle,
      inTolerance: distH <= 0.5,
    };
  }, [compassHeading, direction, gnss.alt, liveGnssUtm, stakeTarget]);

  const svgProjection = useMemo(() => {
    return projectVerticesToSvg(
      computedVertices.map((v) => ({ id: v.id, este: v.este, norte: v.norte })),
      { este: stakeoutMetrics.roverE, norte: stakeoutMetrics.roverN }
    );
  }, [computedVertices, stakeoutMetrics.roverE, stakeoutMetrics.roverN]);

  const storeResultsPayload = useMemo<TransformationResult[]>(
    () =>
      computedVertices.map((v) => ({
        id: v.id,
        ok: true,
        direction,
        input: {
          id: v.id,
          este: v.canoaEste,
          norte: v.canoaNorte,
          huso,
          alt: v.z,
          desc: v.source.toUpperCase(),
          parcel: parcelName,
        },
        result: {
          este: v.este,
          norte: v.norte,
          huso,
          cota: v.z,
          lat: v.lat,
          lng: v.lng,
          descripcion: parcelName,
        },
      })),
    [computedVertices, direction, huso, parcelName]
  );

  // Sync polygon with OpenLayers MapViewer store
  useEffect(() => {
    setStoreMethod(method);
    setStoreDirection(direction);
    setStoreHuso(huso);
    setStoreResults(storeResultsPayload);
  }, [method, direction, huso, storeResultsPayload, setStoreMethod, setStoreDirection, setStoreHuso, setStoreResults]);

  const averagingStats = useMemo(() => {
    if (averagingSamples.length === 0) return null;
    const n = averagingSamples.length;
    const avgLat = averagingSamples.reduce((acc, s) => acc + s.lat, 0) / n;
    const avgLng = averagingSamples.reduce((acc, s) => acc + s.lng, 0) / n;
    const avgAlt = averagingSamples.reduce((acc, s) => acc + s.alt, 0) / n;
    const avgE = averagingSamples.reduce((acc, s) => acc + s.este, 0) / n;
    const avgN = averagingSamples.reduce((acc, s) => acc + s.norte, 0) / n;
    const rmsE = Math.sqrt(averagingSamples.reduce((acc, s) => acc + (s.este - avgE) ** 2, 0) / n);
    const rmsN = Math.sqrt(averagingSamples.reduce((acc, s) => acc + (s.norte - avgN) ** 2, 0) / n);
    return {
      count: n,
      avgLat,
      avgLng,
      avgAlt,
      avgE,
      avgN,
      rmsTotal: Math.hypot(rmsE, rmsN),
    };
  }, [averagingSamples]);

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

  const handleCaptureGpsVertex = useCallback(() => {
    const id = `V-${String(vertices.length + 1).padStart(2, '0')}`;
    const lat = averagingStats ? averagingStats.avgLat : gnss.lat;
    const lng = averagingStats ? averagingStats.avgLng : gnss.lng;
    const z = Math.round((averagingStats ? averagingStats.avgAlt : gnss.alt) * 1000) / 1000;
    const rms = Math.round((averagingStats?.rmsTotal || gnss.accuracy) * 1000) / 1000;

    setVertices((prev) => [...prev, { id, lat, lng, z, rms, source: 'gps' }]);
    setStakeTargetId(id);
    setAveragingSamples([]);
    setAveragingActive(false);
    toast.success(`Vértice ${id} grabado (${gnss.isLiveHardware ? 'GNSS Real' : 'Banco'} ±${rms.toFixed(2)}m)`);
  }, [averagingStats, gnss.accuracy, gnss.alt, gnss.isLiveHardware, gnss.lat, gnss.lng, vertices.length]);

  const handleLocateCoordinate = useCallback(() => {
    if (locateMode === 'utm') {
      const e = parseFloat(locateEste);
      const n = parseFloat(locateNorte);
      const z = parseFloat(locateZ) || 0;
      if (!Number.isFinite(e) || !Number.isFinite(n)) {
        toast.error('Ingresa coordenadas Este (X) y Norte (Y) válidas.');
        return;
      }
      const el = locateDatum === 'canoa' ? HAYFORD : GRS80;
      let geo = GeoEngine.utmToGeo(e, n, locateHuso, false, el);
      if (locateDatum === 'canoa') {
        const reg = GeoEngine.transformRigida02(
          [{ id: 'LOC', este_origen: e, norte_origen: n, cota_origen: z }]
        ).resultados[0];
        geo = GeoEngine.utmToGeo(reg.este_regven, reg.norte_regven, locateHuso, false, GRS80);
      }
      const newId = `L-${String(vertices.length + 1).padStart(2, '0')}`;
      setHuso(locateHuso);
      setVertices((prev) => [...prev, { id: newId, lat: geo.lat, lng: geo.lng, z, rms: 0.005, source: 'located' }]);
      setStakeTargetId(newId);
      setActiveTab('map');
      setTimeout(() => centerOnAll(), 120);
      toast.success(`Coordenada localizada (${newId}) y fijada como objetivo`);
      return;
    }

    if (locateMode === 'geo') {
      const lat = parseFloat(locateLat);
      const lng = parseFloat(locateLng);
      const z = parseFloat(locateZ) || 0;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        toast.error('Ingresa Latitud y Longitud válidas en grados decimales.');
        return;
      }
      const newId = `L-${String(vertices.length + 1).padStart(2, '0')}`;
      setHuso(GeoEngine.detectHuso(lng));
      setVertices((prev) => [...prev, { id: newId, lat, lng, z, rms: 0.005, source: 'located' }]);
      setStakeTargetId(newId);
      setActiveTab('map');
      setTimeout(() => centerOnAll(), 120);
      toast.success(`Punto ${newId} localizado en mapa`);
      return;
    }

    // Batch parcel import (ID,Este,Norte,Z)
    const lines = locateBatch
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsedVerts: FieldVertex[] = [];
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/[,\t;\s]+/).filter(Boolean);
      if (parts.length < 2) continue;
      const hasLabel = Number.isNaN(Number(parts[0]));
      const id = hasLabel ? parts[0] : `P-${String(i + 1).padStart(2, '0')}`;
      const e = Number(hasLabel ? parts[1] : parts[0]);
      const n = Number(hasLabel ? parts[2] : parts[1]);
      const z = Number(hasLabel ? parts[3] : parts[2]) || 0;
      if (!Number.isFinite(e) || !Number.isFinite(n)) continue;
      let geo = GeoEngine.utmToGeo(e, n, locateHuso, false, GRS80);
      if (locateDatum === 'canoa') {
        const reg = GeoEngine.transformRigida02([{ id, este_origen: e, norte_origen: n, cota_origen: z }]).resultados[0];
        geo = GeoEngine.utmToGeo(reg.este_regven, reg.norte_regven, locateHuso, false, GRS80);
      }
      parsedVerts.push({ id, lat: geo.lat, lng: geo.lng, z, rms: 0.005, source: 'located' });
    }
    if (parsedVerts.length < 2) {
      toast.error('Pega al menos 2 vértices válidos (ID,Este,Norte,Z).');
      return;
    }
    setParcelName('PARCELA_LOCALIZADA');
    setHuso(locateHuso);
    setVertices(parsedVerts);
    setStakeTargetId(parsedVerts[0].id);
    setActiveTab('map');
    setTimeout(() => centerOnAll(), 150);
    toast.success(`Parcela trazada con ${parsedVerts.length} vértices y replanteo listo`);
  }, [
    centerOnAll,
    locateBatch,
    locateDatum,
    locateEste,
    locateHuso,
    locateLat,
    locateLng,
    locateMode,
    locateNorte,
    locateZ,
    vertices.length,
  ]);

  const handleCopyCivilCad = useCallback(async () => {
    const txt = computedVertices
      .map((v) => `${v.id},${v.este.toFixed(3)},${v.norte.toFixed(3)},${v.z.toFixed(3)},${parcelName}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      toast.success('Coordenadas P,E,N,Z,D copiadas');
    } catch {
      toast.success('Lista CivilCAD preparada');
    }
  }, [computedVertices, parcelName]);

  const handleExportDxf = useCallback(() => {
    if (!previewMode && !hasPermission(user?.rol, 'export_dxf', user?.roleConfig?.capabilities)) {
      toast.error('Su rol no tiene permiso para exportar DXF.');
      return;
    }
    exportResultsToDXF(storeResultsPayload, parcelName);
  }, [parcelName, previewMode, storeResultsPayload, user?.rol, user?.roleConfig?.capabilities]);

  const handleExportKml = useCallback(() => {
    FileService.exportKML(storeResultsPayload, parcelName);
    toast.success('Archivo .KML descargado');
  }, [parcelName, storeResultsPayload]);

  const handleVerifyQaqc = useCallback(() => {
    try {
      const check = GeoEngine.transformRigida02(
        computedVertices.map((v) => ({
          id: v.id,
          norte_origen: v.canoaNorte,
          este_origen: v.canoaEste,
          cota_origen: v.z,
        }))
      );
      if (check.qaqcPasado) {
        setQaqcTimestamp(`Aprobado ${new Date().toLocaleTimeString()}`);
        toast.success('QA/QC IGVSB Aprobado · Invarianza ≤ 0.001 m');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error en auditoría QA/QC');
    }
  }, [computedVertices]);

  // Sync mobile map polygon when user picks a parcel inside <ParcelList />
  useEffect(() => {
    if (!storeActiveParcelId || storeActiveParcelId === lastSyncedParcelIdRef.current) return;
    const found = savedParcels.find((p) => p.id === storeActiveParcelId);
    if (!found || !Array.isArray(found.puntos) || found.puntos.length === 0) return;

    const extracted: FieldVertex[] = found.puntos
      .map((pt, idx) => {
        const lat = Number(pt.result?.lat ?? pt.input?.lat);
        const lng = Number(pt.result?.lng ?? pt.input?.lng);
        const z = Number(pt.result?.cota ?? pt.input?.alt ?? 0) || 0;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { id: pt.id || `P${idx + 1}`, lat, lng, z, rms: 0.008, source: 'sample' as const };
        }
        const e = Number(pt.result?.este ?? pt.input?.este);
        const n = Number(pt.result?.norte ?? pt.input?.norte);
        if (Number.isFinite(e) && Number.isFinite(n)) {
          const g = GeoEngine.utmToGeo(e, n, Number(pt.result?.huso || pt.input?.huso || huso), false, GRS80);
          return { id: pt.id || `P${idx + 1}`, lat: g.lat, lng: g.lng, z, rms: 0.01, source: 'sample' as const };
        }
        return null;
      })
      .filter(Boolean) as FieldVertex[];

    if (extracted.length > 0) {
      lastSyncedParcelIdRef.current = found.id;
      setVertices(extracted);
      setParcelName(found.nombre || 'PARCELA');
      setStakeTargetId(extracted[0].id);
      if (found.method === 'rigida02' || found.method === 'badekas' || found.method === 'rigida') {
        setMethod(found.method);
      }
      setActiveTab('map');
      setTimeout(() => centerOnAll(), 120);
    }
  }, [storeActiveParcelId, savedParcels, huso, centerOnAll]);

  const handleSaveActiveToParcelList = useCallback(
    (forceNew = false) => {
      const cleanName = (parcelName || 'PARCELA').trim() || 'PARCELA';
      const existing = !forceNew && storeActiveParcelId
        ? savedParcels.find((p) => p.id === storeActiveParcelId)
        : null;

      if (existing) {
        const updatedList = savedParcels.map((p) =>
          p.id === existing.id
            ? {
                ...p,
                nombre: cleanName,
                area: geom.area,
                perim: geom.perim,
                ha: geom.area / 10000,
                puntos: storeResultsPayload,
                method,
                actualizado: new Date().toISOString(),
              }
            : p
        );
        lastSyncedParcelIdRef.current = existing.id;
        useAppStore.setState({ savedParcels: updatedList, activeParcelId: existing.id });
        toast.success(`Parcela "${cleanName}" actualizada en proyecto`);
      } else {
        const newId = `POL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const newParcel: Parcel = {
          id: newId,
          nombre: forceNew ? `${cleanName}-${savedParcels.length + 1}` : cleanName,
          fecha: new Date().toLocaleDateString('es-VE'),
          area: geom.area,
          perim: geom.perim,
          ha: geom.area / 10000,
          puntos: storeResultsPayload,
          geometryType: 'cerrada',
          method,
          hatchColor: '#4cd7f6',
          hatchOpacity: 0.22,
          actualizado: new Date().toISOString(),
        };
        lastSyncedParcelIdRef.current = newId;
        useAppStore.setState({
          savedParcels: [newParcel, ...savedParcels],
          activeParcelId: newId,
        });
        setParcelName(newParcel.nombre);
        toast.success(`Parcela "${newParcel.nombre}" guardada en proyecto`);
      }
    },
    [geom.area, geom.perim, method, parcelName, savedParcels, storeActiveParcelId, storeResultsPayload]
  );

  const checkApkUpdates = useCallback(
    async (manual = false) => {
      setOtaInfo((prev) => ({ ...prev, checking: true }));
      let bestCode = installedVersionCode;
      let bestName = installedVersionName;
      let bestUrl = 'https://github.com/akey01/GeoGis_Android/releases/latest/download/GeoGis6_Android.apk';
      let bestNotes = 'Última versión oficial instalada.';

      try {
        const [apiRes, ghRes] = await Promise.allSettled([
          fetch(`/api/apk-version?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
          fetch('https://api.github.com/repos/akey01/GeoGis_Android/releases/latest', {
            headers: { Accept: 'application/vnd.github+json' },
            cache: 'no-store',
          }).then((r) => (r.ok ? r.json() : null)),
        ]);

        if (apiRes.status === 'fulfilled' && apiRes.value && Number(apiRes.value.versionCode) > bestCode) {
          bestCode = Number(apiRes.value.versionCode);
          bestName = apiRes.value.versionName || bestName;
          bestUrl = apiRes.value.downloadUrl || bestUrl;
          bestNotes = apiRes.value.notes || bestNotes;
        }
        if (ghRes.status === 'fulfilled' && ghRes.value) {
          const body = String(ghRes.value.body || '');
          const mCode = body.match(/\[APK_VERSION_CODE=(\d+)\]/i);
          const mName = body.match(/\[APK_VERSION_NAME=([^\]]+)\]/i);
          const apkAsset = Array.isArray(ghRes.value.assets)
            ? ghRes.value.assets.find((a: any) => String(a.name || '').endsWith('.apk'))
            : null;
          if (mCode && Number(mCode[1]) > bestCode) {
            bestCode = Number(mCode[1]);
            bestName = mName ? mName[1].trim() : bestName;
            bestUrl = apkAsset?.browser_download_url || bestUrl;
            bestNotes = body.replace(/\[APK_VERSION_[^\]]+\]/g, '').trim() || bestNotes;
          }
        }
      } catch {
        // ignore network issues offline
      }

      const hasUpdate = bestCode > installedVersionCode;
      setOtaInfo({
        checking: false,
        hasUpdate,
        latestVersionCode: bestCode,
        latestVersionName: bestName,
        downloadUrl: bestUrl,
        notes: bestNotes,
      });

      if (hasUpdate || manual) {
        if (hasUpdate) setShowOtaModal(true);
        else toast.success(`APK v${installedVersionName} al día`);
      }
    },
    [installedVersionCode, installedVersionName]
  );

  useEffect(() => {
    void checkApkUpdates(false);
  }, [checkApkUpdates]);

  const handleApkLoginSubmit = useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      setLoginLoading(true);
      setLoginError(null);
      try {
        const deviceId = getOrCreateDeviceId();
        const res = await fetch('/api/auth/apk-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
          body: JSON.stringify({
            email: loginEmail.trim(),
            password: loginPassword,
            deviceId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !data.user) {
          throw new Error(data.error || 'Credenciales inválidas');
        }
        if (data.token && typeof window !== 'undefined') {
          localStorage.setItem('gt_token', data.token);
          localStorage.setItem('gt_current_user', JSON.stringify(data.user));
        }
        setUser(data.user);
        setShowLoginModal(false);
        setLoginPassword('');
        toast.success(`Bienvenido ${data.user.nombre || data.user.username}`);
      } catch (err: any) {
        setLoginError(err?.message || 'Error de inicio de sesión');
      } finally {
        setLoginLoading(false);
      }
    },
    [loginEmail, loginPassword, setUser]
  );

  const shellClass = framePreview
    ? 'w-full sm:w-[400px] h-full min-h-0 sm:h-[836px] sm:rounded-[34px] sm:border-[6px] sm:border-[#1e293b] sm:ring-1 sm:ring-[#4cd7f6]/25'
    : 'w-full h-full min-h-0';

  return (
    <div
      className={cn(
        'fixed inset-0 w-full h-full bg-[#050914] text-[#dae2fd] flex flex-col items-center overflow-hidden pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]',
        framePreview && 'sm:static sm:min-h-[100dvh] sm:justify-center sm:py-3 sm:px-3 sm:pt-3 sm:pb-3'
      )}
    >
      {/* Optional Desktop Preview Switch Strip (visible only in /preview-android on larger screens) */}
      {previewMode && (
        <div className="hidden sm:flex w-full max-w-[960px] mb-2.5 px-3 py-1.5 bg-[#0b1326] border border-[#222a3d] rounded-xl items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-[#4cd7f6]/15 border border-[#4cd7f6]/30 font-mono text-[10px] font-bold text-[#4cd7f6]">
              GEOGIS6 ANDROID UI
            </span>
            <span className="text-xs text-[#bcc9cd]">
              Stitch Fidelity Dark + Mobile Topographer GNSS + Localizador de Parcelas
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFramePreview((f) => !f)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#171f33] border border-[#2d3449] font-mono text-[11px] text-[#4cd7f6]"
          >
            {framePreview ? <Maximize2 className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
            <span>{framePreview ? 'Pantalla Completa' : 'Marco Celular'}</span>
          </button>
        </div>
      )}

      {/* Main Mobile Application Viewport */}
      <div className={cn('relative bg-[#0b1326] text-[#dae2fd] flex flex-col overflow-hidden select-none shadow-2xl', shellClass)}>
        {/* 1. COMPACT TACTICAL ANDROID HEADER */}
        <header className="shrink-0 bg-[#0b1326]/95 backdrop-blur-xl border-b border-[#222a3d] z-40">
          <div className="h-12 px-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded border shrink-0',
                  gnss.isLiveHardware
                    ? 'bg-[#4edea3]/15 border-[#4edea3]/40 text-[#4edea3]'
                    : 'bg-[#ffb95f]/15 border-[#ffb95f]/40 text-[#ffb95f]'
                )}
              >
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full animate-pulse',
                    gnss.isLiveHardware ? 'bg-[#4edea3]' : 'bg-[#ffb95f]'
                  )}
                />
                <span className="font-mono text-[9px] font-bold uppercase">
                  {gnss.isLiveHardware ? `GPS ±${gnss.accuracy.toFixed(1)}m` : 'DEMO RTK'}
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#dae2fd] truncate leading-tight">
                  {parcelName}
                </div>
                <div className="font-mono text-[9px] text-[#869397] truncate">
                  {geom.area.toFixed(1)} m² · {computedVertices.length} pts · {savedParcels.length} parc
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowOtaModal(true);
                  void checkApkUpdates(false);
                }}
                className={cn(
                  'px-1.5 py-1 rounded-lg border font-mono text-[8.5px] font-bold active:scale-95',
                  otaInfo.hasUpdate
                    ? 'bg-[#4edea3]/20 border-[#4edea3]/60 text-[#4edea3] animate-pulse'
                    : 'bg-[#171f33] border-[#2d3449] text-[#bcc9cd]'
                )}
                title="Versión y Actualizaciones APK"
              >
                {otaInfo.hasUpdate ? `⬆ v${otaInfo.latestVersionName}` : `v${installedVersionName}`}
              </button>

              <button
                type="button"
                onClick={() =>
                  setDirection((d) => (d === 'canoa_regven' ? 'regven_canoa' : 'canoa_regven'))
                }
                className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-[#171f33] border border-[#2d3449] active:scale-95"
              >
                <ArrowLeftRight className="w-3 h-3 text-[#ffb95f]" />
                <span className="font-mono text-[8.5px] font-bold text-[#4cd7f6]">
                  {direction === 'canoa_regven' ? 'PSAD56➔REG' : 'REG➔PSAD56'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (user) setShowUserMenu((v) => !v);
                  else setShowLoginModal(true);
                }}
                className={cn(
                  'h-7 px-2 rounded-lg border flex items-center gap-1 font-mono text-[8.5px] font-bold',
                  user
                    ? 'bg-[#4edea3]/15 border-[#4edea3]/40 text-[#4edea3]'
                    : 'bg-[#171f33] border-[#ffb95f]/40 text-[#ffb95f]'
                )}
                title={user ? 'Cuenta GeoGIS6' : 'Iniciar Sesión Cloud'}
              >
                {user ? <User className="w-3.5 h-3.5" /> : <LogIn className="w-3.5 h-3.5" />}
                <span className="max-w-[56px] truncate">
                  {user ? (user.nombre || user.username).split(' ')[0] : 'Login'}
                </span>
              </button>
            </div>
          </div>

          {/* Sub-Header GNSS Telemetry Strip */}
          <div className="px-3 py-1.5 bg-[#060e20] border-t border-[#171f33] flex items-center justify-between gap-1 font-mono text-[9px]">
            <span className="px-1.5 py-0.5 rounded bg-[#171f33] text-[#4edea3] font-bold shrink-0">
              {method === 'rigida02' ? 'RIGIDA02' : method === 'badekas' ? 'BADEKAS' : 'IDW'} • {huso}N
            </span>
            <span className="text-[#bcc9cd] truncate max-w-[120px]">
              📁 {projectMeta?.nombre || 'Nuevo Proyecto'}
            </span>
            <button
              type="button"
              onClick={() => setCanvasEngine((c) => (c === 'stitch' ? 'openlayers' : 'stitch'))}
              className="px-2 py-0.5 rounded bg-[#4cd7f6]/15 text-[#4cd7f6] font-bold shrink-0"
            >
              {canvasEngine === 'stitch' ? 'Satélite OL' : 'Vector HUD'}
            </button>
            <button
              type="button"
              onClick={handleCycleLayer}
              className="px-1.5 py-0.5 rounded bg-[#222a3d] text-[#ffb95f] font-bold shrink-0"
            >
              {LAYER_LABELS[layerMode]}
            </button>
          </div>

          {showUserMenu && user && (
            <div className="absolute right-3 top-12 w-56 bg-[#131b2e] border border-[#2d3449] rounded-xl shadow-2xl z-50 overflow-hidden">
              <div className="p-2.5 border-b border-[#222a3d]">
                <div className="text-xs font-bold text-white truncate">{user?.nombre || 'Operador Campo'}</div>
                <div className="text-[10px] font-mono text-[#4edea3]">{roleInfo?.label}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  setShowProfile(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[#171f33]"
              >
                <UserCircle className="w-4 h-4 text-[#4cd7f6]" /> Perfil y Cuenta
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  setActiveTab('projects');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[#171f33]"
              >
                <FolderKanban className="w-4 h-4 text-[#4edea3]" /> Proyectos Cloud
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  setShowOtaModal(true);
                  void checkApkUpdates(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[#171f33]"
              >
                <RefreshCw className="w-4 h-4 text-[#ffb95f]" /> Actualizaciones APK
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  if (previewMode) {
                    setUser(null);
                    toast.success('Sesión cerrada');
                  } else {
                    void forceDisconnect(false);
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10"
              >
                <LogOut className="w-4 h-4" /> Cerrar Sesión
              </button>
            </div>
          )}
        </header>

        {showProfile && <ProfileModalLazy open={showProfile} onClose={() => setShowProfile(false)} />}

        {/* 2. ACTIVE TAB VIEWPORT */}
        <main className="relative flex-1 min-h-0 overflow-hidden bg-[#060e20]">
          {/* TAB 1: MAPA HUD */}
          {activeTab === 'map' && (
            <div className="relative w-full h-full">
              {canvasEngine === 'openlayers' ? (
                <MapViewer className="w-full h-full" />
              ) : (
                <div className="relative w-full h-full overflow-hidden">
                  <div
                    className={cn(
                      'absolute inset-0',
                      layerMode === 'satellite' && 'bg-[radial-gradient(circle_at_30%_25%,#1b3a2e_0%,#091c26_48%,#060e20_100%)]',
                      layerMode === 'hybrid' && 'bg-[radial-gradient(circle_at_60%_30%,#143040_0%,#0b1326_65%,#060e20_100%)]',
                      layerMode === 'dtm' && 'bg-[radial-gradient(circle_at_45%_45%,#2c1f10_0%,#131b2e_55%,#060e20_100%)]',
                      layerMode === 'catastro' && 'bg-[#060e20]'
                    )}
                  />

                  <svg viewBox="0 0 360 400" preserveAspectRatio="xMidYMid meet" className="w-full h-full">
                    <defs>
                      <pattern id="grid-mobile" width="48" height="48" patternUnits="userSpaceOnUse">
                        <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#3d494c" strokeOpacity="0.32" strokeDasharray="3 3" strokeWidth="0.7" />
                        <circle cx="0" cy="0" r="1.2" fill="#4cd7f6" fillOpacity="0.45" />
                      </pattern>
                    </defs>
                    <rect width="360" height="400" fill="url(#grid-mobile)" />

                    {/* Parcel Polygon */}
                    <polygon
                      points={svgProjection.vertices.map((v) => `${v.sx},${v.sy}`).join(' ')}
                      fill="rgba(76,215,246,0.14)"
                      stroke="#4cd7f6"
                      strokeWidth="2.4"
                      strokeLinejoin="round"
                    />

                    {/* Live Stakeout Vector (GPS Rover -> Target Vertex) */}
                    {svgProjection.roverSvg && (() => {
                      const targetSvg =
                        svgProjection.vertices.find((v) => v.id === stakeTarget?.id) ||
                        svgProjection.vertices[0];
                      if (!targetSvg) return null;
                      return (
                        <line
                          x1={svgProjection.roverSvg.sx}
                          y1={svgProjection.roverSvg.sy}
                          x2={targetSvg.sx}
                          y2={targetSvg.sy}
                          stroke="#ffb95f"
                          strokeWidth="1.6"
                          strokeDasharray="5 3"
                        />
                      );
                    })()}

                    {/* Parcel Vertices */}
                    {svgProjection.vertices.map((v) => {
                      const isTarget = v.id === stakeTarget?.id;
                      return (
                        <g
                          key={v.id}
                          onClick={() => setStakeTargetId(v.id)}
                          className="cursor-pointer"
                        >
                          <circle
                            cx={v.sx}
                            cy={v.sy}
                            r={isTarget ? 10 : 6}
                            fill={isTarget ? '#ffb95f' : '#4cd7f6'}
                            fillOpacity="0.25"
                          />
                          <circle
                            cx={v.sx}
                            cy={v.sy}
                            r="4.5"
                            fill="#0b1326"
                            stroke={isTarget ? '#ffb95f' : '#4cd7f6'}
                            strokeWidth="2"
                          />
                          <rect x={v.sx + 6} y={v.sy - 11} width="32" height="14" rx="3" fill={isTarget ? '#ffb95f' : '#171f33'} />
                          <text
                            x={v.sx + 9}
                            y={v.sy - 1}
                            fill={isTarget ? '#2a1700' : '#4cd7f6'}
                            fontSize="8.5"
                            fontWeight="700"
                            fontFamily="monospace"
                          >
                            {v.id}
                          </text>
                        </g>
                      );
                    })}

                    {/* Live Hardware GNSS Rover Marker */}
                    {svgProjection.roverSvg && (
                      <g>
                        <circle
                          cx={svgProjection.roverSvg.sx}
                          cy={svgProjection.roverSvg.sy}
                          r="17"
                          fill="#4edea3"
                          fillOpacity="0.18"
                        />
                        <circle
                          cx={svgProjection.roverSvg.sx}
                          cy={svgProjection.roverSvg.sy}
                          r="6"
                          fill="#4edea3"
                          stroke="#060e20"
                          strokeWidth="2"
                        />
                      </g>
                    )}
                  </svg>
                </div>
              )}

              {/* Top-Left Summary & Live Stakeout Mini Banner */}
              <div className="absolute top-2.5 left-2.5 right-16 flex flex-col gap-1.5 pointer-events-none">
                <div className="inline-flex flex-wrap items-center gap-2 self-start px-2.5 py-1.5 rounded-xl bg-[#131b2e]/90 border border-[#4cd7f6]/25 backdrop-blur-md">
                  <span className="font-mono text-[10px] font-bold text-[#4edea3]">
                    {geom.area.toFixed(1)} m² ({(geom.area / 10000).toFixed(4)} ha)
                  </span>
                  <span className="font-mono text-[9px] text-[#bcc9cd]">
                    Per: {geom.perim.toFixed(2)} m
                  </span>
                </div>

                {stakeTarget && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('locate')}
                    className="pointer-events-auto self-start px-2.5 py-1.5 rounded-xl bg-[#171f33]/92 border border-[#ffb95f]/40 backdrop-blur-md flex items-center gap-2 text-left"
                  >
                    <Target className="w-3.5 h-3.5 text-[#ffb95f] shrink-0" />
                    <div className="font-mono text-[10px] leading-tight">
                      <span className="text-[#ffb95f] font-bold">
                        OBJ {stakeTarget.id}: {stakeoutMetrics.distH.toFixed(2)} m
                      </span>
                      <span className="text-[#bcc9cd] block text-[9px]">
                        {stakeoutMetrics.rumbo}
                      </span>
                    </div>
                  </button>
                )}
              </div>

              {/* Ergonomic Right Thumb FAB Stack */}
              <div className="absolute top-10 right-2.5 z-20 flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCaptureGpsVertex}
                  className="w-13 h-13 p-2 rounded-full bg-[#4cd7f6] hover:bg-[#acedff] active:scale-95 text-[#003640] shadow-xl flex flex-col items-center justify-center"
                >
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                  <span className="font-mono text-[8px] font-extrabold uppercase leading-none">GRABAR</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveActiveToParcelList(false)}
                  className="w-10 h-10 rounded-full bg-[#4edea3] text-[#003824] flex items-center justify-center shadow-lg"
                  title="Guardar Parcela en Proyecto"
                >
                  <Save className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGpsEnabled(true);
                    centerOnAll();
                    toast.success('GPS en tiempo real centrado');
                  }}
                  className="w-10 h-10 rounded-full bg-[#171f33]/95 border border-[#2d3449] text-[#4edea3] flex items-center justify-center shadow-lg"
                  title="Centrar GPS Real"
                >
                  <Crosshair className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('locate')}
                  className="w-10 h-10 rounded-full bg-[#171f33]/95 border border-[#ffb95f]/40 text-[#ffb95f] flex items-center justify-center shadow-lg"
                  title="Localizar Parcela / Replanteo"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleCycleLayer}
                  className="w-10 h-10 rounded-full bg-[#171f33]/95 border border-[#2d3449] text-[#dae2fd] flex items-center justify-center shadow-lg"
                  title="Cambiar Capa"
                >
                  <Layers className="w-4 h-4" />
                </button>
              </div>

              {/* Compact Bottom Live GNSS Telemetry Strip */}
              <div className="absolute inset-x-2.5 bottom-2.5 p-2.5 rounded-2xl bg-[#131b2e]/95 border border-[#2d3449] backdrop-blur-xl shadow-2xl">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-[#4edea3]" />
                    <span className="font-mono text-[10px] font-bold text-[#4cd7f6]">
                      POSICIÓN ROVER EN TIEMPO REAL
                    </span>
                  </div>
                  <span className="font-mono text-[9px] text-[#4edea3]">
                    ±{gnss.accuracy.toFixed(1)} m
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 bg-[#060e20] p-2 rounded-xl font-mono text-[10px] tabular-nums">
                  <div>
                    <span className="text-[8px] text-[#869397] block">ESTE REGVEN</span>
                    <span className="text-[#dae2fd] font-bold">{liveGnssUtm.regvenEste.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#869397] block">NORTE REGVEN</span>
                    <span className="text-[#dae2fd] font-bold">{liveGnssUtm.regvenNorte.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#869397] block">ALT / CANOA</span>
                    <span className="text-[#ffb95f] font-bold">{gnss.alt.toFixed(2)} m</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MOBILE TOPOGRAPHER (GNSS + 3 DATUMS + AVERAGING + SKYPLOT) */}
          {activeTab === 'topographer' && (
            <div className="h-full overflow-y-auto p-3 space-y-3">
              <div className="p-3 rounded-2xl bg-[#131b2e] border border-[#222a3d] flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Radio className="w-4 h-4 text-[#4edea3]" />
                    Mobile Topographer GNSS
                  </div>
                  <div className="font-mono text-[10px] text-[#bcc9cd] mt-0.5">{gpsStatus}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setGpsEnabled((g) => !g)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg font-mono text-[10px] font-bold',
                    gpsEnabled ? 'bg-[#4edea3] text-[#003824]' : 'bg-[#222a3d] text-[#bcc9cd]'
                  )}
                >
                  {gpsEnabled ? 'GPS ON' : 'GPS OFF'}
                </button>
              </div>

              {/* Triple Coordinate Frame */}
              <div className="p-3 rounded-2xl bg-[#171f33] border border-[#222a3d] space-y-2.5 font-mono">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-[#4cd7f6] font-bold">1. WGS84 / SIRGAS GEOGRÁFICAS</span>
                  <span className="text-[#4edea3]">Acc ±{gnss.accuracy.toFixed(2)}m</span>
                </div>
                <div className="grid grid-cols-2 gap-2 bg-[#060e20] p-2 rounded-xl text-[11px] tabular-nums">
                  <div>
                    <span className="text-[8px] text-[#869397] block">LATITUD</span>
                    <span className="text-white font-bold block">{gnss.lat.toFixed(7)}°</span>
                    <span className="text-[9px] text-[#4cd7f6]">{formatDms(gnss.lat, true)}</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#869397] block">LONGITUD</span>
                    <span className="text-white font-bold block">{gnss.lng.toFixed(7)}°</span>
                    <span className="text-[9px] text-[#4cd7f6]">{formatDms(gnss.lng, false)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] pt-1">
                  <span className="text-[#4edea3] font-bold">2. UTM REGVEN (GRS80 · HUSO {huso}N)</span>
                  <span className="text-[#bcc9cd]">k={liveGnssUtm.k.toFixed(6)}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 bg-[#060e20] p-2 rounded-xl text-[11px] tabular-nums">
                  <div>
                    <span className="text-[8px] text-[#869397] block">ESTE (X)</span>
                    <span className="font-bold text-white">{liveGnssUtm.regvenEste.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#869397] block">NORTE (Y)</span>
                    <span className="font-bold text-white">{liveGnssUtm.regvenNorte.toFixed(3)}</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#869397] block">CONVERG. γ</span>
                    <span className="font-bold text-[#ffb95f]">{liveGnssUtm.convergenceDeg.toFixed(3)}°</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] pt-1">
                  <span className="text-[#ffb95f] font-bold">3. UTM PSAD56 LA CANOA ({method.toUpperCase()})</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 bg-[#060e20] p-2 rounded-xl text-[11px] tabular-nums">
                  <div>
                    <span className="text-[8px] text-[#869397] block">ESTE CANOA</span>
                    <span className="font-bold text-[#ffb95f]">{liveGnssUtm.canoaEste.toFixed(3)} m</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#869397] block">NORTE CANOA</span>
                    <span className="font-bold text-[#ffb95f]">{liveGnssUtm.canoaNorte.toFixed(3)} m</span>
                  </div>
                </div>
              </div>

              {/* Epoch Averaging (Promediado GNSS) */}
              <div className="p-3 rounded-2xl bg-[#171f33] border border-[#4cd7f6]/25 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold text-[#4cd7f6] uppercase">
                    Promediado de Épocas GNSS (Point Averaging)
                  </span>
                  <span className="font-mono text-[10px] text-[#4edea3]">
                    {averagingSamples.length}/10 muestras
                  </span>
                </div>
                {averagingStats && (
                  <div className="grid grid-cols-3 gap-1.5 bg-[#060e20] p-2 rounded-xl font-mono text-[10px] tabular-nums">
                    <div>
                      <span className="text-[8px] text-[#869397] block">E PROM</span>
                      <span className="text-white font-bold">{averagingStats.avgE.toFixed(3)}</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-[#869397] block">N PROM</span>
                      <span className="text-white font-bold">{averagingStats.avgN.toFixed(3)}</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-[#869397] block">RMS</span>
                      <span className="text-[#4edea3] font-bold">±{averagingStats.rmsTotal.toFixed(3)}m</span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (averagingActive) {
                        setAveragingActive(false);
                      } else {
                        setAveragingSamples([]);
                        setAveragingActive(true);
                      }
                    }}
                    className={cn(
                      'py-2 rounded-xl font-bold text-[11px]',
                      averagingActive
                        ? 'bg-[#ffb95f] text-[#2a1700]'
                        : 'bg-[#222a3d] text-[#4cd7f6]'
                    )}
                  >
                    {averagingActive ? 'Detener Promedio' : 'Iniciar Promedio (10x)'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCaptureGpsVertex}
                    className="py-2 rounded-xl bg-[#4edea3] text-[#003824] font-bold text-[11px]"
                  >
                    + Grabar Vértice GPS
                  </button>
                </div>
              </div>

              {/* Skyplot Radar + SNR Bars */}
              <div className="p-3 rounded-2xl bg-[#171f33] border border-[#222a3d] space-y-2">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-[#4cd7f6] font-bold">SKYPLOT &amp; SNR (dB-Hz)</span>
                  <span className="text-[#bcc9cd]">PDOP 0.82 · HDOP 0.54</span>
                </div>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5 flex justify-center">
                    <svg viewBox="0 0 120 120" className="w-28 h-28">
                      <circle cx="60" cy="60" r="52" fill="#060e20" stroke="#3d494c" strokeWidth="1" />
                      <circle cx="60" cy="60" r="34" fill="none" stroke="#2d3449" strokeDasharray="2 2" />
                      <circle cx="60" cy="60" r="17" fill="none" stroke="#2d3449" strokeDasharray="2 2" />
                      <line x1="60" y1="8" x2="60" y2="112" stroke="#2d3449" />
                      <line x1="8" y1="60" x2="112" y2="60" stroke="#2d3449" />
                      <text x="57" y="14" fill="#ffb95f" fontSize="8" fontFamily="monospace">N</text>
                      {CONSTELLATION_SATS.map((s) => {
                        const r = ((90 - s.el) / 90) * 50;
                        const rad = GeoEngine.toRad(s.az);
                        const x = 60 + r * Math.sin(rad);
                        const y = 60 - r * Math.cos(rad);
                        const col =
                          s.sys === 'GPS'
                            ? '#4edea3'
                            : s.sys === 'GLO'
                              ? '#4cd7f6'
                              : s.sys === 'GAL'
                                ? '#ffb95f'
                                : '#a5b4fc';
                        return (
                          <g key={s.prn}>
                            <circle cx={x} cy={y} r="4.5" fill={col} />
                            <text x={x + 5} y={y + 3} fill="#dae2fd" fontSize="6.5" fontFamily="monospace">
                              {s.prn}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <div className="col-span-7 space-y-1">
                    {CONSTELLATION_SATS.map((s) => (
                      <div key={s.prn} className="flex items-center gap-1.5 font-mono text-[9px]">
                        <span className="w-6 text-[#bcc9cd]">{s.prn}</span>
                        <div className="flex-1 h-2 rounded-full bg-[#060e20] overflow-hidden">
                          <div
                            className="h-full bg-[#4edea3] rounded-full"
                            style={{ width: `${Math.min(100, s.snr * 2)}%` }}
                          />
                        </div>
                        <span className="w-7 text-right text-[#4cd7f6]">{s.snr}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PARCEL COORDINATE LOCATOR + DRIVE-ME STAKEOUT */}
          {activeTab === 'locate' && (
            <div className="h-full overflow-y-auto p-3 space-y-3">
              {/* Parcel Coordinate Locator Form */}
              <div className="p-3 rounded-2xl bg-[#171f33] border border-[#4cd7f6]/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold text-[#4cd7f6] uppercase flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Localizador de Coordenadas de Parcelas
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 bg-[#060e20] p-1 rounded-xl font-mono text-[10px]">
                  {(
                    [
                      { id: 'utm', label: 'UTM (E/N)' },
                      { id: 'geo', label: 'Lat / Lng' },
                      { id: 'batch', label: 'Poligonal' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setLocateMode(m.id)}
                      className={cn(
                        'py-1.5 rounded-lg font-bold',
                        locateMode === m.id ? 'bg-[#4cd7f6] text-[#003640]' : 'text-[#bcc9cd]'
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {locateMode !== 'geo' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid grid-cols-2 gap-1 bg-[#060e20] p-1 rounded-lg font-mono text-[9px]">
                      <button
                        type="button"
                        onClick={() => setLocateDatum('canoa')}
                        className={cn(
                          'py-1 rounded font-bold',
                          locateDatum === 'canoa' ? 'bg-[#ffb95f] text-[#2a1700]' : 'text-[#bcc9cd]'
                        )}
                      >
                        PSAD56 Canoa
                      </button>
                      <button
                        type="button"
                        onClick={() => setLocateDatum('regven')}
                        className={cn(
                          'py-1 rounded font-bold',
                          locateDatum === 'regven' ? 'bg-[#4edea3] text-[#003824]' : 'text-[#bcc9cd]'
                        )}
                      >
                        REGVEN
                      </button>
                    </div>
                    <select
                      value={locateHuso}
                      onChange={(e) => setLocateHuso(Number(e.target.value))}
                      className="bg-[#060e20] border border-[#222a3d] rounded-lg px-2 py-1 font-mono text-[10px] text-[#4cd7f6]"
                    >
                      {[18, 19, 20, 21].map((z) => (
                        <option key={z} value={z}>
                          Huso {z}N
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {locateMode === 'utm' && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <label className="font-mono text-[8px] text-[#869397] block mb-0.5">ESTE (X)</label>
                      <input
                        value={locateEste}
                        onChange={(e) => setLocateEste(e.target.value)}
                        className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-2 py-1.5 font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[8px] text-[#869397] block mb-0.5">NORTE (Y)</label>
                      <input
                        value={locateNorte}
                        onChange={(e) => setLocateNorte(e.target.value)}
                        className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-2 py-1.5 font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[8px] text-[#869397] block mb-0.5">COTA (Z)</label>
                      <input
                        value={locateZ}
                        onChange={(e) => setLocateZ(e.target.value)}
                        className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-2 py-1.5 font-mono text-xs text-[#ffb95f]"
                      />
                    </div>
                  </div>
                )}

                {locateMode === 'geo' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-mono text-[8px] text-[#869397] block mb-0.5">LATITUD (°)</label>
                      <input
                        value={locateLat}
                        onChange={(e) => setLocateLat(e.target.value)}
                        className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-2 py-1.5 font-mono text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="font-mono text-[8px] text-[#869397] block mb-0.5">LONGITUD (°)</label>
                      <input
                        value={locateLng}
                        onChange={(e) => setLocateLng(e.target.value)}
                        className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-2 py-1.5 font-mono text-xs text-white"
                      />
                    </div>
                  </div>
                )}

                {locateMode === 'batch' && (
                  <textarea
                    rows={4}
                    value={locateBatch}
                    onChange={(e) => setLocateBatch(e.target.value)}
                    className="w-full bg-[#060e20] border border-[#2d3449] rounded-xl p-2 font-mono text-[10px] text-[#dae2fd]"
                    placeholder="B1,409662.260,1327653.220,12.4"
                  />
                )}

                <button
                  type="button"
                  onClick={handleLocateCoordinate}
                  className="w-full py-2.5 rounded-xl bg-[#4cd7f6] hover:bg-[#acedff] text-[#003640] font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <Search className="w-4 h-4" />
                  <span>Localizar en Mapa y Activar Replanteo</span>
                </button>
              </div>

              {/* Drive-Me / Stakeout Bullseye Compass */}
              <div className="p-3 rounded-2xl bg-[#131b2e] border border-[#ffb95f]/35 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold text-[#ffb95f] uppercase flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5" /> Diana de Replanteo en Vivo (Drive-Me)
                  </span>
                  <select
                    value={stakeTarget?.id}
                    onChange={(e) => setStakeTargetId(e.target.value)}
                    className="bg-[#060e20] border border-[#2d3449] rounded-lg px-2 py-1 font-mono text-[10px] text-[#4cd7f6]"
                  >
                    {computedVertices.map((v) => (
                      <option key={v.id} value={v.id}>
                        Objetivo: {v.id}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Circular Bullseye Target */}
                <div className="flex items-center gap-3">
                  <div className="relative w-24 h-24 shrink-0 rounded-full bg-[#060e20] border border-[#2d3449] flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full border border-dashed border-[#3d494c] flex items-center justify-center">
                      <div
                        className={cn(
                          'w-7 h-7 rounded-full border flex items-center justify-center',
                          stakeoutMetrics.inTolerance
                            ? 'bg-[#4edea3]/25 border-[#4edea3]'
                            : 'border-[#ffb95f]/60'
                        )}
                      >
                        <div className="w-2 h-2 rounded-full bg-[#4edea3]" />
                      </div>
                    </div>
                    <div
                      className="absolute inset-0 flex items-start justify-center pt-1.5 pointer-events-none"
                      style={{ transform: `rotate(${stakeoutMetrics.relAngle}deg)` }}
                    >
                      <Navigation className="w-4 h-4 text-[#ffb95f]" />
                    </div>
                  </div>

                  <div className="flex-1 space-y-1.5 font-mono">
                    <div>
                      <span className="text-[9px] text-[#869397] block">DISTANCIA AL VÉRTICE</span>
                      <span
                        className={cn(
                          'text-xl font-extrabold tabular-nums',
                          stakeoutMetrics.inTolerance ? 'text-[#4edea3]' : 'text-[#ffb95f]'
                        )}
                      >
                        {stakeoutMetrics.distH.toFixed(2)} m
                      </span>
                    </div>
                    <div className="text-[10px] text-[#4cd7f6]">
                      {stakeoutMetrics.rumbo} (AZ {stakeoutMetrics.azimutDeg.toFixed(1)}°)
                    </div>
                    <div className="text-[10px] text-[#dae2fd]">
                      {stakeoutMetrics.inTolerance ? '✅ ¡DENTRO DE TOLERANCIA (<0.50m)!' : 'Camina siguiendo la flecha'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 bg-[#060e20] p-2 rounded-xl font-mono text-[10px] tabular-nums">
                  <div>
                    <span className="text-[8px] text-[#869397] block">
                      {stakeoutMetrics.dN >= 0 ? 'AL NORTE' : 'AL SUR'}
                    </span>
                    <span className="text-[#4cd7f6] font-bold">
                      {Math.abs(stakeoutMetrics.dN).toFixed(2)} m
                    </span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#869397] block">
                      {stakeoutMetrics.dE >= 0 ? 'AL ESTE' : 'AL OESTE'}
                    </span>
                    <span className="text-[#4cd7f6] font-bold">
                      {Math.abs(stakeoutMetrics.dE).toFixed(2)} m
                    </span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#869397] block">CORTE / RELL. Z</span>
                    <span className="text-[#ffb95f] font-bold">
                      {stakeoutMetrics.dZ >= 0 ? '+' : ''}
                      {stakeoutMetrics.dZ.toFixed(2)} m
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PARCELAS (DESKTOP PARITY) & VERTICES QA/QC */}
          {activeTab === 'parcels' && (
            <div className="h-full overflow-y-auto p-3 space-y-3">
              {/* Sub-tab Switcher */}
              <div className="grid grid-cols-2 gap-1 bg-[#131b2e] border border-[#222a3d] p-1 rounded-xl font-mono text-[10px]">
                <button
                  type="button"
                  onClick={() => setParcelsSubTab('parcels')}
                  className={cn(
                    'py-2 rounded-lg font-bold',
                    parcelsSubTab === 'parcels' ? 'bg-[#4cd7f6] text-[#003640]' : 'text-[#bcc9cd]'
                  )}
                >
                  📦 Parcelas ({savedParcels.length})
                </button>
                <button
                  type="button"
                  onClick={() => setParcelsSubTab('vertices')}
                  className={cn(
                    'py-2 rounded-lg font-bold',
                    parcelsSubTab === 'vertices' ? 'bg-[#4edea3] text-[#003824]' : 'text-[#bcc9cd]'
                  )}
                >
                  📐 Vértices ({computedVertices.length})
                </button>
              </div>

              {parcelsSubTab === 'parcels' ? (
                <div className="space-y-3">
                  {/* Save Active Polygon Card */}
                  <div className="p-3 rounded-2xl bg-[#131b2e] border border-[#4edea3]/30 space-y-2">
                    <div className="flex items-center justify-between font-mono text-[10px]">
                      <span className="text-[#4edea3] font-bold uppercase">Polígono Activo en Lienzo</span>
                      <span className="text-[#bcc9cd]">
                        {geom.area.toFixed(1)} m² · {computedVertices.length} pts
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        value={parcelName}
                        onChange={(e) => setParcelName(e.target.value)}
                        placeholder="Nombre parcela..."
                        className="flex-1 bg-[#060e20] border border-[#2d3449] rounded-xl px-2.5 py-2 text-xs text-white font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveActiveToParcelList(false)}
                        className="px-3 py-2 rounded-xl bg-[#4edea3] text-[#003824] font-bold text-[11px] flex items-center gap-1 shrink-0"
                      >
                        <Save className="w-3.5 h-3.5" /> Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveActiveToParcelList(true)}
                        className="px-2.5 py-2 rounded-xl bg-[#171f33] border border-[#2d3449] text-[#4cd7f6] font-bold text-xs shrink-0"
                        title="Guardar como Nueva Parcela"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Full Desktop ParcelList Component (Minimap, Search, Edit Mensura Modal, Summary Modal, Multi-DXF/KML/TXT) */}
                  <ParcelListLazy />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-xl bg-[#171f33] border border-[#222a3d]">
                      <span className="font-mono text-[9px] text-[#869397] uppercase block">SUPERFICIE</span>
                      <span className="font-mono text-sm font-bold text-[#4edea3] tabular-nums">
                        {geom.area.toFixed(2)} m²
                      </span>
                      <span className="font-mono text-[9px] text-[#bcc9cd] block">
                        {(geom.area / 10000).toFixed(4)} ha
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#171f33] border border-[#222a3d]">
                      <span className="font-mono text-[9px] text-[#869397] uppercase block">PERÍMETRO</span>
                      <span className="font-mono text-sm font-bold text-[#4cd7f6] tabular-nums">
                        {geom.perim.toFixed(2)} m
                      </span>
                      <span className="font-mono text-[9px] text-[#4edea3] block">{qaqcTimestamp}</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#171f33] border border-[#222a3d] space-y-2">
                    <div className="grid grid-cols-3 gap-1 bg-[#060e20] p-1 rounded-xl font-mono text-[10px]">
                      {(
                        [
                          { id: 'rigida02', label: 'RIGIDA02' },
                          { id: 'badekas', label: 'Badekas' },
                          { id: 'rigida', label: 'Rígida IDW' },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMethod(m.id)}
                          className={cn(
                            'py-1.5 rounded-lg font-bold',
                            method === m.id ? 'bg-[#4edea3] text-[#003824]' : 'text-[#bcc9cd]'
                          )}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={handleVerifyQaqc}
                        className="flex-1 py-2 rounded-lg bg-[#222a3d] text-[#4cd7f6] font-mono text-[10px] font-bold flex items-center justify-center gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-[#4edea3]" /> Auditoría QA/QC ≤ 1mm
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVertices(DEFAULT_PARCEL_GEO);
                          setParcelName('PARCELA-09B');
                          setStakeTargetId('V-05');
                          toast.success('Parcela restaurada');
                        }}
                        className="p-2 rounded-lg bg-[#222a3d] text-[#ffb95f]"
                        title="Restaurar parcela"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {computedVertices.map((v, idx) => (
                      <div
                        key={v.id}
                        className={cn(
                          'p-2.5 rounded-xl border',
                          v.id === stakeTarget?.id
                            ? 'bg-[#222a3d] border-[#ffb95f]/50'
                            : 'bg-[#171f33] border-[#222a3d]'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-[#4cd7f6]">{v.id}</span>
                            <span className="font-mono text-[10px] text-[#ffb95f]">
                              {v.rumbo} · {v.dist.toFixed(2)}m
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setStakeTargetId(v.id);
                                setActiveTab('locate');
                              }}
                              className="px-2 py-0.5 rounded bg-[#ffb95f]/20 font-mono text-[9px] font-bold text-[#ffb95f]"
                            >
                              Replantear →
                            </button>
                            {computedVertices.length > 2 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setVertices((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="px-1.5 py-0.5 rounded bg-rose-500/20 font-mono text-[9px] font-bold text-rose-300"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 bg-[#060e20] p-2 rounded-lg font-mono text-[11px] tabular-nums">
                          <div>
                            <span className="text-[8px] text-[#869397] block">ESTE (X)</span>
                            <span className="font-bold text-white">{v.este.toFixed(3)}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-[#869397] block">NORTE (Y)</span>
                            <span className="font-bold text-white">{v.norte.toFixed(3)}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-[#869397] block">COTA (Z)</span>
                            <span className="font-bold text-[#ffb95f]">{v.z.toFixed(3)}m</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: PROYECTOS CLOUD/LOCAL, LOGIN, EXPORT CAD & OTA UPDATE */}
          {activeTab === 'projects' && (
            <div className="h-full overflow-y-auto p-3 space-y-3">
              {/* Account / Login Banner */}
              <div
                className={cn(
                  'p-3 rounded-2xl bg-[#131b2e] border flex items-center justify-between gap-2',
                  user ? 'border-[#4edea3]/35' : 'border-[#ffb95f]/35'
                )}
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    {user ? `👤 ${user.nombre || user.username}` : '🔐 Sesión Cloud (PostgreSQL)'}
                  </div>
                  <div className="font-mono text-[9.5px] text-[#bcc9cd] truncate">
                    {user ? `${user.email || user.username} · ${roleInfo?.label}` : 'Inicia sesión para guardar proyectos en nube'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => (user ? setShowProfile(true) : setShowLoginModal(true))}
                  className={cn(
                    'px-2.5 py-1.5 rounded-xl font-bold text-[10.5px] shrink-0',
                    user ? 'bg-[#171f33] border border-[#2d3449] text-[#4cd7f6]' : 'bg-[#4edea3] text-[#003824]'
                  )}
                >
                  {user ? 'Cuenta' : 'Iniciar Sesión'}
                </button>
              </div>

              {/* Project Manager (Cloud + Local JSON) */}
              {user ? (
                <ProjectManagerLazy />
              ) : (
                <div className="p-3 rounded-2xl bg-[#171f33] border border-[#222a3d] space-y-2.5">
                  <div className="font-mono text-[10px] font-bold text-[#4cd7f6] uppercase">
                    📁 Proyecto Activo (Modo Local / JSON)
                  </div>
                  <input
                    value={projectMeta?.nombre || ''}
                    onChange={(e) => setProjectMeta({ ...projectMeta, nombre: e.target.value })}
                    placeholder="Nombre del proyecto..."
                    className="w-full bg-[#060e20] border border-[#2d3449] rounded-xl px-3 py-2 text-xs font-bold text-white"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setShowLoginModal(true)}
                      className="py-2 rounded-xl bg-[#4edea3] text-[#003824] font-bold text-[11px] flex items-center justify-center gap-1"
                    >
                      <Cloud className="w-3.5 h-3.5" /> Conectar Nube
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const data = {
                          meta: projectMeta,
                          parcels: savedParcels,
                          version: '6.0-android',
                          exportDate: new Date().toISOString(),
                        };
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${(projectMeta?.nombre || 'proyecto').replace(/\s+/g, '_')}_geogis6.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        toast.success('Proyecto .JSON descargado');
                      }}
                      className="py-2 rounded-xl bg-[#131b2e] border border-[#4cd7f6]/40 text-[#4cd7f6] font-bold text-[11px] flex items-center justify-center gap-1"
                    >
                      <HardDrive className="w-3.5 h-3.5" /> Exportar .JSON
                    </button>
                  </div>
                  <label className="w-full py-2 rounded-xl bg-[#060e20] border border-dashed border-[#4cd7f6]/40 text-[#4cd7f6] font-bold text-[10.5px] flex items-center justify-center gap-1.5 cursor-pointer">
                    <Download className="w-3.5 h-3.5 rotate-180" /> Importar Proyecto desde Archivo (.json)
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          try {
                            const parsed = JSON.parse(String(ev.target?.result || '{}'));
                            importProject(parsed);
                            setCurrentProjectId(null);
                            toast.success('Proyecto importado con éxito');
                          } catch {
                            toast.error('Archivo .JSON inválido');
                          }
                        };
                        reader.readAsText(f);
                      }}
                    />
                  </label>
                </div>
              )}

              {/* Quick Export Active Parcel */}
              <div className="p-3 rounded-2xl bg-[#131b2e] border border-[#222a3d] space-y-2">
                <div className="font-mono text-[10px] font-bold text-[#4cd7f6] uppercase">
                  ⬇ Exportación Rápida · {parcelName}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleExportDxf}
                    className="p-2.5 rounded-xl bg-[#4cd7f6] text-[#003640] font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <FileCode2 className="w-4 h-4" /> .DXF CAD
                  </button>
                  <button
                    type="button"
                    onClick={handleExportKml}
                    className="p-2.5 rounded-xl bg-[#171f33] border border-[#2d3449] text-white font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <MapIcon className="w-4 h-4 text-[#4cd7f6]" /> .KML Earth
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCivilCad}
                    className="p-2.5 rounded-xl bg-[#171f33] border border-[#2d3449] text-white font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <Copy className="w-4 h-4 text-[#4edea3]" /> P,E,N,Z
                  </button>
                  <button
                    type="button"
                    onClick={() => FileService.exportTXT(storeResultsPayload, parcelName, false)}
                    className="p-2.5 rounded-xl bg-[#171f33] border border-[#2d3449] text-white font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <FileText className="w-4 h-4 text-[#ffb95f]" /> .TXT Cartera
                  </button>
                </div>
              </div>

              {/* OTA Auto-Update APK Card */}
              <div
                className={cn(
                  'p-3 rounded-2xl bg-[#131b2e] border space-y-2',
                  otaInfo.hasUpdate ? 'border-[#4edea3]/60' : 'border-[#222a3d]'
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-white">🚀 Actualizaciones Automáticas APK</div>
                    <div className="font-mono text-[9.5px] text-[#bcc9cd]">
                      Instalada: v{installedVersionName} · Última: v{otaInfo.latestVersionName}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded font-mono text-[9px] font-bold',
                      otaInfo.hasUpdate ? 'bg-[#4edea3]/20 text-[#4edea3]' : 'bg-[#171f33] text-[#4cd7f6]'
                    )}
                  >
                    {otaInfo.hasUpdate ? 'DISPONIBLE' : 'AL DÍA'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void checkApkUpdates(true)}
                    className="py-2 rounded-xl bg-[#171f33] border border-[#2d3449] text-[#4cd7f6] font-bold text-[11px]"
                  >
                    {otaInfo.checking ? 'Comprobando...' : '🔍 Buscar Actualización'}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(otaInfo.downloadUrl, '_blank')}
                    className={cn(
                      'py-2 rounded-xl font-bold text-[11px]',
                      otaInfo.hasUpdate ? 'bg-[#4edea3] text-[#003824]' : 'bg-[#222a3d] text-[#dae2fd]'
                    )}
                  >
                    ⬇ Descargar APK
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* LOGIN CLOUD MODAL */}
        {showLoginModal && (
          <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3">
            <div className="w-full max-w-md rounded-2xl bg-[#131b2e] border border-[#2d3449] shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#222a3d] flex items-center justify-between bg-[#0b1326]">
                <div className="text-sm font-bold text-white">🔐 Iniciar Sesión GeoGIS6 Cloud</div>
                <button
                  type="button"
                  onClick={() => setShowLoginModal(false)}
                  className="p-1 rounded-lg bg-[#171f33] text-[#bcc9cd]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleApkLoginSubmit} className="p-4 space-y-3">
                <div>
                  <label className="font-mono text-[9px] text-[#869397] block mb-1">
                    USUARIO O CORREO ELECTRÓNICO
                  </label>
                  <input
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="usuario o correo@ejemplo.com"
                    className="w-full bg-[#060e20] border border-[#2d3449] rounded-xl px-3 py-2.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="font-mono text-[9px] text-[#869397] block mb-1">CONTRASEÑA</label>
                  <input
                    required
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[#060e20] border border-[#2d3449] rounded-xl px-3 py-2.5 text-xs text-white"
                  />
                </div>
                {loginError && (
                  <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[11px]">
                    {loginError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full py-2.5 rounded-xl bg-[#4edea3] text-[#003824] font-bold text-xs disabled:opacity-50"
                >
                  {loginLoading ? 'Autenticando...' : 'Ingresar a PostgreSQL Cloud'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* OTA UPDATE MODAL */}
        {showOtaModal && (
          <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3">
            <div className="w-full max-w-md rounded-2xl bg-[#131b2e] border border-[#4edea3]/45 shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#222a3d] flex items-center justify-between bg-[#0b1326]">
                <div className="text-sm font-bold text-white">
                  {otaInfo.hasUpdate ? '🚀 Nueva Versión APK Disponible' : '🔄 Actualizaciones GeoGIS6 APK'}
                </div>
                <button
                  type="button"
                  onClick={() => setShowOtaModal(false)}
                  className="p-1 rounded-lg bg-[#171f33] text-[#bcc9cd]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                  <div className="p-2.5 rounded-xl bg-[#060e20] border border-[#222a3d]">
                    <span className="text-[#869397] block">INSTALADA</span>
                    <b className="text-white text-xs">v{installedVersionName}</b>
                    <span className="text-[9px] text-[#869397] block">Build {installedVersionCode}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#060e20] border border-[#4edea3]/40">
                    <span className="text-[#869397] block">ÚLTIMA RELEASE</span>
                    <b className="text-[#4edea3] text-xs">v{otaInfo.latestVersionName}</b>
                    <span className="text-[9px] text-[#869397] block">Build {otaInfo.latestVersionCode}</span>
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#060e20] text-[11px] text-[#bcc9cd]">{otaInfo.notes}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void checkApkUpdates(true)}
                    className="py-2.5 rounded-xl bg-[#171f33] border border-[#2d3449] text-[#4cd7f6] font-bold text-xs"
                  >
                    {otaInfo.checking ? 'Buscando...' : '🔍 Verificar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(otaInfo.downloadUrl, '_blank')}
                    className="py-2.5 rounded-xl bg-[#4edea3] text-[#003824] font-bold text-xs"
                  >
                    ⬇ Actualizar APK
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. NATIVE ANDROID BOTTOM NAVIGATION BAR (5 MODULES) */}
        <nav className="min-h-[68px] shrink-0 bg-[#060e20]/95 backdrop-blur-xl border-t border-[#171f33] z-40 grid grid-cols-5 px-1 pt-1 pb-[calc(env(safe-area-inset-bottom,0px)+8px)]">
          {(
            [
              { id: 'map', label: 'Mapa', icon: MapIcon },
              { id: 'topographer', label: 'GNSS', icon: Radio },
              { id: 'locate', label: 'Localizar', icon: Target },
              { id: 'parcels', label: 'Parcelas', icon: Package },
              { id: 'projects', label: 'Proyectos', icon: FolderKanban },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isAct = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  'flex flex-col items-center justify-center transition-colors',
                  isAct ? 'text-[#4cd7f6] font-bold' : 'text-[#bcc9cd]'
                )}
              >
                <div
                  className={cn(
                    'flex items-center justify-center w-9 h-6 rounded-full',
                    isAct && 'bg-[#4cd7f6]/15'
                  )}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <span className="font-mono text-[8px] font-bold uppercase tracking-wider mt-0.5">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
