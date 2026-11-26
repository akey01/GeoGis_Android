'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Crosshair,
  Download,
  FolderLock,
  Map as MapIcon,
  Radar,
  RefreshCw,
  Satellite,
  User,
  Waypoints,
  X,
} from 'lucide-react';
import {
  APP_VERSION_CODE,
  APP_VERSION_NAME,
  VENEZUELA_DEFAULT_CENTER,
  buildFieldParcelFromVertices,
  geoToUtmGrs80,
  getOrCreateFieldDeviceId,
  parseCloudProjectParcels,
  type CloudUser,
  type CrsMode,
  type FieldParcel,
  type GeoGis6ScreenId,
  type GnssReceiverMode,
  type LiveGnssFix,
  type SyncedProject,
} from './data/fieldData';
import {
  checkBackendHealth,
  mobileApiFetch,
  type BackendHealthStatus,
} from '@/lib/mobileApi';
import {
  clearSavedAuth,
  createEmptyOfflineProject,
  loadLocalParcels,
  loadLocalProjects,
  loadSavedAuth,
  markProjectPendingPush,
  mergeCloudProjectsWithLocal,
  migrateLocalProjectToCloud,
  saveLocalParcels,
  saveLocalProjects,
  saveSavedAuth,
  serializeProjectForCloud,
} from '@/lib/mobileOfflineStore';
import {
  INITIAL_OTA_STATUS,
  applyOtaBundleInApp,
  checkOtaManifest,
  notifyOtaAppReady,
  type OtaUpdateStatus,
} from '@/lib/mobileOtaUpdater';
import AuthProjectsScreen from './AuthProjectsScreen';
import ParcelDetailScreen from './ParcelDetailScreen';
import PointLocateScreen from './PointLocateScreen';
import GnssDiagnosticsScreen from './GnssDiagnosticsScreen';
import './geogis6-mobile.css';

const ProjectMapScreen = dynamic(() => import('./ProjectMapScreen'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#080e1d] flex flex-col items-center justify-center gap-2 text-[#4cd7f6] font-stitch-mono text-xs">
      <div className="w-7 h-7 border-2 border-[#4cd7f6]/30 border-t-[#4cd7f6] rounded-full animate-spin" />
      <span>Iniciando Motor Cartográfico OpenLayers...</span>
    </div>
  ),
});

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
  // Siempre iniciar en pantalla de Login / Proyectos
  const [activeScreen, setActiveScreen] = useState<GeoGis6ScreenId>('auth');
  const [deviceId, setDeviceId] = useState<string>('apk_rover');
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [user, setUser] = useState<CloudUser | null>(null);

  const [projects, setProjects] = useState<SyncedProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<SyncedProject | null>(null);
  const [parcels, setParcels] = useState<FieldParcel[]>([]);
  const [activeParcelId, setActiveParcelId] = useState<string | null>(null);
  const [mapFitTrigger, setMapFitTrigger] = useState<number>(0);

  const [crsMode, setCrsMode] = useState<CrsMode>('regven');
  const [selectedVertexId, setSelectedVertexId] = useState<string>('V-01');
  const [shiftEste, setShiftEste] = useState<number>(0);
  const [shiftNorte, setShiftNorte] = useState<number>(0);
  const [receiverMode, setReceiverMode] = useState<GnssReceiverMode>('external_rtk');
  const [antennaHeightM, setAntennaHeightM] = useState<number>(1.8);
  const [rtkReconverging, setRtkReconverging] = useState<boolean>(false);
  const [cloudSyncing, setCloudSyncing] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [backendHealth, setBackendHealth] = useState<BackendHealthStatus>({
    navigatorOnline: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    serverReachable: false,
    dbConnected: false,
    activeBaseUrl: null,
    dbError: null,
  });

  const activeParcel = useMemo(
    () => parcels.find((p) => p.id === activeParcelId) || parcels[0] || null,
    [parcels, activeParcelId],
  );

  const pendingSyncCount = useMemo(
    () =>
      projects.filter(
        (p) => p.syncState === 'local_only' || p.syncState === 'pending_push',
      ).length,
    [projects],
  );

  const [gnssFix, setGnssFix] = useState<LiveGnssFix>({
    lat: VENEZUELA_DEFAULT_CENTER.lat,
    lng: VENEZUELA_DEFAULT_CENTER.lng,
    alt: 0,
    accuracy: 0,
    esteRegven: VENEZUELA_DEFAULT_CENTER.esteRegven,
    norteRegven: VENEZUELA_DEFAULT_CENTER.norteRegven,
    isLiveHardware: false,
    timestamp: Date.now(),
  });

  const [showOtaModal, setShowOtaModal] = useState<boolean>(false);
  const [otaState, setOtaState] = useState<OtaUpdateStatus>(INITIAL_OTA_STATUS);

  const syncInFlightRef = useRef<boolean>(false);
  const authTokenRef = useRef<string | null>(authToken);
  authTokenRef.current = authToken;
  const projectsRef = useRef<SyncedProject[]>(projects);
  projectsRef.current = projects;
  const selectedProjectRef = useRef<SyncedProject | null>(selectedProject);
  selectedProjectRef.current = selectedProject;

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 3200);
  }, []);

  const refreshHealth = useCallback(async () => {
    const h = await checkBackendHealth(6500);
    setBackendHealth(h);
    return h;
  }, []);

  // Pre-cachear parcelas de proyectos en la nube para disponibilidad offline
  const precacheCloudProjects = useCallback(
    async (cloudProjects: SyncedProject[], token: string, devId: string) => {
      const queue = cloudProjects.filter((p) => p.source === 'cloud').slice(0, 12);
      const workers = [0, 1].map(async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          try {
            const { response } = await mobileApiFetch(
              `/api/projects?id=${encodeURIComponent(item.id)}`,
              {
                headers: { Authorization: `Bearer ${token}`, 'x-device-id': devId },
              },
              { timeoutMs: 12000 },
            );
            const data = await response.json().catch(() => ({}));
            if (response.ok && data.success && data.content) {
              const parsed = parseCloudProjectParcels(data.content, item.name);
              saveLocalParcels(item.id, parsed);
              setProjects((prev) => {
                const next = prev.map((pr) =>
                  pr.id === item.id
                    ? { ...pr, parcelsText: `${parsed.length} Parcelas (Dispositivo)` }
                    : pr,
                );
                saveLocalProjects(next);
                return next;
              });
            }
          } catch {
            // ignorar proyecto individual si falla en segundo plano
          }
        }
      });
      await Promise.allSettled(workers);
    },
    [],
  );

  // Sincronización bidireccional: sube pendientes/locales -> baja Escritorio -> pre-cachea
  const syncPendingAndRefresh = useCallback(
    async (
      tokenOverride?: string | null,
      baseProjectsOverride?: SyncedProject[],
      silent = false,
    ) => {
      const token = tokenOverride ?? authTokenRef.current;
      if (!token) {
        if (!silent) {
          notify('Trabajando con proyectos locales en el dispositivo');
        }
        return false;
      }
      if (syncInFlightRef.current) return false;
      syncInFlightRef.current = true;
      setCloudSyncing(true);

      const devId = getOrCreateFieldDeviceId();
      let workingProjects = [...(baseProjectsOverride ?? projectsRef.current)];
      let uploadedCount = 0;

      try {
        // 1) Subir proyectos creados o editados offline
        const pending = workingProjects.filter(
          (p) => p.syncState === 'local_only' || p.syncState === 'pending_push',
        );

        for (const prj of pending) {
          const localParcels = loadLocalParcels(prj.id);
          const payload = serializeProjectForCloud(prj, localParcels);
          const { response } = await mobileApiFetch(
            '/api/projects',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'x-device-id': devId,
              },
              body: JSON.stringify({
                id: prj.id.startsWith('local_') ? null : prj.id,
                name: prj.name,
                content: payload,
              }),
            },
            { timeoutMs: 18000 },
          );

          if (response.status === 401) {
            clearSavedAuth();
            setAuthToken(null);
            setUser(null);
            notify('Sesión expirada: inicia sesión nuevamente para sincronizar con Escritorio');
            return false;
          }

          const resData = await response.json().catch(() => ({}));
          if (response.ok && resData.success && resData.projectId) {
            const newId = String(resData.projectId);
            workingProjects = migrateLocalProjectToCloud(
              prj.id,
              newId,
              resData.actualizado,
              workingProjects,
            );
            if (selectedProjectRef.current?.id === prj.id) {
              const migrated = workingProjects.find((x) => x.id === newId) || null;
              setSelectedProject(migrated);
            }
            uploadedCount++;
          }
        }

        // 2) Descargar lista actualizada desde PostgreSQL (Escritorio + Móvil)
        const { response: listRes } = await mobileApiFetch(
          '/api/projects',
          {
            headers: { Authorization: `Bearer ${token}`, 'x-device-id': devId },
          },
          { timeoutMs: 18000 },
        );

        if (listRes.status === 401) {
          clearSavedAuth();
          setAuthToken(null);
          setUser(null);
          notify('Sesión expirada · Inicia sesión para sincronizar con Escritorio');
          return false;
        }

        const listData = await listRes.json().catch(() => ({}));
        if (listRes.ok && listData.success && Array.isArray(listData.projects)) {
          const merged = mergeCloudProjectsWithLocal(listData.projects, workingProjects);
          setProjects(merged);

          if (!selectedProjectRef.current && merged.length > 0) {
            setSelectedProject(merged[0]);
            const cachedFirst = loadLocalParcels(merged[0].id);
            setParcels(cachedFirst);
            setActiveParcelId(cachedFirst[0]?.id ?? null);
          }

          setBackendHealth((prev) => ({
            ...prev,
            navigatorOnline: true,
            serverReachable: true,
            dbConnected: true,
            dbError: null,
          }));

          if (!silent || uploadedCount > 0) {
            notify(
              uploadedCount > 0
                ? `Sincronizado: ${uploadedCount} subido(s) y ${listData.projects.length} proyectos desde Escritorio`
                : `${listData.projects.length} proyectos sincronizados con Escritorio`,
            );
          }

          void precacheCloudProjects(merged, token, devId);
          return true;
        }

        return false;
      } catch {
        if (!silent) {
          notify('Sin conexión al servidor · Proyectos locales disponibles en el dispositivo');
        }
        return false;
      } finally {
        syncInFlightRef.current = false;
        setCloudSyncing(false);
      }
    },
    [notify, precacheCloudProjects],
  );

  // Hydrate persistent device ID, saved session & local projects on boot
  useEffect(() => {
    void notifyOtaAppReady();
    const devId = getOrCreateFieldDeviceId();
    setDeviceId(devId);

    const savedAuth = loadSavedAuth();
    if (savedAuth.token && savedAuth.user) {
      setAuthToken(savedAuth.token);
      setUser(savedAuth.user);
    }

    const cachedProjects = loadLocalProjects();
    if (cachedProjects.length > 0) {
      setProjects(cachedProjects);
      const firstPrj = cachedProjects[0];
      setSelectedProject(firstPrj);
      setCrsMode(firstPrj.defaultCrs || 'regven');
      const cachedParcels = loadLocalParcels(firstPrj.id);
      setParcels(cachedParcels);
      setActiveParcelId(cachedParcels[0]?.id ?? null);
      setSelectedVertexId(cachedParcels[0]?.vertices[0]?.id || 'V-01');
    }

    void (async () => {
      const h = await refreshHealth();
      if (h.dbConnected && savedAuth.token) {
        await syncPendingAndRefresh(savedAuth.token, cachedProjects, true);
      }
    })();
  }, [refreshHealth, syncPendingAndRefresh]);

  // Listen to online / offline & foreground resume to auto-sync with Desktop
  useEffect(() => {
    const handleOnline = () => {
      void (async () => {
        const h = await refreshHealth();
        if (h.dbConnected) {
          if (authTokenRef.current) {
            await syncPendingAndRefresh(authTokenRef.current, projectsRef.current, false);
          } else {
            const pend = projectsRef.current.filter(
              (p) => p.syncState === 'local_only' || p.syncState === 'pending_push',
            ).length;
            if (pend > 0) {
              notify(`Conexión restaurada: inicia sesión para sincronizar ${pend} proyecto(s) con Escritorio`);
            }
          }
        }
      })();
    };

    const handleOffline = () => {
      setBackendHealth((prev) => ({
        ...prev,
        navigatorOnline: false,
        serverReachable: false,
        dbConnected: false,
        dbError: 'Sin conexión a internet en el dispositivo',
      }));
      notify('Modo sin conexión activo · Proyectos locales disponibles');
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false) {
        void (async () => {
          const h = await refreshHealth();
          if (h.dbConnected && authTokenRef.current) {
            const hasPending = projectsRef.current.some(
              (p) => p.syncState === 'local_only' || p.syncState === 'pending_push',
            );
            if (hasPending) {
              await syncPendingAndRefresh(authTokenRef.current, projectsRef.current, false);
            }
          }
        })();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [notify, refreshHealth, syncPendingAndRefresh]);

  // Hardware GNSS real-time watcher
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const activeHuso = activeParcel?.huso || 19;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const utm = geoToUtmGrs80(c.latitude, c.longitude, activeHuso);
        setGnssFix({
          lat: c.latitude,
          lng: c.longitude,
          alt: c.altitude ?? 0,
          accuracy: c.accuracy || 3.5,
          esteRegven: utm.este,
          norteRegven: utm.norte,
          isLiveHardware: true,
          timestamp: pos.timestamp,
          heading: typeof c.heading === 'number' && Number.isFinite(c.heading) ? c.heading : null,
          speed: typeof c.speed === 'number' && Number.isFinite(c.speed) ? c.speed : null,
          altitudeAccuracy:
            typeof c.altitudeAccuracy === 'number' && Number.isFinite(c.altitudeAccuracy)
              ? c.altitudeAccuracy
              : null,
        });
      },
      () => {
        // Sin señal GNSS en interiores
      },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeParcel?.huso]);

  // OTA Update checker (in-app bundle + APK fallback)
  const checkOtaUpdates = useCallback(
    async (manual = false) => {
      setOtaState((prev) => ({ ...prev, checking: true, error: null }));
      const next = await checkOtaManifest();
      setOtaState(next);

      if (next.hasUpdate) {
        setShowOtaModal(true);
      } else if (manual) {
        notify(`GeoGIS6 v${APP_VERSION_NAME} está al día`);
      }
    },
    [notify],
  );

  useEffect(() => {
    void checkOtaUpdates(false);
  }, [checkOtaUpdates]);

  const handleApplyOtaNow = useCallback(async () => {
    if (otaState.installing) return;

    if (otaState.canApplyInApp && otaState.bundleUrl) {
      setOtaState((prev) => ({ ...prev, installing: true, progress: 5, error: null }));
      try {
        await applyOtaBundleInApp(
          {
            bundleUrl: otaState.bundleUrl,
            latestName: otaState.latestName,
            bundleSha256: otaState.bundleSha256,
          },
          (pct) => {
            setOtaState((prev) => ({ ...prev, progress: pct }));
          },
        );
      } catch (err: any) {
        setOtaState((prev) => ({
          ...prev,
          installing: false,
          progress: 0,
          error:
            err?.message ||
            'No se pudo descargar la actualización en línea. Verifica tu conexión.',
        }));
      }
      return;
    }

    if (otaState.requiresApkUpdate) {
      window.open(otaState.apkDownloadUrl, '_blank');
      return;
    }

    window.location.reload();
  }, [otaState]);

  // Cargar parcelas de un proyecto seleccionado (con caché local automática)
  const loadProjectContent = useCallback(
    async (project: SyncedProject, tokenOverride?: string | null) => {
      const token = tokenOverride ?? authTokenRef.current;
      const localCached = loadLocalParcels(project.id);

      // Si es proyecto local o tiene cambios pendientes, priorizar los datos del dispositivo
      if (
        project.source === 'local' ||
        project.syncState === 'local_only' ||
        project.syncState === 'pending_push'
      ) {
        setParcels(localCached);
        setActiveParcelId(localCached[0]?.id ?? null);
        setSelectedVertexId(localCached[0]?.vertices[0]?.id || 'V-01');
        setMapFitTrigger((n) => n + 1);
        return;
      }

      if (!token) {
        setParcels(localCached);
        setActiveParcelId(localCached[0]?.id ?? null);
        setSelectedVertexId(localCached[0]?.vertices[0]?.id || 'V-01');
        setMapFitTrigger((n) => n + 1);
        if (localCached.length > 0) {
          notify(`Offline: ${localCached.length} parcelas cargadas desde el dispositivo`);
        } else {
          notify(`Proyecto "${project.name}" sin caché local aún`);
        }
        return;
      }

      setCloudSyncing(true);
      try {
        const { response } = await mobileApiFetch(
          `/api/projects?id=${encodeURIComponent(project.id)}`,
          {
            headers: { Authorization: `Bearer ${token}`, 'x-device-id': deviceId },
          },
          { timeoutMs: 15000 },
        );
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success && data.content) {
          const parsedParcels = parseCloudProjectParcels(data.content, project.name);
          saveLocalParcels(project.id, parsedParcels);
          setParcels(parsedParcels);
          setActiveParcelId(parsedParcels[0]?.id ?? null);
          setSelectedVertexId(parsedParcels[0]?.vertices[0]?.id || 'V-01');
          setMapFitTrigger((n) => n + 1);
          setProjects((prev) => {
            const next = prev.map((pr) =>
              pr.id === project.id
                ? {
                    ...pr,
                    parcelsText:
                      parsedParcels.length === 0
                        ? '0 Parcelas (Vacío · Cloud)'
                        : `${parsedParcels.length} Parcelas cargadas`,
                  }
                : pr,
            );
            saveLocalProjects(next);
            return next;
          });
          notify(
            parsedParcels.length > 0
              ? `${parsedParcels.length} parcelas cargadas en el mapa`
              : `Proyecto "${project.name}" listo (sin parcelas aún)`,
          );
          return;
        }
        throw new Error('No se pudo cargar desde la nube');
      } catch {
        setParcels(localCached);
        setActiveParcelId(localCached[0]?.id ?? null);
        setSelectedVertexId(localCached[0]?.vertices[0]?.id || 'V-01');
        setMapFitTrigger((n) => n + 1);
        if (localCached.length > 0) {
          notify(`Offline: ${localCached.length} parcelas cargadas desde el dispositivo`);
        } else {
          notify('Sin conexión al servidor · El proyecto aún no está cacheado en este dispositivo');
        }
      } finally {
        setCloudSyncing(false);
      }
    },
    [deviceId, notify],
  );

  const handleRefreshProjects = useCallback(async () => {
    const h = await refreshHealth();
    if (!authTokenRef.current) {
      notify(
        h.dbConnected
          ? 'Inicia sesión para sincronizar con PostgreSQL / Escritorio'
          : 'Sin conexión · Mostrando proyectos alojados en el dispositivo',
      );
      return;
    }
    await syncPendingAndRefresh(authTokenRef.current, projectsRef.current, false);
  }, [notify, refreshHealth, syncPendingAndRefresh]);

  const handleLoginCloud = useCallback(
    async (email: string, password: string) => {
      const devId = getOrCreateFieldDeviceId();
      let response: Response;
      try {
        const resObj = await mobileApiFetch(
          '/api/auth/apk-login',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-device-id': devId },
            body: JSON.stringify({ email, password, deviceId: devId }),
          },
          { timeoutMs: 20000, onStatus: (msg) => notify(msg) },
        );
        response = resObj.response;
      } catch (err: any) {
        await refreshHealth();
        throw new Error(
          navigator.onLine === false
            ? 'Sin conexión a internet. Usa "Trabajar sin conexión" para acceder a tus proyectos locales.'
            : err?.message || 'No se pudo conectar con los servidores de GeoGIS6.',
        );
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.token || !data.user) {
        throw new Error(data.error || 'Credenciales inválidas');
      }

      saveSavedAuth(data.token, data.user);
      setAuthToken(data.token);
      setUser(data.user);
      setBackendHealth((prev) => ({
        ...prev,
        navigatorOnline: true,
        serverReachable: true,
        dbConnected: true,
        dbError: null,
      }));

      // Si había proyectos creados localmente offline, subirlos y sincronizar con Escritorio
      const currentLocal = loadLocalProjects();
      const hasPending = currentLocal.some(
        (p) => p.syncState === 'local_only' || p.syncState === 'pending_push',
      );

      if (hasPending) {
        await syncPendingAndRefresh(data.token, currentLocal, false);
      } else if (Array.isArray(data.projects)) {
        const merged = mergeCloudProjectsWithLocal(data.projects, currentLocal);
        setProjects(merged);
        if (merged.length > 0) {
          setSelectedProject(merged[0]);
          void loadProjectContent(merged[0], data.token);
        } else {
          setSelectedProject(null);
          setParcels([]);
          setActiveParcelId(null);
        }
        void precacheCloudProjects(merged, data.token, devId);
      }

      setActiveScreen('mapa');
      notify(`Bienvenido ${data.user.nombre || data.user.username}`);
    },
    [loadProjectContent, notify, precacheCloudProjects, refreshHealth, syncPendingAndRefresh],
  );

  const handleLogout = useCallback(() => {
    clearSavedAuth();
    setAuthToken(null);
    setUser(null);
    // Conserva los proyectos alojados en el dispositivo
    const deviceProjects = loadLocalProjects();
    setProjects(deviceProjects);
    notify('Sesión cerrada · Proyectos locales conservados en el dispositivo');
  }, [notify]);

  const handleCreateEmptyProject = useCallback(
    async (input: { name: string; defaultCrs: CrsMode; sectorLabel?: string }) => {
      const { project, projects: nextList } = createEmptyOfflineProject(input);
      setProjects(nextList);
      setSelectedProject(project);
      setCrsMode(project.defaultCrs);
      setParcels([]);
      setActiveParcelId(null);
      setSelectedVertexId('V-01');
      setMapFitTrigger((n) => n + 1);

      if (authTokenRef.current && navigator.onLine !== false) {
        notify(`Creando "${project.name}" y sincronizando con Escritorio...`);
        await syncPendingAndRefresh(authTokenRef.current, nextList, false);
      } else {
        notify(`Proyecto "${project.name}" creado offline · Se sincronizará al conectar`);
      }
      setActiveScreen('mapa');
    },
    [notify, syncPendingAndRefresh],
  );

  const handleCreateStarterParcelFromGps = useCallback(() => {
    const prj = selectedProjectRef.current;
    if (!prj) {
      setActiveScreen('auth');
      return;
    }

    const lat = gnssFix.isLiveHardware ? gnssFix.lat : VENEZUELA_DEFAULT_CENTER.lat;
    const lng = gnssFix.isLiveHardware ? gnssFix.lng : VENEZUELA_DEFAULT_CENTER.lng;
    const utm = geoToUtmGrs80(lat, lng, 19);
    const parcelCode = `P-${String(parcels.length + 1).padStart(2, '0')}`;
    const starter = buildFieldParcelFromVertices({
      id: `parcel_${Date.now().toString(36)}`,
      code: parcelCode,
      location: prj.name,
      sector: prj.sectorLabel || 'Levantamiento de Campo',
      zoneTag: 'Puntos',
      owner: user?.nombre || 'Operador de Campo',
      huso: 19,
      geometryType: 'puntos',
      rawVertices: [
        {
          id: 'V-01',
          shortId: 'V1',
          code: 'Hito_1',
          description: gnssFix.isLiveHardware
            ? 'Punto capturado con GNSS del dispositivo'
            : 'Punto inicial de proyecto',
          esteRegven: utm.este,
          norteRegven: utm.norte,
          lat,
          lng,
          cota: gnssFix.alt || 0,
        },
      ],
    });

    const nextParcels = [...parcels, starter];
    saveLocalParcels(prj.id, nextParcels);
    const nextProjects = markProjectPendingPush(prj.id, nextParcels.length, projectsRef.current);
    setProjects(nextProjects);
    setSelectedProject(nextProjects.find((x) => x.id === prj.id) || prj);
    setParcels(nextParcels);
    setActiveParcelId(starter.id);
    setSelectedVertexId(starter.vertices[0].id);
    setMapFitTrigger((n) => n + 1);

    notify(`Parcela ${starter.code} creada en el dispositivo`);
  }, [gnssFix, notify, parcels, user?.nombre]);

  const handleSaveCurrentToCloud = useCallback(async () => {
    const prj = selectedProjectRef.current;
    if (!prj) {
      notify('Selecciona o crea un proyecto primero');
      return;
    }
    saveLocalParcels(prj.id, parcels);
    const nextProjects = markProjectPendingPush(prj.id, parcels.length, projectsRef.current);
    setProjects(nextProjects);

    if (!authTokenRef.current) {
      notify('Guardado en el dispositivo · Inicia sesión para sincronizar con Escritorio');
      return;
    }
    await syncPendingAndRefresh(authTokenRef.current, nextProjects, false);
  }, [notify, parcels, syncPendingAndRefresh]);

  const handleToggleCrs = () => {
    setCrsMode((prev) => {
      const next = prev === 'regven' ? 'psad56' : 'regven';
      notify(
        next === 'regven'
          ? 'Sistema activo: REGVEN 19N (RIGIDA02)'
          : 'Sistema activo: PSAD56 La Canoa 19N',
      );
      return next;
    });
  };

  const handleSelectProject = (project: SyncedProject, openMap = true) => {
    setSelectedProject(project);
    setCrsMode(project.defaultCrs);
    if (openMap) setActiveScreen('mapa');
    void loadProjectContent(project);
  };

  const handleWorkOffline = () => {
    if (selectedProject) {
      setActiveScreen('mapa');
      void loadProjectContent(selectedProject);
      return;
    }
    if (projects.length > 0) {
      handleSelectProject(projects[0], true);
      return;
    }
    notify('Crea un proyecto vacío offline primero para abrir el mapa');
  };

  const handleSelectParcel = (parcelId: string) => {
    const found = parcels.find((p) => p.id === parcelId);
    if (!found) return;
    setActiveParcelId(found.id);
    setSelectedVertexId(found.vertices[0]?.id || 'V-01');
  };

  const handleStakeVertex = (vertexId: string) => {
    if (!activeParcel) return;
    setSelectedVertexId(vertexId);
    setActiveScreen('localizacion');
    notify(`Objetivo RTK fijado: ${vertexId} (${activeParcel.code})`);
  };

  const handleCaptureCurrentVertex = (averagedFix?: Partial<LiveGnssFix>) => {
    const fixLat = averagedFix?.lat ?? gnssFix.lat;
    const fixLng = averagedFix?.lng ?? gnssFix.lng;
    const fixAlt = averagedFix?.alt ?? gnssFix.alt;
    const fixEste = averagedFix?.esteRegven ?? gnssFix.esteRegven;
    const fixNorte = averagedFix?.norteRegven ?? gnssFix.norteRegven;
    const isLive = averagedFix?.isLiveHardware ?? gnssFix.isLiveHardware;

    if (!activeParcel || !selectedProject || !isLive) return;

    const nextParcels = parcels.map((p) => {
      if (p.id !== activeParcel.id) return p;
      const updatedVertices = p.vertices.map((v) =>
        v.id === selectedVertexId
          ? {
              ...v,
              esteRegven: fixEste,
              norteRegven: fixNorte,
              lat: fixLat,
              lng: fixLng,
              cota: Math.round(fixAlt * 100) / 100,
            }
          : v,
      );
      return buildFieldParcelFromVertices({
        id: p.id,
        code: p.code,
        location: p.location,
        sector: p.sector,
        zoneTag: p.zoneTag,
        owner: p.owner,
        cadastralId: p.cadastralId,
        huso: p.huso,
        areaDocumentalM2: p.areaDocumentalM2,
        geometryType: p.geometryType,
        rawVertices: updatedVertices.map((v) => ({
          id: v.id,
          shortId: v.shortId,
          code: v.code,
          description: v.description,
          esteRegven: v.esteRegven,
          norteRegven: v.norteRegven,
          lat: v.lat,
          lng: v.lng,
          cota: v.cota,
        })),
      });
    });

    setParcels(nextParcels);
    saveLocalParcels(selectedProject.id, nextParcels);
    const nextProjects = markProjectPendingPush(
      selectedProject.id,
      nextParcels.length,
      projectsRef.current,
    );
    setProjects(nextProjects);
  };

  const handleAddVertexFromGps = (averagedFix?: Partial<LiveGnssFix>) => {
    const fixLat = averagedFix?.lat ?? gnssFix.lat;
    const fixLng = averagedFix?.lng ?? gnssFix.lng;
    const fixAlt = averagedFix?.alt ?? gnssFix.alt;
    const fixEste = averagedFix?.esteRegven ?? gnssFix.esteRegven;
    const fixNorte = averagedFix?.norteRegven ?? gnssFix.norteRegven;
    const isLive = averagedFix?.isLiveHardware ?? gnssFix.isLiveHardware;

    if (!activeParcel || !selectedProject || !isLive) return;

    const nextIndex = activeParcel.vertices.length + 1;
    const newId = `V-${String(nextIndex).padStart(2, '0')}`;
    const newShort = `V${nextIndex}`;

    const nextParcels = parcels.map((p) => {
      if (p.id !== activeParcel.id) return p;
      const combined = [
        ...p.vertices.map((v) => ({
          id: v.id,
          shortId: v.shortId,
          code: v.code,
          description: v.description,
          esteRegven: v.esteRegven,
          norteRegven: v.norteRegven,
          lat: v.lat,
          lng: v.lng,
          cota: v.cota,
        })),
        {
          id: newId,
          shortId: newShort,
          code: `Hito_${nextIndex}`,
          description: 'Vértice levantado con GPS en campo',
          esteRegven: fixEste,
          norteRegven: fixNorte,
          lat: fixLat,
          lng: fixLng,
          cota: Math.round(fixAlt * 100) / 100,
        },
      ];
      return buildFieldParcelFromVertices({
        id: p.id,
        code: p.code,
        location: p.location,
        sector: p.sector,
        zoneTag: combined.length >= 3 ? 'Polígono' : p.zoneTag,
        owner: p.owner,
        cadastralId: p.cadastralId,
        huso: p.huso,
        areaDocumentalM2: p.areaDocumentalM2,
        geometryType: combined.length >= 3 ? 'cerrada' : combined.length === 2 ? 'abierta' : 'puntos',
        rawVertices: combined,
      });
    });

    setParcels(nextParcels);
    setSelectedVertexId(newId);
    saveLocalParcels(selectedProject.id, nextParcels);
    const nextProjects = markProjectPendingPush(
      selectedProject.id,
      nextParcels.length,
      projectsRef.current,
    );
    setProjects(nextProjects);
    notify(`Nuevo vértice ${newId} agregado a ${activeParcel.code}`);
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
                    rtkReconverging
                      ? 'text-[#ffb95f]'
                      : backendHealth.dbConnected
                        ? 'text-[#4edea3]'
                        : 'text-[#ffb95f]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full inline-block animate-pulse ${
                      rtkReconverging || !backendHealth.dbConnected ? 'bg-[#ffb95f]' : 'bg-[#4edea3]'
                    }`}
                  />
                  {rtkReconverging
                    ? 'RTK FLOAT · CONVERGIENDO...'
                    : gnssFix.isLiveHardware
                      ? `GNSS LIVE · ±${gnssFix.accuracy.toFixed(1)}M`
                      : backendHealth.dbConnected
                        ? 'CLOUD SYNC OK'
                        : 'MODO LOCAL DISPOSITIVO'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {pendingSyncCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleRefreshProjects()}
                  title="Sincronizar proyectos pendientes"
                  className="px-2 py-1 rounded bg-[#ffb95f]/20 border border-[#ffb95f]/50 text-[#ffb95f] font-stitch-mono text-[9.5px] font-bold flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${cloudSyncing ? 'animate-spin' : ''}`} />
                  {pendingSyncCount}
                </button>
              )}

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
            backendHealth={backendHealth}
            pendingSyncCount={pendingSyncCount}
            otaHasUpdate={otaState.hasUpdate}
            otaLatestName={otaState.latestName}
            onSelectProject={handleSelectProject}
            onLoginCloud={handleLoginCloud}
            onWorkOffline={handleWorkOffline}
            onCreateEmptyProject={handleCreateEmptyProject}
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
            parcels={parcels}
            activeParcel={activeParcel}
            selectedVertexId={selectedVertexId}
            crsMode={crsMode}
            gnssFix={gnssFix}
            fitTrigger={mapFitTrigger}
            onToggleCrs={handleToggleCrs}
            onSelectParcel={handleSelectParcel}
            onOpenParcel={() => setActiveScreen('parcela')}
            onOpenProjects={() => setActiveScreen('auth')}
            onCreateStarterParcel={handleCreateStarterParcelFromGps}
            onStakeVertex={handleStakeVertex}
            onCenterGps={() =>
              notify(
                gnssFix.isLiveHardware
                  ? `Centrado en GPS Real (${gnssFix.esteRegven.toFixed(2)}E, ${gnssFix.norteRegven.toFixed(2)}N)`
                  : activeParcel
                    ? `Centrado en Parcela ${activeParcel.code}`
                    : 'Centrado en mapa',
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
            onToggleCrs={handleToggleCrs}
            onBackToMap={() => setActiveScreen('mapa')}
            onOpenProjects={() => setActiveScreen('auth')}
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
            onAddVertexFromGps={handleAddVertexFromGps}
            onOpenProjects={() => setActiveScreen('auth')}
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
                  : 'Receptor interno Android L1+L5 activo',
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

      {/* OTA In-App Auto-Update Modal */}
      {showOtaModal && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#151b2b] border border-[#4edea3]/45 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#242a3a] flex items-center justify-between bg-[#0d1322]">
              <span className="font-stitch-headline text-[14px] font-bold text-[#dde2f8]">
                {otaState.hasUpdate
                  ? 'Nueva actualización disponible'
                  : 'Actualizaciones GeoGIS6'}
              </span>
              {!otaState.installing && (
                <button
                  type="button"
                  onClick={() => setShowOtaModal(false)}
                  className="w-7 h-7 rounded bg-[#242a3a] text-[#bcc9cd] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="p-4 space-y-3">
              {otaState.hasUpdate && (
                <p className="text-[12px] text-[#dde2f8] leading-snug">
                  Está disponible la versión <strong className="text-[#4edea3]">v{otaState.latestName}</strong>.
                  {otaState.canApplyInApp
                    ? ' ¿Deseas descargarla e instalarla en línea dentro de la app?'
                    : otaState.requiresApkUpdate
                      ? ' Esta versión incluye cambios nativos y requiere descargar el instalador APK.'
                      : ' ¿Deseas actualizar ahora?'}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 font-stitch-mono text-[10px]">
                <div className="p-2.5 rounded-lg bg-[#080e1d] border border-[#242a3a]">
                  <span className="text-[#869397] block">INSTALADA</span>
                  <strong className="text-[#dde2f8] text-xs">v{APP_VERSION_NAME}</strong>
                  <span className="text-[9px] text-[#869397] block">Build {APP_VERSION_CODE}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#080e1d] border border-[#4edea3]/40">
                  <span className="text-[#869397] block">DISPONIBLE</span>
                  <strong className="text-[#4edea3] text-xs">v{otaState.latestName}</strong>
                  <span className="text-[9px] text-[#869397] block">Build {otaState.latestCode}</span>
                </div>
              </div>

              <p className="p-2.5 rounded-lg bg-[#080e1d] text-[11px] text-[#bcc9cd] max-h-24 overflow-y-auto">
                {otaState.notes}
              </p>

              {otaState.installing && (
                <div className="space-y-1.5">
                  <div className="flex justify-between font-stitch-mono text-[10px] text-[#4edea3]">
                    <span>Descargando actualización en línea...</span>
                    <span>{otaState.progress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#080e1d] overflow-hidden border border-[#242a3a]">
                    <div
                      className="h-full bg-[#4edea3] transition-all duration-200"
                      style={{ width: `${otaState.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {otaState.error && (
                <div className="p-2 rounded bg-rose-500/15 border border-rose-500/40 font-stitch-mono text-[10px] text-rose-300">
                  {otaState.error}
                </div>
              )}

              {otaState.hasUpdate ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={otaState.installing}
                    onClick={() => setShowOtaModal(false)}
                    className="py-2.5 rounded-xl bg-[#242a3a] text-[#bcc9cd] font-stitch-headline font-bold text-xs disabled:opacity-40"
                  >
                    Más tarde
                  </button>
                  <button
                    type="button"
                    disabled={otaState.installing}
                    onClick={() => void handleApplyOtaNow()}
                    className="py-2.5 rounded-xl bg-[#4edea3] text-[#003824] font-stitch-headline font-bold text-xs flex items-center justify-center gap-1 disabled:opacity-60"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {otaState.installing ? 'Actualizando...' : 'Actualizar ahora'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void checkOtaUpdates(true)}
                  className="w-full py-2.5 rounded-xl bg-[#242a3a] text-[#4cd7f6] font-stitch-headline font-bold text-xs"
                >
                  {otaState.checking ? 'Buscando...' : 'Verificar nuevamente'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
