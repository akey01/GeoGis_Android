'use client';
import React, { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Loader2 } from 'lucide-react';

export default function LoadingOverlay() {
  const { isExporting, exportType, pdfProgress } = useStore();

  if (!isExporting) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center space-y-6">
        <div className="relative">
          <Loader2 className="w-16 h-16 text-emerald-500 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold text-emerald-400">{pdfProgress}%</span>
          </div>
        </div>
        
        <div className="space-y-2">
           <h3 className="text-lg font-bold text-slate-100 uppercase tracking-widest">
             Generando {exportType === 'DXF' ? 'Archivo DXF' : exportType === 'KML' ? 'Archivo KML' : 'PDF Profesional'}
           </h3>
           <p className="text-sm text-slate-400">
             {exportType === 'DXF' 
               ? 'Construyendo geometría vectorial CAD...' 
               : exportType === 'KML' 
               ? 'Generando estructura KMZ para Google Earth...' 
               : 'Procesando vectores CAD y optimizando salida...'}
           </p>
        </div>

        <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden border border-slate-700">
          <div 
            className="bg-gradient-to-r from-emerald-600 to-emerald-400 h-full transition-all duration-300 ease-out"
            style={{ width: `${pdfProgress}%` }}
          />
        </div>
        
        <p className="text-[10px] text-slate-500 font-medium uppercase tracking-tighter">
          Por favor, no cierre el navegador ni pulse el botón nuevamente
        </p>
      </div>
    </div>
  );
}
