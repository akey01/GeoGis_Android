'use client';

import React, { useState } from 'react';
import {
  ArrowLeftRight,
  BadgeCheck,
  BatteryCharging,
  CheckCircle2,
  Cloud,
  CloudUpload,
  Download,
  Fingerprint,
  FolderKanban,
  Lock,
  LogOut,
  RefreshCw,
  Satellite,
  Signal,
  Terminal,
  UserCheck,
} from 'lucide-react';
import {
  APP_VERSION_CODE,
  APP_VERSION_NAME,
  type CloudUser,
  type SyncedProject,
} from './data/fieldData';

interface AuthProjectsScreenProps {
  deviceId: string;
  user: CloudUser | null;
  projects: SyncedProject[];
  selectedProject: SyncedProject;
  cloudSyncing: boolean;
  otaHasUpdate: boolean;
  otaLatestName: string;
  onSelectProject: (project: SyncedProject, openMap?: boolean) => void;
  onLoginCloud: (email: string, password: string) => Promise<void>;
  onDemoEnter: () => void;
  onLogout: () => void;
  onSaveCurrentToCloud: () => Promise<void>;
  onRefreshProjects: () => Promise<void>;
  onOpenOtaUpdate: () => void;
}

export default function AuthProjectsScreen({
  deviceId,
  user,
  projects,
  selectedProject,
  cloudSyncing,
  otaHasUpdate,
  otaLatestName,
  onSelectProject,
  onLoginCloud,
  onDemoEnter,
  onLogout,
  onSaveCurrentToCloud,
  onRefreshProjects,
  onOpenOtaUpdate,
}: AuthProjectsScreenProps) {
  const [operatorEmail, setOperatorEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [bioActive, setBioActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConnect = async (ev?: React.FormEvent) => {
    if (ev) ev.preventDefault();
    if (user) {
      onSelectProject(selectedProject, true);
      return;
    }
    if (!operatorEmail.trim() || !password) {
      setErrorMsg('Ingresa usuario/correo y contraseña, o entra en Modo Campo / Demo.');
      return;
    }
    setConnecting(true);
    setErrorMsg(null);
    try {
      await onLoginCloud(operatorEmail.trim(), password);
      setPassword('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo autenticar en la nube');
    } finally {
      setConnecting(false);
    }
  };

  const handleBiometric = () => {
    setBioActive(true);
    setTimeout(() => {
      setBioActive(false);
      if (user) {
        onSelectProject(selectedProject, true);
      } else {
        onDemoEnter();
      }
    }, 500);
  };

  return (
    <div className="relative flex flex-col w-full h-full overflow-y-auto no-scrollbar justify-between px-4 py-2.5 bg-[#0d1322] text-[#dde2f8] select-none">
      {/* Dynamic Topographic Contour SVG Watermark Layer */}
      <div className="absolute inset-0 pointer-events-none opacity-10 overflow-hidden">
        <svg className="w-full h-full text-[#4cd7f6]" fill="none" viewBox="0 0 400 800">
          <path d="M-80 120C20 120 40 80 140 100C240 120 280 200 480 160" stroke="currentColor" strokeWidth="1.2" />
          <path d="M-100 240C60 210 120 320 240 280C360 240 380 340 500 310" stroke="currentColor" strokeWidth="1.2" />
          <path d="M-60 380C30 420 150 360 270 410C390 460 410 400 520 440" stroke="currentColor" strokeWidth="1.2" />
          <path d="M-90 520C40 490 110 590 260 540C410 490 420 620 540 590" stroke="currentColor" strokeWidth="1.2" />
          <path d="M-70 660C80 680 160 610 290 670C420 730 450 670 530 700" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="200" cy="400" r="140" stroke="currentColor" strokeDasharray="3 4" strokeWidth="0.8" />
          <circle cx="200" cy="400" r="80" stroke="currentColor" strokeWidth="0.8" />
          <circle cx="200" cy="400" r="20" stroke="currentColor" strokeWidth="1" />
          <path d="M200 180V620M60 400H340" stroke="currentColor" strokeDasharray="2 3" strokeWidth="0.6" />
        </svg>
      </div>

      {/* Telemetry Bar & Branding Header */}
      <header className="relative z-10 flex flex-col gap-1.5">
        <div className="flex items-center justify-between bg-[#151b2b] px-3 py-1 rounded text-[#bcc9cd]">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-[#4edea3] animate-pulse" />
            <span className="font-stitch-mono text-[10.5px] text-[#4edea3] font-bold tracking-wider">
              TLS 1.3 SECURE
            </span>
          </div>
          <div className="flex items-center gap-2.5 font-stitch-mono text-[10.5px]">
            <span className="flex items-center gap-1 text-[#dde2f8] font-semibold">
              <Signal className="w-3 h-3 text-[#4cd7f6]" />
              4G LTE
            </span>
            <span className="flex items-center gap-1 text-[#dde2f8] font-semibold">
              <BatteryCharging className="w-3 h-3 text-[#4edea3]" />
              94%
            </span>
            <span className="text-[#ffb95f] font-bold tracking-tighter">RTK FIX</span>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1 px-0.5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[#242a3a] flex items-center justify-center text-[#4cd7f6] shadow-sm">
              <Satellite className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <h1 className="font-stitch-headline text-[20px] font-semibold tracking-tight text-[#dde2f8] leading-none">
                  GeoGIS6
                </h1>
                <span className="bg-[#2f3445] text-[#4cd7f6] font-stitch-mono text-[10px] px-1.5 py-0.5 rounded uppercase tracking-widest font-bold">
                  Field WS
                </span>
              </div>
              <span className="text-[11.5px] text-[#bcc9cd] leading-tight mt-0.5">
                IGVSB · REGVEN · PSAD56 Engine
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenOtaUpdate}
            className="flex flex-col items-end active:scale-95 transition-transform"
          >
            <span
              className={`font-stitch-mono text-[10.5px] px-2 py-0.5 rounded font-semibold ${
                otaHasUpdate
                  ? 'bg-[#4edea3]/20 text-[#4edea3] border border-[#4edea3]/50 animate-pulse'
                  : 'bg-[#06b6d4]/20 text-[#4cd7f6]'
              }`}
            >
              {otaHasUpdate ? `⬆ v${otaLatestName}` : `v${APP_VERSION_NAME}`}
            </span>
            <span className="font-stitch-mono text-[9.5px] text-[#869397] mt-0.5">
              BUILD {APP_VERSION_CODE}-PRO
            </span>
          </button>
        </div>
      </header>

      {/* Login & Hardware Authentication Dock */}
      <form
        onSubmit={handleConnect}
        className="relative z-10 flex flex-col bg-[#151b2b]/95 p-3 rounded-xl shadow-md gap-2 my-2 border border-[#242a3a]"
      >
        <div className="flex items-center justify-between bg-[#2f3445]/60 px-2.5 py-1.5 rounded-lg">
          <div className="flex items-center gap-1.5 min-w-0">
            <BadgeCheck className="w-4 h-4 text-[#4edea3] shrink-0" />
            <span className="font-stitch-mono text-[10px] text-[#4edea3] truncate font-medium">
              HW-Lock: {deviceId}
            </span>
          </div>
          <span className="bg-[#4edea3]/15 text-[#4edea3] font-stitch-mono text-[9.5px] font-bold px-1.5 py-0.5 rounded shrink-0 ml-1">
            {user ? user.rol.toUpperCase() : 'VINCULADO'}
          </span>
        </div>

        {user ? (
          <div className="flex flex-col gap-2">
            <div className="bg-[#080e1d] rounded-lg p-2.5 border border-[#4edea3]/30 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-[#dde2f8] truncate">{user.nombre || user.username}</div>
                <div className="font-stitch-mono text-[10px] text-[#bcc9cd] truncate">{user.email}</div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="px-2.5 py-1.5 rounded bg-rose-500/20 text-rose-300 font-stitch-mono text-[10px] font-bold flex items-center gap-1 shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" /> Salir
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onSelectProject(selectedProject, true)}
                className="h-11 bg-[#06b6d4] hover:bg-[#4cd7f6] text-[#003640] font-stitch-headline text-[12px] font-bold uppercase tracking-wider rounded-lg flex items-center justify-center gap-1.5"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Abrir Mapa
              </button>
              <button
                type="button"
                onClick={() => void onSaveCurrentToCloud()}
                disabled={cloudSyncing}
                className="h-11 bg-[#242a3a] hover:bg-[#33394a] text-[#4edea3] font-stitch-headline text-[11.5px] font-bold uppercase tracking-wider rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <CloudUpload className="w-4 h-4" />
                {cloudSyncing ? 'Guardando...' : 'Subir Nube'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="relative flex items-center">
                <UserCheck className="w-4 h-4 absolute left-3 text-[#869397]" />
                <input
                  aria-label="Operador ID"
                  type="text"
                  autoComplete="username"
                  placeholder="usuario o correo@geogis.net"
                  value={operatorEmail}
                  onChange={(e) => setOperatorEmail(e.target.value)}
                  className="w-full h-11 bg-[#080e1d] text-[#dde2f8] placeholder:text-[#869397]/70 font-stitch-mono text-[12.5px] rounded-lg pl-9 pr-3 focus:outline-none border border-[#242a3a] focus:border-[#4cd7f6]/50"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <div className="relative flex-1 flex items-center min-w-0">
                  <Lock className="w-4 h-4 absolute left-3 text-[#869397]" />
                  <input
                    aria-label="Clave Cifrada"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Contraseña PostgreSQL Cloud"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-11 bg-[#080e1d] text-[#dde2f8] placeholder:text-[#869397]/70 font-stitch-mono text-[12.5px] rounded-lg pl-9 pr-3 focus:outline-none border border-[#242a3a] focus:border-[#4cd7f6]/50"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleBiometric}
                  title="Acceso Rápido de Campo"
                  className={`h-11 w-11 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
                    bioActive
                      ? 'bg-[#4edea3]/25 text-[#4edea3]'
                      : 'bg-[#242a3a] hover:bg-[#2f3445] text-[#4cd7f6]'
                  }`}
                >
                  <Fingerprint className="w-5 h-5" />
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="px-2.5 py-1.5 rounded bg-rose-500/15 border border-rose-500/40 font-stitch-mono text-[10px] text-rose-300">
                {errorMsg}
              </div>
            )}

            <div className="flex flex-col gap-1.5 mt-0.5">
              <button
                type="submit"
                disabled={connecting}
                className="h-11 w-full flex items-center justify-center gap-2 bg-[#06b6d4] hover:bg-[#4cd7f6] text-[#003640] font-stitch-headline text-[12.5px] font-bold uppercase tracking-wider rounded-lg shadow-sm transition-all disabled:opacity-60"
              >
                <ArrowLeftRight className="w-4 h-4" />
                <span>{connecting ? 'VERIFICANDO ÉPOCAS...' : 'Conectar y Cargar Proyectos'}</span>
              </button>

              <button
                type="button"
                onClick={onDemoEnter}
                className="h-9 w-full flex items-center justify-center gap-1.5 bg-transparent hover:bg-[#242a3a] text-[#bcc9cd] font-stitch-mono text-[11px] rounded-lg transition-colors"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Acceso Modo Campo Offline / Demo</span>
              </button>
            </div>
          </>
        )}
      </form>

      {/* Offline / Cloud Project Selector Panel */}
      <section className="relative z-10 flex flex-col gap-1.5 my-1">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <FolderKanban className="w-4 h-4 text-[#4cd7f6]" />
            <h2 className="font-stitch-headline text-[12px] font-bold uppercase tracking-wider text-[#dde2f8]">
              Proyectos Sincronizados ({projects.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void onRefreshProjects()}
            className="flex items-center gap-1 font-stitch-mono text-[10px] text-[#4cd7f6] hover:text-[#acedff]"
          >
            <RefreshCw className={`w-3 h-3 ${cloudSyncing ? 'animate-spin' : ''}`} />
            <span>{user ? 'PostgreSQL' : 'Local Off-Grid'}</span>
          </button>
        </div>

        <div className="flex flex-col gap-2 max-h-[210px] overflow-y-auto no-scrollbar">
          {projects.map((project) => {
            const isSelected = project.id === selectedProject.id;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelectProject(project, true)}
                className={`text-left flex flex-col p-2.5 rounded-lg transition-colors border ${
                  isSelected
                    ? 'bg-[#242a3a] border-[#4cd7f6]/45'
                    : 'bg-[#191f2f] border-transparent hover:bg-[#242a3a]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {project.crsBadgeColor === 'secondary' ? (
                      <CheckCircle2 className="w-4 h-4 text-[#4edea3] shrink-0" />
                    ) : (
                      <Cloud className="w-4 h-4 text-[#ffb95f] shrink-0" />
                    )}
                    <span className="font-stitch-headline text-[14.5px] text-[#dde2f8] font-semibold truncate leading-snug">
                      {project.name}
                    </span>
                  </div>
                  <span
                    className={`font-stitch-mono text-[9.5px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                      project.crsBadgeColor === 'secondary'
                        ? 'bg-[#00a572]/20 text-[#4edea3]'
                        : 'bg-[#e79400]/20 text-[#ffb95f]'
                    }`}
                  >
                    {project.crsLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[#bcc9cd] font-stitch-mono text-[10.5px] mt-1.5 pt-1">
                  <span className="text-[#dde2f8] font-medium">{project.parcelsText}</span>
                  <span className={project.syncHighlight ? 'text-[#4edea3] font-semibold' : 'text-[#869397]'}>
                    {project.syncStatus}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Footer + OTA Check */}
      <footer className="relative z-10 flex flex-col items-center justify-center py-1.5 gap-1 text-center mt-1">
        {otaHasUpdate && (
          <button
            type="button"
            onClick={onOpenOtaUpdate}
            className="w-full py-1.5 rounded-lg bg-[#4edea3]/15 border border-[#4edea3]/50 text-[#4edea3] font-stitch-mono text-[10.5px] font-bold flex items-center justify-center gap-1.5 mb-1"
          >
            <Download className="w-3.5 h-3.5" />
            Nueva actualización disponible: v{otaLatestName}
          </button>
        )}
        <div className="flex items-center gap-1.5 text-[#869397]">
          <Lock className="w-3 h-3 text-[#4edea3]" />
          <p className="font-stitch-mono text-[10px] tracking-wide text-[#bcc9cd]">
            Cifrado TLS 1.3 · Geocálculos Locales Off-Grid
          </p>
        </div>
        <span className="font-stitch-mono text-[9px] uppercase tracking-widest text-[#869397]">
          Estándar Geodésico Nacional IGVSB Compatible
        </span>
      </footer>
    </div>
  );
}
