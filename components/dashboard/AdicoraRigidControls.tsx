'use client';

import React from 'react';
import { useAppStore, ADICORA_PRESETS, ADICORA_DEFAULT_CORRECTION } from '@/lib/store';
import { Sliders, RotateCcw, ShieldCheck, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'react-hot-toast';

interface AdicoraRigidControlsProps {
  className?: string;
  compact?: boolean;
}

export default function AdicoraRigidControls({ className, compact = false }: AdicoraRigidControlsProps) {
  const adicoraCorrection = useAppStore(s => s.adicoraCorrection);
  const setAdicoraCorrection = useAppStore(s => s.setAdicoraCorrection);
  const resetAdicoraCorrection = useAppStore(s => s.resetAdicoraCorrection);

  const de = adicoraCorrection?.de ?? ADICORA_DEFAULT_CORRECTION.de;
  const dn = adicoraCorrection?.dn ?? ADICORA_DEFAULT_CORRECTION.dn;
  const cota = adicoraCorrection?.cotaGeoidal ?? ADICORA_DEFAULT_CORRECTION.cotaGeoidal;

  // Detectar preset actual
  const currentPreset = ADICORA_PRESETS.find(
    p => Math.abs(p.de - de) < 0.001 && Math.abs(p.dn - dn) < 0.001
  )?.id || 'custom';

  // Vector resultante de traslación horizontal
  const deltaLineal = Math.sqrt(de * de + dn * dn);
  const azimutDeg = ((Math.atan2(de, dn) * 180 / Math.PI) + 360) % 360;

  const handleSelectPreset = (presetId: string) => {
    if (presetId === 'custom') return;
    const preset = ADICORA_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setAdicoraCorrection({
        de: preset.de,
        dn: preset.dn,
        cotaGeoidal: preset.cotaGeoidal,
        presetId: preset.id,
      });
      toast.success(`Cargado preset: ${preset.nombre}`);
    }
  };

  const handleReset = () => {
    resetAdicoraCorrection();
    toast.success('Parámetros restablecidos a Adícora AL-318 Oficial');
  };

  return (
    <div
      className={cn(
        "p-3.5 bg-gradient-to-b from-cyan-950/40 via-slate-900/60 to-slate-950/70 border border-cyan-500/30 rounded-xl space-y-3.5 shadow-lg shadow-cyan-950/20 backdrop-blur-sm",
        className
      )}
    >
      {/* Cabecera del Cuadro de Ajuste Rígido */}
      <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-black text-white tracking-wide uppercase">
                Ajuste Rígido Adícora
              </span>
              <span className="px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Editable
              </span>
            </div>
            <p className="text-[9px] text-cyan-300/70 leading-tight">
              Municipio Falcón · Península de Paraguaná
            </p>
          </div>
        </div>

        <button
          onClick={handleReset}
          title="Restablecer a valores oficiales AL-318 (-204.330, -311.540)"
          className="flex items-center gap-1 px-2 py-1 bg-slate-800/80 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 rounded-md border border-slate-700/80 hover:border-cyan-500/40 text-[9px] font-bold uppercase tracking-wider transition-all"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          <span>Oficial</span>
        </button>
      </div>

      {/* Selector de Presets de Calibración */}
      <div className="space-y-1.5">
        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-tight flex items-center justify-between">
          <span>Preset de Calibración</span>
          {currentPreset === 'al318' && (
            <span className="text-emerald-400 text-[8px] flex items-center gap-1">
              <ShieldCheck className="w-2.5 h-2.5" /> Hito IGVSB AL-318
            </span>
          )}
        </label>
        <select
          value={currentPreset}
          onChange={(e) => handleSelectPreset(e.target.value)}
          className="w-full bg-slate-950/80 border border-cyan-500/30 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs text-cyan-200 outline-none transition-all cursor-pointer"
        >
          {ADICORA_PRESETS.map((p) => (
            <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
              {p.nombre} (ΔE: {p.de.toFixed(2)}, ΔN: {p.dn.toFixed(2)})
            </option>
          ))}
          <option value="custom" className="bg-slate-900 text-amber-300">
            ★ Calibración Personalizada...
          </option>
        </select>
      </div>

      {/* Campos Editables de Desplazamiento Geodésico */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[9px] font-bold text-cyan-300 uppercase tracking-tight flex items-center justify-between">
            <span>ΔE (m) Traslación</span>
            <span className="text-[8px] text-slate-500 font-mono">X / Este</span>
          </label>
          <input
            type="number"
            step="0.001"
            value={de}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setAdicoraCorrection({ de: isNaN(val) ? 0 : val });
            }}
            placeholder="-204.330"
            className="w-full bg-slate-950/90 border border-cyan-500/40 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-cyan-300 outline-none transition-all"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-bold text-cyan-300 uppercase tracking-tight flex items-center justify-between">
            <span>ΔN (m) Traslación</span>
            <span className="text-[8px] text-slate-500 font-mono">Y / Norte</span>
          </label>
          <input
            type="number"
            step="0.001"
            value={dn}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setAdicoraCorrection({ dn: isNaN(val) ? 0 : val });
            }}
            placeholder="-311.540"
            className="w-full bg-slate-950/90 border border-cyan-500/40 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-cyan-300 outline-none transition-all"
          />
        </div>
      </div>

      {/* Cota Geoidal / Altimetría */}
      <div className="space-y-1">
        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-tight flex items-center justify-between">
          <span>Cota Geoidal por Defecto (m)</span>
          <span className="text-[8px] text-slate-500 font-mono">Ondulación N</span>
        </label>
        <input
          type="number"
          step="0.001"
          value={cota}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setAdicoraCorrection({ cotaGeoidal: isNaN(val) ? 0 : val });
          }}
          placeholder="-22.450"
          className="w-full bg-slate-950/90 border border-slate-700 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-300 outline-none transition-all"
        />
      </div>

      {/* Panel Informativo de Verificación Geodésica */}
      {!compact && (
        <div className="p-2.5 bg-slate-950/70 rounded-lg border border-cyan-500/20 text-[9px] space-y-1 font-mono">
          <div className="flex justify-between items-center text-slate-400">
            <span className="uppercase text-slate-500">Vector Lineal (ΔD):</span>
            <span className="text-cyan-300 font-bold">{deltaLineal.toFixed(3)} m</span>
          </div>
          <div className="flex justify-between items-center text-slate-400">
            <span className="uppercase text-slate-500">Azimut Geodésico:</span>
            <span className="text-cyan-300 font-bold">{azimutDeg.toFixed(2)}°</span>
          </div>
          <div className="pt-1 border-t border-slate-800/80 flex items-center gap-1.5 text-slate-400 font-sans text-[8px]">
            <Info className="w-3 h-3 text-cyan-400 shrink-0" />
            <span>
              Aplica: <span className="font-mono text-cyan-300">E_REG = E_Can + ({de.toFixed(3)})</span>, <span className="font-mono text-cyan-300">N_REG = N_Can + ({dn.toFixed(3)})</span>. Invarianza QA/QC ≤ 1 mm.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
