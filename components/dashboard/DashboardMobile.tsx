'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore, type Parcel } from '@/lib/store';
import {
  Map as MapIcon,
  User,
  LogOut,
  Trash2,
  Shield,
  UserCircle,
  ChevronDown,
  Mountain,
  Printer,
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
import { FileService } from '@/lib/file-service';
import { exportResultsToDXF } from '@/lib/exportDxf';
import { useContourStore } from '@/src/components/map/contours/useContourStore';
import TransformationForm from '@/components/dashboard/TransformationForm';
import BatchImport from '@/components/dashboard/BatchImport';
import DxfImportModal from '@/components/dashboard/DxfImportModal';
import ResultsTable from '@/components/dashboard/ResultsTable';
import ParcelList from '@/components/dashboard/ParcelList';
import ProjectManager from '@/components/dashboard/ProjectManager';
import BottomNavMobile, { type MobileTab } from './BottomNavMobile';
import MobileBottomSheet from './MobileBottomSheet';

const MapViewer = dynamic(() => import('@/src/components/MapViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-slate-900 animate-pulse flex items-center justify-center text-slate-500 font-mono tracking-widest uppercase text-xs">
      Cargando Motor Gráfico OpenLayers...
    </div>
  ),
});

const ProfileModalLazy = dynamic(() => import('./ProfileModal'), { ssr: false });

export default function DashboardMobile() {
  const method = useAppStore((s) => s.method);
  const clearProjectWorkspace = useAppStore((s) => s.clearProjectWorkspace);
  const setUser = useAppStore((s) => s.setUser);
  const user = useAppStore((s) => s.user);

  const [activeTab, setActiveTab] = useState<MobileTab>('map');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const disconnectingRef = useRef(false);
  const meAbortRef = useRef<AbortController | null>(null);
  const lastUnloadBeaconRef = useRef<number>(0);
  const lastKnownUserIdRef = useRef<string>('');

  const canonicalRole = normalizeUserRole(user?.rol);
  const isDemo = isDemoRole(user?.rol);
  const roleInfo = ROLE_PERMISSIONS_MATRIX[canonicalRole];

  const forceDisconnect = useCallback(
    async (isSuspended = false, denyReason?: string) => {
      if (disconnectingRef.current) return;
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
          body: JSON.stringify({
            deviceId: currentDeviceId,
            userId: currentUserId,
          }),
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
    [clearProjectWorkspace, setUser]
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

  useEffect(() => {
    let isMounted = true;
    let initialSynced = false;

    const sendDisconnectOnlySignal = () => {
      if (disconnectingRef.current) return;
      const now = Date.now();
      if (now - lastUnloadBeaconRef.current < 800) return;
      lastUnloadBeaconRef.current = now;

      if (meAbortRef.current) {
        meAbortRef.current.abort();
        meAbortRef.current = null;
      }

      try {
        const deviceId = getOrCreateDeviceId();
        const userId = useAppStore.getState().user?.id || lastKnownUserIdRef.current || '';
        if (!userId) return;
        const url = `/api/auth/logout?mode=disconnect_only&deviceId=${encodeURIComponent(deviceId)}&userId=${encodeURIComponent(userId)}`;
        const payload = JSON.stringify({ deviceId, userId });

        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
          navigator.sendBeacon(url, blob);
        } else {
          void fetch(url, {
            method: 'POST',
            keepalive: true,
            headers: { 'x-device-id': deviceId },
            body: payload,
          }).catch(() => {});
        }
      } catch {
        // Ignore unload beacon errors
      }
    };

    const verifySessionAndSync = async (isResume = false) => {
      if (!isMounted || disconnectingRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && initialSynced && !isResume) {
        return;
      }

      if (meAbortRef.current) {
        meAbortRef.current.abort();
      }
      const controller = new AbortController();
      meAbortRef.current = controller;

      try {
        const deviceId = getOrCreateDeviceId();
        const query = !initialSynced
          ? `/api/auth/me?includeProjects=1&t=${Date.now()}`
          : isResume
            ? `/api/auth/me?resume=1&t=${Date.now()}`
            : `/api/auth/me?t=${Date.now()}`;

        const res = await fetch(query, {
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            Pragma: 'no-cache',
            'x-device-id': deviceId,
          },
        });
        const data = await res.json().catch(() => ({}));

        if (!isMounted || disconnectingRef.current || controller.signal.aborted) return;

        if (
          res.status === 401 ||
          res.status === 403 ||
          !data.success ||
          !data.user ||
          data.suspended ||
          data.user.activo === false
        ) {
          if (data?.reason === 'DEVICE_LIMIT_EXCEEDED' || data?.reason === 'CONCURRENT_IP_ABUSE') {
            toast.error(data.error || 'Límite de terminales autorizados alcanzado.');
          }
          const suspended = Boolean(data?.suspended || res.status === 403 || data?.user?.activo === false);
          await forceDisconnect(suspended, data?.reason);
          return;
        }

        if (!isMounted) return;

        if (data.user.id) {
          lastKnownUserIdRef.current = String(data.user.id);
        }
        if (data.user.roleConfig) {
          applyDynamicRoleConfig(data.user.rol, data.user.roleConfig);
        }

        const prevOwnerId = useAppStore.getState().ownerUserId;
        setUser(data.user);

        if (!initialSynced) {
          initialSynced = true;
          const sessionKey = `gt_active_session_${data.user.id}`;
          const isNewSession = typeof window !== 'undefined' && sessionStorage.getItem(sessionKey) !== '1';
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(sessionKey, '1');
            if (prevOwnerId !== data.user.id) {
              localStorage.removeItem('transforven_project');
            }
          }

          const userProjects = Array.isArray(data.projects) ? data.projects : [];
          const { currentProjectId } = useAppStore.getState();

          if (userProjects.length === 0) {
            if (currentProjectId !== null || isNewSession || prevOwnerId !== data.user.id) {
              clearProjectWorkspace();
              if (typeof window !== 'undefined') {
                localStorage.removeItem('transforven_project');
              }
            }
          } else if (currentProjectId && !userProjects.some((p: any) => p.id === currentProjectId)) {
            clearProjectWorkspace();
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Error verifying session:', err);
        }
      }
    };

    verifySessionAndSync(true);

    const intervalId = setInterval(() => {
      verifySessionAndSync(false);
    }, 8000);

    const handleFocus = () => verifySessionAndSync(true);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') verifySessionAndSync(true);
    };
    const handleSuspendedEvent = () => forceDisconnect(true);
    const handleUnloadOrHide = () => sendDisconnectOnlySignal();

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('geotrans:session-suspended', handleSuspendedEvent);
    window.addEventListener('pagehide', handleUnloadOrHide);
    window.addEventListener('beforeunload', handleUnloadOrHide);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      if (meAbortRef.current) meAbortRef.current.abort();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('geotrans:session-suspended', handleSuspendedEvent);
      window.removeEventListener('pagehide', handleUnloadOrHide);
      window.removeEventListener('beforeunload', handleUnloadOrHide);
    };
  }, [setUser, clearProjectWorkspace, forceDisconnect]);

  const handleClearCache = () => {
    if (window.confirm('¿Limpiar la caché y restablecer el espacio de trabajo móvil?')) {
      clearProjectWorkspace();
      if (typeof window !== 'undefined') {
        localStorage.removeItem('transforven_project');
      }
      setShowUserMenu(false);
    }
  };

  const sheetTitle =
    activeTab === 'settings'
      ? 'Ajustes Geodésicos'
      : activeTab === 'results'
        ? 'Resultados y Exportación'
        : 'Proyectos y Parcelas';

  return (
    <div className="flex flex-col h-[100dvh] w-screen bg-[#0a0f18] text-slate-200 overflow-hidden select-none font-sans relative">
      {/* Mobile Header */}
      <header className="fixed top-0 left-0 right-0 h-14 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <MapIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-white uppercase block leading-none">
              GeoGIS<span className="text-emerald-400">6</span>{' '}
              <span className="text-[10px] font-mono text-cyan-400">Mobile</span>
            </span>
            <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
              {method === 'rigida02' ? 'RIGIDA02 Adícora' : method === 'badekas' ? 'Badekas 3D' : 'Rígida IDW'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDemo && (
            <span className="px-2 py-0.5 bg-amber-500/15 border border-amber-500/40 rounded-full text-[9px] font-bold text-amber-300 uppercase">
              DEMO
            </span>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 hover:border-emerald-500 flex items-center justify-center"
            >
              <User className="w-4 h-4 text-slate-300" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-10 mt-1 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-[100]">
                <div className="p-3 border-b border-slate-800">
                  <h4 className="text-xs font-bold text-slate-200 truncate">{user?.nombre || 'Usuario Campo'}</h4>
                  <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-widest mt-0.5">
                    {roleInfo?.label || 'Operador de Campo'}
                  </p>
                </div>
                <div className="p-1 border-b border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowProfile(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg text-left"
                  >
                    <UserCircle className="w-4 h-4 text-emerald-400" />
                    <span>Perfil y contraseña</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toast(`Rol: ${roleInfo?.label}`, { icon: '🛡️' });
                      setShowUserMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg text-left"
                  >
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span>Permisos de Licencia</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearCache}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-300 hover:bg-slate-800 rounded-lg text-left"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Limpiar Caché Local</span>
                  </button>
                </div>
                <div className="p-1">
                  <button
                    type="button"
                    onClick={() => forceDisconnect(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-lg text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Cerrar Sesión</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {showUserMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
      )}

      {showProfile && (
        <ProfileModalLazy open={showProfile} onClose={() => setShowProfile(false)} />
      )}

      {/* Fullscreen Map Viewport */}
      <main className="flex-1 w-full pt-14 pb-20 relative bg-slate-950/20 overflow-hidden">
        <MapViewer className="w-full h-full" />

        <MobileBottomSheet
          isOpen={activeTab !== 'map'}
          title={sheetTitle}
          onClose={() => setActiveTab('map')}
        >
          {activeTab === 'settings' && <MobileSettingsPanel />}
          {activeTab === 'results' && <MobileResultsPanel />}
          {activeTab === 'projects' && <ProjectManager />}
        </MobileBottomSheet>
      </main>

      <BottomNavMobile activeTab={activeTab} onSelectTab={setActiveTab} />
    </div>
  );
}

function MobileSettingsPanel() {
  const routine = useAppStore((s) => s.routine);
  const setRoutine = useAppStore((s) => s.setRoutine);
  const direction = useAppStore((s) => s.direction);
  const setDirection = useAppStore((s) => s.setDirection);
  const method = useAppStore((s) => s.method);
  const setMethod = useAppStore((s) => s.setMethod);
  const coordType = useAppStore((s) => s.coordType);
  const setCoordType = useAppStore((s) => s.setCoordType);
  const geometryType = useAppStore((s) => s.geometryType);
  const setGeometryType = useAppStore((s) => s.setGeometryType);
  const clearResults = useAppStore((s) => s.clearResults);
  const huso = useAppStore((s) => s.huso);
  const setHuso = useAppStore((s) => s.setHuso);
  const hatchColor = useAppStore((s) => s.hatchColor);
  const hatchOpacity = useAppStore((s) => s.hatchOpacity);
  const setHatch = useAppStore((s) => s.setHatch);

  const [activeMode, setActiveMode] = useState<'individual' | 'batch' | 'dxf'>('individual');
  const [dxfModalOpen, setDxfModalOpen] = useState(false);

  useEffect(() => {
    if (activeMode === 'dxf') {
      setDxfModalOpen(true);
      setActiveMode('individual');
    }
  }, [activeMode]);

  return (
    <div className="py-2 space-y-6">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Rutina</h3>
          <div className="flex gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setRoutine('transform')}
              className={cn(
                'px-2.5 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase transition-all',
                routine === 'transform' ? 'bg-emerald-500 text-white' : 'text-slate-500'
              )}
            >
              Transformación
            </button>
            <button
              type="button"
              onClick={() => setRoutine('ploteo')}
              className={cn(
                'px-2.5 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase transition-all',
                routine === 'ploteo' ? 'bg-emerald-500 text-white' : 'text-slate-500'
              )}
            >
              Ploteo
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Modo</h3>
          <div className="flex gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveMode('individual')}
              className={cn(
                'px-2.5 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase transition-all',
                activeMode === 'individual' ? 'bg-emerald-500 text-white' : 'text-slate-500'
              )}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('batch')}
              className={cn(
                'px-2.5 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase transition-all',
                activeMode === 'batch' ? 'bg-emerald-500 text-white' : 'text-slate-500'
              )}
            >
              Lotes
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('dxf')}
              className="px-2.5 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase text-amber-400 border border-amber-500/30"
            >
              DXF
            </button>
          </div>
        </div>

        {routine === 'transform' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Dirección</label>
              <div className="relative">
                <select
                  value={direction}
                  onChange={(e) => {
                    const dir = e.target.value as any;
                    setDirection(dir);
                    clearResults();
                    if (dir === 'dma_psad56_real') setMethod('dma_badekas');
                    else if (dir === 'dma_regven') setMethod('dma_badekas_regven');
                    else if (method === 'dma_badekas' || method === 'dma_badekas_regven') setMethod('badekas');
                  }}
                  className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm appearance-none"
                >
                  <option value="canoa_regven">La Canoa → REGVEN</option>
                  <option value="regven_canoa">REGVEN → La Canoa</option>
                  <option value="dma_psad56_real">DMA → PSAD56_REAL</option>
                  <option value="dma_regven">DMA → REGVEN/SIRGAS</option>
                </select>
                <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {!direction.startsWith('dma_') && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Método</label>
                <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => { setMethod('badekas'); clearResults(); }}
                    className={cn(
                      'py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider',
                      method === 'badekas' ? 'bg-emerald-500 text-white' : 'text-slate-500'
                    )}
                  >
                    Badekas
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMethod('rigida'); clearResults(); }}
                    className={cn(
                      'py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider',
                      method === 'rigida' ? 'bg-emerald-500 text-white' : 'text-slate-500'
                    )}
                  >
                    Rígida
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMethod('rigida02'); clearResults(); }}
                    className={cn(
                      'py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider',
                      method === 'rigida02' ? 'bg-cyan-500 text-white' : 'text-slate-500'
                    )}
                  >
                    Rígida 02
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase">Poligonal</label>
          <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
            {(['cerrada', 'abierta', 'puntos'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setGeometryType(type)}
                className={cn(
                  'py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg',
                  geometryType === type ? 'bg-emerald-500 text-white' : 'text-slate-500'
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase">Huso UTM Venezuela</label>
          <div className="grid grid-cols-4 gap-2">
            {[18, 19, 20, 21].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHuso(h)}
                className={cn(
                  'py-1.5 rounded-lg text-xs font-mono font-bold border',
                  huso === h
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : 'bg-slate-950/70 border-slate-800 text-slate-400'
                )}
              >
                {h}N
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-950/60 p-2 rounded-xl border border-slate-800">
          <input
            type="color"
            value={hatchColor}
            onChange={(e) => setHatch(e.target.value, hatchOpacity)}
            className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
          />
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(hatchOpacity * 100)}
            onChange={(e) => setHatch(hatchColor, Number(e.target.value) / 100)}
            className="flex-1 h-1 accent-emerald-500"
          />
          <span className="text-[10px] font-mono text-slate-400 w-8 text-right">
            {Math.round(hatchOpacity * 100)}%
          </span>
        </div>
      </section>

      <section className="space-y-3 pt-2 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
            {activeMode === 'individual' ? 'Entrada de Datos' : 'Importación Lotes'}
          </h3>
          <div className="flex gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800">
            {(['utm', 'geo', 'cart'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setCoordType(t)}
                className={cn(
                  'px-2 py-1 rounded-md text-[9px] font-bold tracking-widest uppercase',
                  coordType === t ? 'bg-emerald-500 text-white' : 'text-slate-500'
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {activeMode === 'individual' ? (
          <TransformationForm key={method + direction} />
        ) : (
          <BatchImport key={method + direction} />
        )}
      </section>

      {dxfModalOpen && <DxfImportModal onClose={() => setDxfModalOpen(false)} />}
    </div>
  );
}

function MobileResultsPanel() {
  const [subTab, setSubTab] = useState<'resultados' | 'parcelas'>('resultados');
  const results = useAppStore((s) => s.results);
  const saveCurrentParcel = useAppStore((s) => s.saveCurrentParcel);
  const savedParcels = useAppStore((s) => s.savedParcels);
  const activeParcelId = useAppStore((s) => s.activeParcelId);
  const huso = useAppStore((s) => s.huso);
  const direction = useAppStore((s) => s.direction);
  const routine = useAppStore((s) => s.routine);
  const method = useAppStore((s) => s.method);
  const geometryType = useAppStore((s) => s.geometryType);
  const user = useAppStore((s) => s.user);
  const openPrintModalForParcel = useContourStore((s) => s.openPrintModalForParcel);
  const loadingContourIds = useContourStore((s) => s.loadingParcelIds);

  const geom = useMemo(() => {
    if (results.length <= 2) return { area: 0, perim: 0 };
    return FileService.calculateGeometry(
      results.map((r) => ({ e: r.result?.este ?? 0, n: r.result?.norte ?? 0 }))
    );
  }, [results]);

  const handleExport = async (type: string) => {
    if (results.length === 0) {
      toast.error('No hay resultados para exportar');
      return;
    }
    if (type === 'dxf') {
      if (!hasPermission(user?.rol, 'export_dxf', user?.roleConfig?.capabilities)) {
        toast.error('Su rol no tiene permiso para exportar DXF.');
        return;
      }
      exportResultsToDXF(results, 'PROYECTO_GEO_MOBILE');
      return;
    }
    if (!hasPermission(user?.rol, 'export_csv', user?.roleConfig?.capabilities)) {
      toast.error('Modo DEMO: Descarga de reportes TXT/KML bloqueada.');
      return;
    }
    const name = 'PROYECTO_GEO_MOBILE';
    if (type === 'kml') FileService.exportKML(results, name);
    if (type === 'txt') await FileService.exportTXT(results, name);
  };

  return (
    <div className="space-y-4">
      <div className="flex border-b border-slate-800">
        <button
          type="button"
          onClick={() => setSubTab('resultados')}
          className={cn(
            'flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest border-b-2',
            subTab === 'resultados' ? 'text-emerald-400 border-emerald-500' : 'text-slate-500 border-transparent'
          )}
        >
          Tabla Vértices
        </button>
        <button
          type="button"
          onClick={() => setSubTab('parcelas')}
          className={cn(
            'flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest border-b-2',
            subTab === 'parcelas' ? 'text-emerald-400 border-emerald-500' : 'text-slate-500 border-transparent'
          )}
        >
          Parcelas
        </button>
      </div>

      {subTab === 'resultados' ? <ResultsTable /> : <ParcelList />}

      <div className="p-3.5 bg-slate-800/40 border border-slate-800 rounded-xl space-y-2.5">
        <div className="flex justify-between text-xs">
          <span className="text-slate-400 uppercase text-[10px]">Perímetro:</span>
          <span className="font-mono font-bold text-slate-200">{geom.perim.toFixed(2)} m</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-400 uppercase text-[10px]">Área:</span>
          <span className="font-mono font-bold text-emerald-400">{(geom.area / 10000).toFixed(4)} ha</span>
        </div>
        {results.length > 0 && (
          <button
            type="button"
            onClick={saveCurrentParcel}
            className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-bold text-[10px] uppercase tracking-widest"
          >
            Guardar Parcela en Proyecto
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => handleExport('dxf')}
          className="py-2.5 bg-slate-800 border border-slate-700 text-cyan-400 rounded-lg font-bold text-[10px] uppercase"
        >
          DXF
        </button>
        <button
          type="button"
          onClick={() => handleExport('kml')}
          className="py-2.5 bg-slate-800 border border-slate-700 text-green-400 rounded-lg font-bold text-[10px] uppercase"
        >
          KML
        </button>
        <button
          type="button"
          onClick={() => handleExport('txt')}
          className="py-2.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg font-bold text-[10px] uppercase"
        >
          TXT
        </button>
      </div>

      {results.length >= 3 && (() => {
        const activeSaved = activeParcelId ? savedParcels.find((p) => p.id === activeParcelId) : undefined;
        const targetParcel: Parcel = activeSaved ?? {
          id: 'active',
          nombre: 'Parcela Activa',
          fecha: new Date().toISOString(),
          area: geom.area,
          perim: geom.perim,
          ha: geom.area / 10000,
          puntos: results,
          geometryType,
        };
        const effDir = routine === 'ploteo' || method === 'rigida02' ? 'canoa_regven' : direction;
        const isLoadingActiveContour = loadingContourIds.includes(targetParcel.id);
        return (
          <button
            type="button"
            onClick={() => openPrintModalForParcel(targetParcel, huso, effDir)}
            disabled={isLoadingActiveContour}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg font-bold text-[10px] uppercase tracking-widest disabled:opacity-50"
          >
            {isLoadingActiveContour ? <Mountain className="w-3.5 h-3.5 animate-pulse" /> : <Printer className="w-3.5 h-3.5" />}
            {isLoadingActiveContour ? 'Calculando Curvas...' : 'Plano de Curvas'}
          </button>
        );
      })()}
    </div>
  );
}
