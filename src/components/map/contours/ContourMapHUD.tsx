/**
 * ContourMapHUD.tsx — Barra flotante altimétrica cuando hay curvas visibles sobre una parcela
 * GeoGIS6
 */

'use client';

import React from 'react';
import { Mountain, Printer, Download, X, Layers, Grid3x3, Crosshair, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { hasPermission, isDemoRole } from '@/src/types/auth';
import { toast } from 'react-hot-toast';
import { useContourStore } from './useContourStore';
import { exportParcelContoursDXF, SATELLITE_DEM_WARNING } from './contourEngine';

const INTERVAL_OPTIONS = [0.25, 0.5, 1, 2, 5, 10] as const;

export default function ContourMapHUD() {
  const contoursByParcelId = useContourStore((s) => s.contoursByParcelId);
  const visibleParcelIds = useContourStore((s) => s.visibleParcelIds);
  const focusedParcelId = useContourStore((s) => s.focusedParcelId);
  const showMapGrid = useContourStore((s) => s.showMapGrid);
  const showMapGridNodes = useContourStore((s) => s.showMapGridNodes);
  const toggleShowMapGrid = useContourStore((s) => s.toggleShowMapGrid);
  const toggleShowMapGridNodes = useContourStore((s) => s.toggleShowMapGridNodes);
  const setFocusedParcelId = useContourStore((s) => s.setFocusedParcelId);
  const setParcelInterval = useContourStore((s) => s.setParcelInterval);
  const hideParcelContours = useContourStore((s) => s.hideParcelContours);
  const openPrintModalForParcel = useContourStore((s) => s.openPrintModalForParcel);

  const savedParcels = useAppStore((s) => s.savedParcels);
  const huso = useAppStore((s) => s.huso);
  const user = useAppStore((s) => s.user);
  const isDemo = Boolean(user?.rol) && isDemoRole(user?.rol);
  const canExportDxf = user ? hasPermission(user.rol, 'export_dxf', user?.roleConfig?.capabilities) : true;

  if (visibleParcelIds.length === 0) return null;

  const activePid =
    focusedParcelId && visibleParcelIds.includes(focusedParcelId)
      ? focusedParcelId
      : visibleParcelIds[visibleParcelIds.length - 1];

  const data = contoursByParcelId[activePid];
  if (!data) return null;

  const spacingE =
    data.gridSpacingE ??
    Number(((data.rawGrid.maxE - data.rawGrid.minE) / Math.max(1, data.gridCols - 1)).toFixed(2));
  const spacingN =
    data.gridSpacingN ??
    Number(((data.rawGrid.maxN - data.rawGrid.minN) / Math.max(1, data.gridRows - 1)).toFixed(2));

  const handlePrintClick = () => {
    const parcel = savedParcels.find((p) => p.id === activePid);
    if (parcel) {
      openPrintModalForParcel(parcel, huso);
    } else {
      // Ya está en contoursByParcelId: basta asignar printModalParcelId directamente
      useContourStore.setState({ printModalParcelId: activePid });
    }
  };

  const handleDxfClick = () => {
    if (!canExportDxf || isDemo) {
      toast.error('Exportación DXF 3D de curvas bloqueada para su rol.');
      return;
    }
    exportParcelContoursDXF(data);
    toast.success(`DXF 3D con curvas exportado (${data.contours.length} polilíneas)`);
  };

  return (
    <div className="absolute bottom-14 sm:bottom-4 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-2rem)] max-w-lg pointer-events-auto">
      <div className="bg-slate-900/95 backdrop-blur-xl border border-amber-500/40 rounded-2xl p-2.5 shadow-2xl shadow-black/80 space-y-2">
        {/* Cabecera + selector si hay varias parcelas con curvas activas */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Mountain className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-white truncate max-w-[160px]">
                  {data.parcelName}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono font-bold">
                  ΔZ {data.interval}m
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-300 flex items-center gap-2 flex-wrap">
                <span className="text-sky-300">Z: {data.minZ.toFixed(1)}–{data.maxZ.toFixed(1)} m</span>
                <span className="text-slate-500">·</span>
                <span className="text-amber-300">ΔH {data.deltaH.toFixed(1)} m</span>
                <span className="text-slate-500">·</span>
                <span className="text-emerald-300">Pend. {data.meanSlopePct.toFixed(1)}%</span>
                <span className="text-slate-500">·</span>
                <span
                  className="text-emerald-200 font-semibold"
                  title="Separación real de la cuadrícula de muestreo DEM (ΔE × ΔN)"
                >
                  Malla {spacingE.toFixed(1)}×{spacingN.toFixed(1)}m
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handlePrintClick}
              title="Abrir vista previa e imprimir Plano de Curvas de Nivel"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-extrabold uppercase tracking-wider transition-colors shadow-md shadow-amber-500/20"
            >
              <Printer className="w-3 h-3" />
              <span className="hidden sm:inline">Plano</span>
            </button>
            <button
              onClick={handleDxfClick}
              title="Descargar curvas de nivel 3D en formato DXF"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-white/10 text-[10px] font-bold uppercase transition-colors"
            >
              <Download className="w-3 h-3" />
              <span className="hidden sm:inline">DXF</span>
            </button>
            <button
              onClick={() => hideParcelContours(activePid)}
              title="Ocultar curvas de esta parcela en el mapa"
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Advertencia de incertidumbre altimétrica satelital (30m/px) */}
        {(data.uncertaintyWarning || data.sourceType === 'SATELLITE_DEM') && (
          <div
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[9.5px] font-semibold leading-tight',
              data.wasIntervalClamped
                ? 'bg-red-500/15 border-red-400/50 text-red-200'
                : 'bg-amber-500/10 border-amber-400/35 text-amber-200'
            )}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">
              {data.uncertaintyWarning || SATELLITE_DEM_WARNING}
            </span>
          </div>
        )}

        {/* Selector de equidistancia + cuadrícula + chips de parcelas activas */}
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/10 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mr-1">
              Equid.:
            </span>
            {INTERVAL_OPTIONS.map((iv) => {
              const isBelowSatFloor = data.sourceType === 'SATELLITE_DEM' && iv < 1;
              return (
                <button
                  key={iv}
                  onClick={() => setParcelInterval(activePid, iv)}
                  title={
                    isBelowSatFloor
                      ? `Equidistancia fina ${iv} m (anteproyecto referencial satelital)`
                      : `Establecer equidistancia a ${iv} m`
                  }
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors border',
                    data.interval === iv
                      ? 'bg-amber-500 border-amber-400 text-slate-950'
                      : isBelowSatFloor
                        ? 'bg-slate-900/80 border-amber-500/25 text-amber-400/70 hover:text-amber-300 hover:border-amber-400/50'
                        : 'bg-slate-800/80 border-white/10 text-slate-300 hover:text-white hover:border-amber-500/40'
                  )}
                >
                  {iv}m
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={toggleShowMapGrid}
              title="Mostrar/ocultar cuadrícula de muestreo DEM sobre el satélite"
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border transition-colors',
                showMapGrid
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-slate-800/80 border-white/10 text-slate-400 hover:text-white'
              )}
            >
              <Grid3x3 className="w-2.5 h-2.5" />
              <span>Malla</span>
            </button>
            <button
              onClick={toggleShowMapGridNodes}
              title="Mostrar/ocultar cotas Z internas de la cuadrícula"
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border transition-colors',
                showMapGridNodes
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-slate-800/80 border-white/10 text-slate-400 hover:text-white'
              )}
            >
              <Crosshair className="w-2.5 h-2.5" />
              <span>Cotas Z</span>
            </button>
          </div>

          {visibleParcelIds.length > 1 && (
            <div className="flex items-center gap-1 overflow-x-auto max-w-[200px]">
              <Layers className="w-3 h-3 text-slate-400 shrink-0" />
              {visibleParcelIds.map((pid) => {
                const pName = contoursByParcelId[pid]?.parcelName || 'Parcela';
                return (
                  <button
                    key={pid}
                    onClick={() => setFocusedParcelId(pid)}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[9px] font-semibold truncate max-w-[80px] border',
                      pid === activePid
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                        : 'bg-slate-800 border-white/10 text-slate-400 hover:text-white'
                    )}
                    title={pName}
                  >
                    {pName}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
