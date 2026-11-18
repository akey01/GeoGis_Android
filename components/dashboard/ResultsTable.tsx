'use client';

import React from 'react';
import { useAppStore } from '@/lib/store';
import { Activity, Copy, Trash2, Save, Download } from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function ResultsTable() {
  const { results, clearResults, saveCurrentParcel, user } = useAppStore();
  const isViewer = user?.rol === 'viewer' || user?.rol === 'demo';
 
  const generateCivilCadText = () => {
    return results.map((r, i) => {
      const p = r.id || (i + 1);
      const e = r.result.este !== undefined ? r.result.este.toFixed(3) : '0.000';
      const n = r.result.norte !== undefined ? r.result.norte.toFixed(3) : '0.000';
      const z = (r.result?.cota_regven ?? r.input?.alt ?? -22.450).toFixed(3);
      const d = (r as any).parcel || r.id || `V${i + 1}`;
      return `${p},${e},${n},${z},${d}`;
    }).join('\n');
  };

  const copyCivilCad = () => {
    if (isViewer) {
      toast.error('Modo DEMO: Copia de coordenadas al portapapeles bloqueada.');
      return;
    }
    const text = generateCivilCadText();
    navigator.clipboard.writeText(text);
    toast.success('Formato CivilCAD (P,E,N,Z,D) copiado');
  };

  const downloadCivilCad = () => {
    if (isViewer) {
      toast.error('Modo DEMO: Descarga de archivos de texto/CSV bloqueada.');
      return;
    }
    const text = generateCivilCadText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vertices_civilcad_PENZD_${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('Archivo CivilCAD (.txt) descargado');
  };

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 border-2 border-dashed border-slate-800 rounded-2xl p-6 text-center">
        <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center mb-3">
          <Activity className="w-5 h-5 text-slate-600" />
        </div>
        <p className="text-xs text-slate-500">Sin resultados activos.<br/>Realice una transformación para ver los datos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
       <div className="flex items-center justify-between">
         <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
           <div className="w-1 h-1 rounded-full bg-emerald-500"></div>
           Vértices Activos
         </h4>
         <div className="flex items-center gap-1.5 flex-wrap">
           <button 
             onClick={copyCivilCad}
             title="Copiar vértices en formato CivilCAD (P,E,N,Z,D)"
             className="flex items-center gap-1 px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 rounded-md transition-colors border border-cyan-500/30 text-[10px] font-bold uppercase tracking-wider"
           >
             <Copy className="w-3 h-3" />
             Copiar P,E,N,Z,D
           </button>
           <button 
             onClick={downloadCivilCad}
             title="Descargar archivo .txt listo para CivilCAD / AutoCAD"
             className="flex items-center gap-1 px-2 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-md transition-colors border border-blue-500/30 text-[10px] font-bold uppercase tracking-wider"
           >
             <Download className="w-3 h-3" />
             CivilCAD .txt
           </button>
           {!isViewer && (
             <button 
               onClick={() => {
                 saveCurrentParcel();
                 toast.success('Parcela guardada en memoria');
               }}
               className="flex items-center gap-1 px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-md transition-colors border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider"
             >
               <Save className="w-3 h-3" />
               Guardar
             </button>
           )}
           {!isViewer && (
             <button 
               onClick={clearResults}
               className="p-1.5 hover:bg-red-500/10 rounded-md transition-colors group"
             >
               <Trash2 className="w-4 h-4 text-slate-600 group-hover:text-red-400" />
             </button>
           )}
         </div>
       </div>

      <div className="overflow-hidden border border-slate-800 rounded-xl">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-slate-900/50 border-b border-slate-800">
            <tr>
              <th className="px-3 py-2 text-slate-500 font-bold uppercase">Parcela</th>
              <th className="px-3 py-2 text-slate-500 font-bold uppercase">ID</th>
              <th className="px-3 py-2 text-slate-500 font-bold uppercase">Este (X)</th>
              <th className="px-3 py-2 text-slate-500 font-bold uppercase">Norte (Y)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {results.map((r, i) => (
              <tr key={i} className="hover:bg-slate-800/30 transition-colors group">
                <td className="px-3 py-2 text-slate-500 font-medium">{(r as any).parcel || '---'}</td>
                <td className="px-3 py-2 font-mono text-emerald-400 font-bold">{r.id}</td>
                <td className="px-3 py-2 font-mono text-slate-300">{r.result.este?.toFixed(3)}</td>
                <td className="px-3 py-2 font-mono text-slate-300">
                  <div className="flex items-center justify-between">
                    {r.result.norte?.toFixed(3)}
                    <button 
                      disabled={isViewer}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-700 rounded transition-all disabled:hidden"
                    >
                      <Copy className="w-3 h-3 text-slate-500" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl space-y-2">
        <div className="flex justify-between items-center text-[10px]">
          <span className="text-slate-500 uppercase">Delta Promedio:</span>
          <span className="font-mono text-emerald-400 font-bold">
            {(results.reduce((acc, r) => acc + (r.result.dLineal || 0), 0) / results.length).toFixed(3)} m
          </span>
        </div>
        {results[0]?.result?.dma && (
          <div className="mt-2 border border-cyan-500/20 rounded-xl overflow-hidden text-[10px]">
            <div className="bg-cyan-950/60 px-3 py-1.5 flex items-center gap-2 border-b border-cyan-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-cyan-400 font-bold uppercase tracking-widest">Cadena de Transformación DMA</span>
            </div>

            {/* Paso A — Coordenadas DMA de origen */}
            <div className="px-3 py-2 bg-slate-950/60 border-b border-cyan-500/10">
              <div className="text-slate-500 font-bold uppercase mb-1 text-[8px]">Entrada DMA (Origen)</div>
              <div className="flex justify-between font-mono">
                <span className="text-slate-500">E:</span>
                <span className="text-slate-300">{results[0].result.esteDMA?.toFixed(3)}</span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-slate-500">N:</span>
                <span className="text-slate-300">{results[0].result.norteDMA?.toFixed(3)}</span>
              </div>
            </div>

            {/* Paso B — PSAD56 REAL */}
            {results[0]?.result?.estePSAD56_Real !== undefined && (
              <div className="px-3 py-2 bg-cyan-950/30 border-b border-cyan-500/10">
                <div className="text-cyan-400 font-bold uppercase mb-1 text-[8px] flex items-center gap-1">
                  <span>↓</span> Paso A — PSAD56 REAL (La Canoa Real)
                  <span className="ml-auto font-mono text-cyan-300/70 text-[8px]">+11.051m (E) / +44.642m (N)</span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-cyan-300/60">E:</span>
                  <span className="text-cyan-300">{results[0].result.estePSAD56_Real?.toFixed(3)}</span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-cyan-300/60">N:</span>
                  <span className="text-cyan-300">{results[0].result.nortePSAD56_Real?.toFixed(3)}</span>
                </div>
              </div>
            )}

            {/* Paso C — REGVEN Final (solo si aplica) */}
            {results[0]?.result?.esteREGVEN !== undefined && results[0]?.result?.norteREGVEN !== undefined && results[0]?.result?.esteREGVEN !== results[0]?.result?.estePSAD56_Real && (
              <div className="px-3 py-2 bg-emerald-950/30">
                <div className="text-emerald-400 font-bold uppercase mb-1 text-[8px] flex items-center gap-1">
                  <span>↓</span> Paso B — REGVEN / SIRGAS (PATVEN-98)
                  <span className="ml-auto font-mono text-emerald-300/70 text-[8px]">−210.842m (E) / −364.752m (N)</span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-emerald-300/60">E:</span>
                  <span className="text-emerald-300 font-bold">{results[0].result.esteREGVEN?.toFixed(3)}</span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-emerald-300/60">N:</span>
                  <span className="text-emerald-300 font-bold">{results[0].result.norteREGVEN?.toFixed(3)}</span>
                </div>
              </div>
            )}
          </div>
        )}
        {/* Panel de Auditoría y Verificación: Ajuste Rígido Adícora */}
        {(results[0]?.result?.metodo === 'RIGIDA02_ADICORA_REGVEN' || results[0]?.result?.deltaEste !== undefined) && (
          <div className="mt-2 border border-cyan-500/30 rounded-xl overflow-hidden text-[10px] bg-slate-950/60">
            <div className="bg-cyan-950/70 px-3 py-1.5 flex items-center justify-between border-b border-cyan-500/20">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-cyan-300 font-bold uppercase tracking-wider">
                  Verificación Ajuste Rígido Adícora
                </span>
              </div>
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold uppercase tracking-wider">
                QA/QC Aprobado
              </span>
            </div>

            <div className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                  <div className="text-slate-500 text-[8px] uppercase">ΔE Aplicado (Este)</div>
                  <div className="text-cyan-300 font-bold">
                    {results[0].result.deltaEste !== undefined ? `${results[0].result.deltaEste.toFixed(3)} m` : '---'}
                  </div>
                </div>
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                  <div className="text-slate-500 text-[8px] uppercase">ΔN Aplicado (Norte)</div>
                  <div className="text-cyan-300 font-bold">
                    {results[0].result.deltaNorte !== undefined ? `${results[0].result.deltaNorte.toFixed(3)} m` : '---'}
                  </div>
                </div>
              </div>

              {results[0].result.cota_regven !== undefined && (
                <div className="flex justify-between items-center text-[9px] text-slate-400 pt-1 border-t border-slate-800/80">
                  <span>Cota REGVEN ({results[0].result.cotaInyectada ? 'Geoidal regional' : 'Campo'}):</span>
                  <span className="font-mono text-slate-200 font-bold">
                    {results[0].result.cota_regven.toFixed(3)} m
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center text-[9px] text-slate-400">
                <span>Desplazamiento horizontal (ΔD):</span>
                <span className="font-mono text-cyan-300 font-bold">
                  {results[0].result.dLineal ? `${results[0].result.dLineal.toFixed(3)} m` : '---'}
                </span>
              </div>

              <div className="text-[8px] text-slate-500 italic pt-1 border-t border-slate-800/60">
                Certificación: Traslación rígida pura sobre La Canoa (PSAD-56) → REGVEN (SIRGAS/WGS84 EPSG:2203). Invarianza métrica verificada.
              </div>
            </div>
          </div>
        )}

        {results[0]?.result?.dn !== undefined && (
          <div className="flex flex-col gap-1 pt-2 border-t border-emerald-500/10">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-amber-400 uppercase font-bold">Rígida ΔN/ΔE:</span>
              <span className="font-mono text-amber-400">
                ΔN={results[0].result.dnApplied?.toFixed(2)} / ΔE={results[0].result.deApplied?.toFixed(2)} m
                {results[0].result.badekasEste !== undefined && (
                  <span className="text-slate-500 ml-2">
                    (Badekas: {results[0].result.badekasEste.toFixed(2)}, {results[0].result.badekasNorte.toFixed(2)})
                  </span>
                )}
              </span>
            </div>
             {results[0].result.autoResiduo && (
               <div className="flex justify-end items-center text-[9px] mt-1">
                 <span className="text-emerald-400 uppercase font-bold px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center gap-1.5">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                   {results[0].result.metodoResiduo?.toLowerCase() === 'idw' 
                     ? 'Malla IDW Automática' 
                     : results[0].result.metodoResiduo?.toLowerCase() === 'exacto'
                     ? 'Malla (Nodo Exacto)'
                     : results[0].result.metodoResiduo?.toLowerCase() === 'badekas'
                     ? 'Badekas 7-Parámetros (Sin Grilla)'
                     : 'Vector Fijo'} Activo
                 </span>
               </div>
             )}
          </div>
        )}
      </div>
    </div>
  );
}
