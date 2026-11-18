'use client';

import React, { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { loginUser } from '@/app/actions/loginAction';
import { useAppStore } from '@/lib/store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Map, ShieldCheck, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { getOrCreateDeviceId } from '@/src/utils/device';

export default function LoginPage() {
  const [state, action, isPending] = useActionState(loginUser, undefined);
  const [isSuspendedNotice, setIsSuspendedNotice] = useState(false);
  const [suspendReasonText, setSuspendReasonText] = useState<string>('');
  const [deviceId, setDeviceId] = useState(() =>
    typeof window !== 'undefined' ? getOrCreateDeviceId() : ''
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDeviceId(getOrCreateDeviceId());
      const params = new URLSearchParams(window.location.search);
      if (params.get('suspended') === '1') {
        setIsSuspendedNotice(true);
        const reason = params.get('reason') || '';
        if (reason === 'DEVICE_LIMIT_EXCEEDED') {
          setSuspendReasonText('Límite de dispositivos simultáneos alcanzado. Cierre sesión en su otro equipo o solicite al administrador liberar un cupo.');
        } else if (reason === 'CONCURRENT_IP_ABUSE') {
          setSuspendReasonText('Se detectó acceso simultáneo desde múltiples redes distintas. Por favor inicie sesión nuevamente.');
        } else if (reason === 'DEVICE_REVOKED') {
          setSuspendReasonText('Este dispositivo ha sido revocado por el administrador del sistema.');
        } else {
          setSuspendReasonText('Su cuenta ha sido suspendida por el administrador o su sesión fue cerrada por seguridad.');
        }
        useAppStore.getState().clearProjectWorkspace();
        useAppStore.getState().setUser(null);
        localStorage.removeItem('geotrans-offline-v1');
        localStorage.removeItem('transforven_project');
        sessionStorage.clear();
      }
    }
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    setIsSuspendedNotice(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0c10] flex items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Abstract Background Effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl mb-4 group hover:border-emerald-500/50 transition-all duration-500">
            <Map className="w-8 h-8 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight uppercase">
            GeoGIS<span className="text-emerald-500">6</span>
          </h1>
          <p className="text-slate-500 mt-2 text-sm font-medium tracking-wide">
            CONTROL DE ACCESO SEGURO
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800/60 p-8 rounded-3xl shadow-2xl relative z-20 backdrop-blur-xl bg-opacity-40">
          {isSuspendedNotice && !state?.error && (
            <div className="mb-5 p-3 bg-red-500/15 border border-red-500/40 rounded-xl flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-ping shrink-0"></div>
              <span className="text-xs font-bold text-red-400 uppercase tracking-tight">
                {suspendReasonText || 'Su cuenta ha sido suspendida por el administrador. Se ha desconectado del sistema.'}
              </span>
            </div>
          )}

          <form 
            action={action} 
            onSubmit={handleSubmit}
            className="space-y-5"
          >
            <input type="hidden" name="deviceId" value={deviceId} />
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Usuario / Email</label>
              <Input
                name="email"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="usuario@geogis6.com"
                required
                className="bg-slate-950/50 border-slate-800 focus:border-emerald-500/50 text-emerald-400 placeholder:text-slate-700"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center ml-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Contraseña</label>
                <Link href="#" className="text-[10px] text-slate-500 hover:text-emerald-400 uppercase font-bold tracking-tighter">¿Olvidó su clave?</Link>
              </div>
              <Input
                name="password"
                type="password"
                placeholder="••••••••"
                required
                className="bg-slate-950/50 border-slate-800 focus:border-emerald-500/50 text-emerald-400 placeholder:text-slate-700"
              />
            </div>

            {state?.error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                <span className="text-xs font-bold text-red-400 uppercase tracking-tight">{state.error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={isPending}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold uppercase tracking-[0.2em] text-xs shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-3 mt-4"
            >
              {isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  AUTENTICANDO...
                </>
              ) : (
                <>
                  INICIAR SESIÓN
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>
        </div>

        <div className="mt-8 text-center space-y-4">
          <p className="text-slate-500 text-xs font-medium">
            ¿No tiene una cuenta autorizada?{' '}
            <Link href="/register" className="text-emerald-400 hover:text-emerald-300 font-bold uppercase tracking-wide transition-colors">
              Solicitar Registro
            </Link>
          </p>
          
          <div className="flex items-center justify-center gap-2 opacity-30 grayscale hover:grayscale-0 transition-all duration-500">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em]">Encrypted Session</span>
          </div>
        </div>
      </div>
    </div>
  );
}
