'use client';

import React, { useEffect, useActionState } from 'react';
import { X, User, Mail, Shield, Calendar, Clock, Lock, Eye, EyeOff, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { changePassword, type ActionState } from '@/app/actions/changePasswordAction';

interface UserProfile {
  id: string;
  username: string;
  nombre: string;
  email: string;
  rol: string;
  creado: string;
  ultimo_acceso: string | null;
}

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
}

const ROL_LABELS: Record<string, { label: string; color: string }> = {
  admin:             { label: 'Administrador del Sistema',       color: 'text-red-400 bg-red-500/10 border-red-500/30' },
  revisor_catastral: { label: 'Revisor Catastral / Inspector',   color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  operador_campo:    { label: 'Operador de Campo / Topógrafo',   color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  demo:              { label: 'Evaluación / Modo DEMO',          color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
  senior:            { label: 'Revisor Catastral / Inspector',   color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  junior:            { label: 'Operador de Campo / Topógrafo',   color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  viewer:            { label: 'Evaluación / Modo DEMO',          color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const initialState: ActionState = { status: 'idle' };

export default function ProfileModal({ open, onClose }: ProfileModalProps) {
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [tab, setTab] = React.useState<'info' | 'password'>('info');
  const [showCurrent, setShowCurrent] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  const [state, formAction, isPending] = useActionState(changePassword, initialState);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setTab('info');
      setLoading(true);
      fetch('/api/profile')
        .then(r => r.json())
        .then(data => { setProfile(data.user ?? null); })
        .catch(() => setProfile(null))
        .finally(() => setLoading(false));
    }
  }, [open]);

  if (!open) return null;

  const rol = profile ? (ROL_LABELS[profile.rol] ?? { label: profile.rol, color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' }) : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-slate-800/60 to-slate-900/40 border-b border-slate-800">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                <User className="w-7 h-7 text-emerald-400" />
              </div>
              <div>
                {loading ? (
                  <div className="space-y-2">
                    <div className="h-4 w-32 bg-slate-700 rounded animate-pulse" />
                    <div className="h-3 w-20 bg-slate-800 rounded animate-pulse" />
                  </div>
                ) : (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-0.5">GeoGIS6 · Perfil de Usuario</p>
                    <h2 className="text-base font-bold text-slate-100">{profile?.nombre ?? '—'}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">@{profile?.username ?? '—'}</p>
                    {rol && (
                      <span className={`mt-1 inline-block text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full border ${rol.color}`}>
                        {rol.label}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-4">
              {(['info', 'password'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    tab === t
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {t === 'info' ? 'Datos del usuario' : 'Cambiar contraseña'}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="p-6">
            {/* ── TAB: INFO ── */}
            {tab === 'info' && (
              <div className="space-y-4">
                {loading ? (
                  <div className="space-y-3">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="h-12 bg-slate-800 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : profile ? (
                  <>
                    <InfoRow icon={<User className="w-4 h-4 text-emerald-400" />} label="Nombre completo" value={profile.nombre} />
                    <InfoRow icon={<span className="text-emerald-400 text-sm font-bold">@</span>} label="Usuario" value={profile.username} />
                    <InfoRow icon={<Mail className="w-4 h-4 text-emerald-400" />} label="Correo electrónico" value={profile.email ?? '—'} />
                    <InfoRow icon={<Shield className="w-4 h-4 text-emerald-400" />} label="Rol" value={rol?.label ?? profile.rol} />
                    <InfoRow icon={<Calendar className="w-4 h-4 text-emerald-400" />} label="Cuenta creada" value={formatDate(profile.creado)} />
                    <InfoRow icon={<Clock className="w-4 h-4 text-emerald-400" />} label="Último acceso" value={formatDate(profile.ultimo_acceso)} />
                  </>
                ) : (
                  <p className="text-center text-sm text-slate-500 py-6">No se pudo cargar el perfil.</p>
                )}
              </div>
            )}

            {/* ── TAB: CHANGE PASSWORD ── */}
            {tab === 'password' && (
              <form action={formAction} className="space-y-4">
                {/* Success / Error feedback */}
                {state.status === 'success' && (
                  <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    {state.message}
                  </div>
                )}
                {state.status === 'error' && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {state.message}
                  </div>
                )}

                <PasswordField
                  name="currentPassword"
                  label="Contraseña actual"
                  show={showCurrent}
                  onToggle={() => setShowCurrent(v => !v)}
                />
                <PasswordField
                  name="newPassword"
                  label="Nueva contraseña"
                  show={showNew}
                  onToggle={() => setShowNew(v => !v)}
                  hint="Mínimo 6 caracteres"
                />
                <PasswordField
                  name="confirmPassword"
                  label="Confirmar nueva contraseña"
                  show={showConfirm}
                  onToggle={() => setShowConfirm(v => !v)}
                />

                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors mt-2"
                >
                  {isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Actualizando...</>
                  ) : (
                    <><Lock className="w-4 h-4" /> Actualizar contraseña</>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/40">
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">{label}</p>
        <p className="text-sm text-slate-200 mt-0.5 truncate">{value}</p>
      </div>
    </div>
  );
}

function PasswordField({
  name, label, show, onToggle, hint,
}: {
  name: string; label: string; show: boolean; onToggle: () => void; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="text-xs text-slate-400 font-medium">{label}</label>
      {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
      <div className="relative">
        <input
          id={name}
          name={name}
          type={show ? 'text' : 'password'}
          required
          className="w-full bg-slate-800 border border-slate-700 focus:border-emerald-500 rounded-xl px-4 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors"
          placeholder="••••••••"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
