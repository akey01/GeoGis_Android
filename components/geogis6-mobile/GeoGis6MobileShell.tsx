'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Crosshair,
  Download,
  FolderLock,
  Map as MapIcon,
  Radar,
  Satellite,
  User,
  Waypoints,
  X,
} from 'lucide-react';
import {
  APK_DOWNLOAD_URL,
  APP_VERSION_CODE,
  APP_VERSION_NAME,
  DEFAULT_PARCEL_5371_JAR,
  DEFAULT_SYNCED_PROJECTS,
  GITHUB_RELEASE_API_URL,
  PROD_API_URL,
  geoToUtmGrs80,
  getOrCreateFieldDeviceId,
  type CloudUser,
  type CrsMode,
  type FieldParcel,
  type GeoGis6ScreenId,
  type GnssReceiverMode,
  type LiveGnssFix,
  type SyncedProject,
} from './data/fieldData';
import AuthProjectsScreen from './AuthProjectsScreen';
import ProjectMapScreen from './ProjectMapScreen';
import ParcelDetailScreen from './ParcelDetailScreen';
import PointLocateScreen from './PointLocateScreen';
import GnssDiagnosticsScreen from './GnssDiagnosticsScreen';
import './geogis6-mobile.css';

const STORAGE_AUTH_KEY = 'geogis6_mobile_auth_v6';

const SCREEN_TITLES: Record<GeoGis6ScreenId, string> = {
  auth: 'Autenticación y Proyectos',
  mapa: 'Mapa',
  parcela: 'Parcela',
  localizacion: 'Localización',
  satelites: 'Satélites',
};

const BOTTOM_TABS: Array<{
  id: Exclude<GeoGis6ScreenId, 'auth'>;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'mapa', label: 'Mapa', icon: MapIcon },
  { id: 'parcela', label: 'Parcela', icon: Waypoints },
  { id: 'localizacion', label: 'Localización', icon: Crosshair },
  { id: 'satelites', label: 'Satélites', icon: Satellite },
];

export default function GeoGis6MobileShell() {
  const [activeScreen, setActiveScreen] = useState<GeoGis6ScreenId>('mapa');
  const [deviceId, setDeviceId] = useState<string>('apk_rover');
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);

  const [projects, setProjects] = useState<SyncedProject[]>(DEFAULT_SYNCED_PROJECTS);
  const [selectedProject, setSelectedProject] = useState<SyncedProject>(DEFAULT_SYNCED_PROJECTS[0]);
  const [activeParcel, setActiveParcel] = useState<FieldParcel>(DEFAULT_PARCEL_5371_JAR);
  const [crsMode, setCrsMode] = useState<CrsMode>('regven');
  const [selectedVertexId, setSelectedVertexId] = useState<string>('V-01');
  const [shiftEste, setShiftEste] = useState<number>(0.012);
  const [shiftNorte, setShiftNorte] = useState<number>(-0.008);
  const [receiverMode, setReceiverMode] = useState<GnssReceiverMode>('external_rtk');
  const [antennaHeightM, setAntennaHeightM] = useState<number>(1.8);
  const [rtkReconverging, setRtkReconverging] = useState<boolean>(false);
  const [cloudSyncing, setCloudSyncing] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [gnssFix, setGnssFix] = useState<LiveGnssFix>({
    lat: 11.94501,
    lng: -69.80531,
    alt: 18.28,
    accuracy: 0.012,
    esteRegven: 398412.5,
    norteRegven: 1284866.2,
    isLiveHardware: false,
    timestamp: Date.now(),
  });

  const [showOtaModal, setShowOtaModal] = useState<boolean>(false);
  const [otaState, setOtaState] = useState({
    checking: false,
    hasUpdate: false,
    latestCode: APP_VERSION_CODE,
    latestName: APP_VERSION_NAME,
    downloadUrl: APK_DOWNLOAD_URL,
    notes: 'Versión oficial instalada y verificada.',
  });

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 2800);
  }, []);

  // Hydrate persistent device ID & saved session
  useEffect(() => {
    setDeviceId(getOrCreateFieldDeviceId());
    try {
      const raw = localStorage.getItem(STORAGE_AUTH_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.token && parsed?.user) {
          setAuthToken(parsed.token);
          setUser(parsed.user);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Hardware GNSS real-time watcher
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const utm = geoToUtmGrs80(c.latitude, c.longitude, activeParcel.huso || 19);
        setGnssFix({
          lat: c.latitude,
          lng: c.longitude,
          alt: c.altitude ?? 18.25,
          accuracy: c.accuracy || 3.5,
          esteRegven: utm.este,
          norteRegven: utm.norte,
          isLiveHardware: true,
          timestamp: pos.timestamp,
        });
      },
      () => {
        // Fallback smoothly to field simulation when GPS fix is unavailable indoors
      },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeParcel.huso]);

  // OTA Update checker (GitHub Releases + Render /api/apk-version)
  const checkOtaUpdates = useCallback(
    async (manual = false) => {
      setOtaState((prev) => ({ ...prev, checking: true }));
      let bestCode = APP_VERSION_CODE;
      let bestName = APP_VERSION_NAME;
      let bestUrl = APK_DOWNLOAD_URL;
      let bestNotes = 'GeoGIS6 Mobile actualizado a la última versión estable.';

      try {
        const [apiRes, ghRes] = await Promise.allSettled([
          fetch(`${PROD_API_URL}/api/apk-version?t=${Date.now()}`, { cache: 'no-store' }).then((r) =>
            r.ok ? r.json() : null
          ),
          fetch(GITHUB_RELEASE_API_URL, {
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
        // offline field mode
      }

      const hasUpdate = bestCode > APP_VERSION_CODE;
      setOtaState({
        checking: false,
        hasUpdate,
        latestCode: bestCode,
        latestName: bestName,
        downloadUrl: bestUrl,
        notes: bestNotes,
      });

      if (hasUpdate) setShowOtaModal(true);
      else if (manual) notify(`GeoGIS6 v${APP_VERSION_NAME} está al día`);
    },
    [notify]
  );

  useEffect(() => {
    void checkOtaUpdates(false);
  }, [checkOtaUpdates]);

  const mapCloudProjects = (rawProjects: any[]): SyncedProject[] => {
    const cloudMapped: SyncedProject[] = (rawProjects || []).map((p: any) => ({
      id: String(p.id),
      name: String(p.nombre || 'Proyecto Cloud'),
      crsLabel: 'REGVEN 19N | CLOUD',
      crsBadgeColor: 'secondary',
      parcelsText: 'Sincronizado en PostgreSQL',
      syncStatus: p.actualizado ? new Date(p.actualizado).toLocaleDateString('es-VE') : 'En línea',
      defaultCrs: 'regven',
      activeParcelCode: '5371-JAR',
      sectorLabel: 'GeoGIS6 Cloud',
      source: 'cloud',
      updatedAt: p.actualizado,
    }));
    return [...cloudMapped, ...DEFAULT_SYNCED_PROJECTS];
  };

  const handleRefreshProjects = useCallback(async () => {
    if (!authToken) {
      notify('Trabajando en modo local Off-Grid');
      return;
    }
    setCloudSyncing(true);
    try {
      const res = await fetch(`${PROD_API_URL}/api/projects`, {
        headers: { Authorization: `Bearer ${authToken}`, 'x-device-id': deviceId },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && Array.isArray(data.projects)) {
        setProjects(mapCloudProjects(data.projects));
        notify(`${data.projects.length} proyectos sincronizados`);
      }
    } catch {
      notify('Sin conexión al servidor · Usando caché local');
    } finally {
      setCloudSyncing(false);
    }
  }, [authToken, deviceId, notify]);

  const handleLoginCloud = useCallback(
    async (email: string, password: string) => {
      const devId = getOrCreateFieldDeviceId();
      const res = await fetch(`${PROD_API_URL}/api/auth/apk-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': devId },
        body: JSON.stringify({ email, password, deviceId: devId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.token || !data.user) {
        throw new Error(data.error || 'Credenciales inválidas');
      }
      setAuthToken(data.token);
      setUser(data.user);
      setIsDemoMode(false);
      localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify({ token: data.token, user: data.user }));
      if (Array.isArray(data.projects)) {
        setProjects(mapCloudProjects(data.projects));
      }
      setActiveScreen('mapa');
      notify(`Bienvenido ${data.user.nombre || data.user.username}`);
    },
    [notify]
  );

  const handleLogout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setProjects(DEFAULT_SYNCED_PROJECTS);
    localStorage.removeItem(STORAGE_AUTH_KEY);
    notify('Sesión cerrada · Modo Campo Local activo');
  }, [notify]);

  const handleSaveCurrentToCloud = useCallback(async () => {
    if (!authToken) {
      notify('Inicia sesión para guardar proyectos en PostgreSQL');
      return;
    }
    setCloudSyncing(true);
    try {
      const content = {
        meta: { nombre: selectedProject.name, notas: activeParcel.sector },
        parcels: [
          {
            id: activeParcel.id,
            nombre: activeParcel.code,
            fecha: new Date().toLocaleDateString('es-VE'),
            area: activeParcel.areaGraficaM2,
            perim: activeParcel.perimeterM,
            ha: activeParcel.areaGraficaM2 / 10000,
            geometryType: 'cerrada',
            method: 'rigida02',
            puntos: activeParcel.vertices.map((v) => ({
              id: v.shortId,
              ok: true,
              direction: 'canoa_regven',
              input: { id: v.shortId, este: v.estePsad56, norte: v.nortePsad56, huso: activeParcel.huso, alt: v.cota },
              result: { este: v.esteRegven, norte: v.norteRegven, huso: activeParcel.huso, cota: v.cota, lat: v.lat, lng: v.lng },
            })),
          },
        ],
      };
      const res = await fetch(`${PROD_API_URL}/api/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          'x-device-id': deviceId,
        },
        body: JSON.stringify({
          id: selectedProject.source === 'cloud' ? selectedProject.id : null,
          name: selectedProject.name,
          content,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Error al guardar en la nube');
      notify('Proyecto sincronizado en PostgreSQL');
      await handleRefreshProjects();
    } catch (err: any) {
      notify(err?.message || 'Error guardando en la nube');
    } finally {
      setCloudSyncing(false);
    }
  }, [activeParcel, authToken, deviceId, handleRefreshProjects, notify, selectedProject]);

  const handleToggleCrs = () => {
    setCrsMode((prev) => {
      const next = prev === 'regven' ? 'psad56' : 'regven';
      notify(
        next === 'regven'
          ? 'Sistema activo: REGVEN 19N (RIGIDA02)'
          : 'Sistema activo: PSAD56 La Canoa 19N'
      );
      return next;
    });
  };

  const handleSelectProject = (project: SyncedProject, openMap = true) => {
    setSelectedProject(project);
    setCrsMode(project.defaultCrs);
    if (openMap) setActiveScreen('mapa');
    notify(`Proyecto activo: ${project.name}`);
  };

  const handleStakeVertex = (vertexId: string) => {
    setSelectedVertexId(vertexId);
    setActiveScreen('localizacion');
    notify(`Objetivo RTK fijado: ${vertexId} (${activeParcel.code})`);
  };

  const handleCaptureCurrentVertex = () => {
    if (!gnssFix.isLiveHardware) return;
    setActiveParcel((prev) => ({
      ...prev,
      vertices: prev.vertices.map((v) =>
        v.id === selectedVertexId
          ? {
              ...v,
              esteRegven: gnssFix.esteRegven,
              norteRegven: gnssFix.norteRegven,
              lat: gnssFix.lat,
              lng: gnssFix.lng,
              cota: Math.round(gnssFix.alt * 100) / 100,
            }
          : v
      ),
    }));
  };

  const handleRestartRtk = () => {
    if (rtkReconverging) return;
    setRtkReconverging(true);
    notify('Reiniciando ambigüedades RTK (FLOAT)...');
    setTimeout(() => {
      setRtkReconverging(false);
      notify('RTK FIXED restaurado · RMS 0.008 m');
    }, 1200);
  };

  const showMobileChrome = activeScreen !== 'auth';

  return (
    <div className="geogis6-mobile-root flex flex-col pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] relative">
      {/* Global Feedback Toast */}
      {toastMsg && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[80] px-3 py-1.5 rounded-xl bg-[#151b2b]/95 border border-[#4edea3]/50 text-[#4edea3] font-stitch-mono text-[10.5px] shadow-2xl backdrop-blur-md text-center max-w-[90vw] pointer-events-none">
          {toastMsg}
        </div>
      )}

      {/* Fixed Top Header for Screens 2..5 */}
      {showMobileChrome && (
        <header className="shrink-0 z-40 bg-[#0d1322]/90 backdrop-blur-xl border-b border-[#191f2f]">
          <div className="h-14 px-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveScreen('auth')}
                title="Autenticación y Proyectos"
                className="w-9 h-9 rounded bg-[#242a3a] hover:bg-[#2f3445] flex items-center justify-center text-[#4cd7f6] transition-colors"
              >
                <Radar className="w-5 h-5" />
              </button>
              <div className="flex flex-col">
                <h1 className="font-stitch-headline text-[18px] font-semibold tracking-tight uppercase text-[#dde2f8] leading-none">
                  {SCREEN_TITLES[activeScreen]}
                </h1>
                <span
                  className={`font-stitch-mono text-[10px] tracking-widest uppercase flex items-center gap-1 mt-0.5 ${
                    rtkReconverging ? 'text-[#ffb95f]' : 'text-[#4edea3]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full inline-block animate-pulse ${
                      rtkReconverging ? 'bg-[#ffb95f]' : 'bg-[#4edea3]'
                    }`}
                  />
                  {rtkReconverging
                    ? 'RTK FLOAT · CONVERGIENDO...'
                    : gnssFix.isLiveHardware
                      ? `GNSS LIVE · ±${gnssFix.accuracy.toFixed(1)}M`
                      : receiverMode === 'external_rtk'
                        ? 'RTK FIXED · RMS: 0.008M'
                        : 'DGNSS L1/L5 · RMS: 0.35M'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {otaState.hasUpdate && (
                <button
                  type="button"
                  onClick={() => setShowOtaModal(true)}
                  className="px-2 py-1 rounded bg-[#4edea3]/20 border border-[#4edea3]/60 text-[#4edea3] font-stitch-mono text-[9.5px] font-bold animate-pulse"
                >
                  ⬆ v{otaState.latestName}
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveScreen('satelites')}
                className="flex items-center gap-1 bg-[#151b2b] hover:bg-[#242a3a] px-2 py-1 rounded border border-[#242a3a]"
              >
                <Satellite className="w-3.5 h-3.5 text-[#4edea3]" />
                <span className="font-stitch-mono text-[11px] text-[#dde2f8] font-semibold">
                  {receiverMode === 'external_rtk' ? 28 : 19}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveScreen('auth')}
                className="w-8 h-8 rounded-full bg-[#4cd7f6] hover:bg-[#acedff] flex items-center justify-center text-[#003640]"
                title="Cuenta y Proyectos"
              >
                <User className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Active Screen Viewport */}
      <main className="flex-1 min-h-0 relative overflow-hidden bg-[#0d1322]">
        {activeScreen === 'auth' && (
          <AuthProjectsScreen
            deviceId={deviceId}
            user={user}
            projects={projects}
            selectedProject={selectedProject}
            cloudSyncing={cloudSyncing}
            otaHasUpdate={otaState.hasUpdate}
            otaLatestName={otaState.latestName}
            onSelectProject={handleSelectProject}
            onLoginCloud={handleLoginCloud}
            onDemoEnter={() => {
              setIsDemoMode(true);
              setActiveScreen('mapa');
              notify('Modo Campo Offline / Demo activo');
            }}
            onLogout={handleLogout}
            onSaveCurrentToCloud={handleSaveCurrentToCloud}
            onRefreshProjects={handleRefreshProjects}
            onOpenOtaUpdate={() => {
              setShowOtaModal(true);
              void checkOtaUpdates(false);
            }}
          />
        )}

        {activeScreen === 'mapa' && (
          <ProjectMapScreen
            project={selectedProject}
            parcel={activeParcel}
            crsMode={crsMode}
            isDemoMode={isDemoMode}
            gnssFix={gnssFix}
            onToggleCrs={handleToggleCrs}
            onOpenParcel={() => setActiveScreen('parcela')}
            onStakeVertex={handleStakeVertex}
            onCenterGps={() =>
              notify(
                gnssFix.isLiveHardware
                  ? `Centrado en GPS Real (${gnssFix.esteRegven.toFixed(2)}E, ${gnssFix.norteRegven.toFixed(2)}N)`
                  : 'Centrado en estación Rover RTK · Adícora Sector Norte'
              )
            }
            onNotify={notify}
          />
        )}

        {activeScreen === 'parcela' && (
          <ParcelDetailScreen
            parcel={activeParcel}
            crsMode={crsMode}
            selectedVertexId={selectedVertexId}
            isDemoMode={isDemoMode}
            onToggleCrs={handleToggleCrs}
            onBackToMap={() => setActiveScreen('mapa')}
            onStakeVertex={handleStakeVertex}
            onNotify={notify}
          />
        )}

        {activeScreen === 'localizacion' && (
          <PointLocateScreen
            parcel={activeParcel}
            selectedVertexId={selectedVertexId}
            crsMode={crsMode}
            gnssFix={gnssFix}
            shiftEste={shiftEste}
            shiftNorte={shiftNorte}
            onSelectVertex={setSelectedVertexId}
            onApplyShift={(dE, dN) => {
              setShiftEste(dE);
              setShiftNorte(dN);
            }}
            onCaptureCurrentVertex={handleCaptureCurrentVertex}
            onNotify={notify}
          />
        )}

        {activeScreen === 'satelites' && (
          <GnssDiagnosticsScreen
            receiverMode={receiverMode}
            antennaHeightM={antennaHeightM}
            rtkReconverging={rtkReconverging}
            onChangeReceiver={(m) => {
              setReceiverMode(m);
              notify(
                m === 'external_rtk'
                  ? 'Receptor externo SOUTH INNO7 (RTK 1408ch) activo'
                  : 'Receptor interno Android L1+L5 activo'
              );
            }}
            onChangeAntennaHeight={setAntennaHeightM}
            onRestartRtk={handleRestartRtk}
            onNotify={notify}
          />
        )}
      </main>

      {/* Bottom Navigation Bar */}
      {showMobileChrome && (
        <nav className="shrink-0 z-40 bg-[#0d1322]/95 backdrop-blur-xl border-t border-[#191f2f] shadow-[0_-1px_8px_rgba(0,0,0,0.3)]">
          <div className="min-h-[66px] px-1 grid grid-cols-5 items-center pb-1">
            <button
              type="button"
              onClick={() => setActiveScreen('auth')}
              className="flex flex-col items-center justify-center gap-0.5 min-h-[48px] py-1 text-[#bcc9cd] hover:text-[#dde2f8]"
            >
              <FolderLock className="w-5 h-5" />
              <span className="font-stitch-headline text-[9.5px] font-bold tracking-wider uppercase">
                Proyectos
              </span>
            </button>

            {BOTTOM_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeScreen === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveScreen(tab.id)}
                  className={`flex flex-col items-center justify-center gap-0.5 min-h-[48px] py-1 transition-colors ${
                    isActive ? 'text-[#06b6d4] font-bold' : 'text-[#bcc9cd] hover:text-[#dde2f8]'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-stitch-headline text-[9.5px] font-bold tracking-wider uppercase">
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* OTA Auto-Update Modal */}
      {showOtaModal && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#151b2b] border border-[#4edea3]/45 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#242a3a] flex items-center justify-between bg-[#0d1322]">
              <span className="font-stitch-headline text-[14px] font-bold text-[#dde2f8]">
                {otaState.hasUpdate ? '🚀 Nueva Versión APK Disponible' : '🔄 Actualizaciones GeoGIS6'}
              </span>
              <button
                type="button"
                onClick={() => setShowOtaModal(false)}
                className="w-7 h-7 rounded bg-[#242a3a] text-[#bcc9cd] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 font-stitch-mono text-[10px]">
                <div className="p-2.5 rounded-lg bg-[#080e1d] border border-[#242a3a]">
                  <span className="text-[#869397] block">INSTALADA</span>
                  <strong className="text-[#dde2f8] text-xs">v{APP_VERSION_NAME}</strong>
                  <span className="text-[9px] text-[#869397] block">Build {APP_VERSION_CODE}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#080e1d] border border-[#4edea3]/40">
                  <span className="text-[#869397] block">ÚLTIMA RELEASE</span>
                  <strong className="text-[#4edea3] text-xs">v{otaState.latestName}</strong>
                  <span className="text-[9px] text-[#869397] block">Build {otaState.latestCode}</span>
                </div>
              </div>
              <p className="p-2.5 rounded-lg bg-[#080e1d] text-[11px] text-[#bcc9cd]">{otaState.notes}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void checkOtaUpdates(true)}
                  className="py-2.5 rounded-xl bg-[#242a3a] text-[#4cd7f6] font-stitch-headline font-bold text-xs"
                >
                  {otaState.checking ? 'Buscando...' : 'Verificar'}
                </button>
                <button
                  type="button"
                  onClick={() => window.open(otaState.downloadUrl, '_blank')}
                  className="py-2.5 rounded-xl bg-[#4edea3] text-[#003824] font-stitch-headline font-bold text-xs flex items-center justify-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Actualizar APK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
