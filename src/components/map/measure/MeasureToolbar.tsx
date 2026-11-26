/**
 * MeasureToolbar.tsx — Botón "Regla" + panel flotante de herramientas de medición
 * (estilo táctico GeoGIS Android). Presentacional: lee/escribe solo en useMeasureStore.
 */

'use client';

import React from 'react';
import { Ruler, Pentagon, CircleDashed, Compass, Locate, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMeasureStore } from './useMeasureStore';
import {
  describeReading,
  type AreaUnit,
  type DistanceUnit,
  type MeasureKind,
} from './measureUtils';

export interface MeasureToolbarProps {
  hideTrigger?: boolean;
}

const TOOLS: Array<{ kind: MeasureKind; label: string; title: string; hint: string; Icon: typeof Ruler }> = [
  { kind: 'distance', label: 'Distancia', title: 'Medir distancia (línea o ruta)', hint: 'Clic para añadir puntos · doble clic para terminar', Icon: Ruler },
  { kind: 'area', label: 'Área', title: 'Medir área y perímetro de un polígono', hint: 'Clic para añadir vértices · doble clic para cerrar', Icon: Pentagon },
  { kind: 'circle', label: 'Radio', title: 'Medir un círculo (radio, circunferencia, área)', hint: 'Clic en el centro y clic en el borde', Icon: CircleDashed },
  { kind: 'bearing', label: 'Rumbo', title: 'Medir azimut, rumbo y distancia entre dos puntos', hint: 'Clic en el punto inicial y clic en el final', Icon: Compass },
  { kind: 'point', label: 'Punto', title: 'Obtener coordenadas UTM y geográficas de un punto', hint: 'Clic sobre el mapa para marcar un punto', Icon: Locate },
];

const DISTANCE_UNITS: Array<{ v: DistanceUnit; l: string }> = [
  { v: 'auto', l: 'Auto' }, { v: 'm', l: 'm' }, { v: 'km', l: 'km' }, { v: 'ft', l: 'ft' }, { v: 'mi', l: 'mi' },
];
const AREA_UNITS: Array<{ v: AreaUnit; l: string }> = [
  { v: 'auto', l: 'Auto' }, { v: 'm2', l: 'm²' }, { v: 'ha', l: 'ha' }, { v: 'km2', l: 'km²' }, { v: 'ac', l: 'ac' },
];

const selectCls =
  'flex-1 min-w-0 bg-[#0d1322] border border-[#242a3a] rounded-md px-1.5 py-1 text-[11px] text-[#dde2f8] focus:outline-none focus:border-[#4cd7f6]';

export default function MeasureToolbar({ hideTrigger = false }: MeasureToolbarProps) {
  const panelOpen = useMeasureStore((s) => s.panelOpen);
  const mode = useMeasureStore((s) => s.mode);
  const reading = useMeasureStore((s) => s.reading);
  const live = useMeasureStore((s) => s.live);
  const distanceUnit = useMeasureStore((s) => s.distanceUnit);
  const areaUnit = useMeasureStore((s) => s.areaUnit);
  const openPanel = useMeasureStore((s) => s.openPanel);
  const closePanel = useMeasureStore((s) => s.closePanel);
  const toggleMode = useMeasureStore((s) => s.toggleMode);
  const setDistanceUnit = useMeasureStore((s) => s.setDistanceUnit);
  const setAreaUnit = useMeasureStore((s) => s.setAreaUnit);
  const requestClear = useMeasureStore((s) => s.requestClear);

  if (hideTrigger && !panelOpen) return null;

  const activeTool = TOOLS.find((t) => t.kind === mode);
  const rows = reading ? describeReading(reading, { distance: distanceUnit, area: areaUnit }) : [];

  const panelNode = panelOpen ? (
    <div className="pointer-events-auto w-60 max-w-[calc(100vw-5rem)] bg-[#151b2b]/95 backdrop-blur-xl border border-[#2f3445] rounded-xl shadow-2xl shadow-black/70 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#242a3a] bg-[#191f2f]">
        <div className="flex items-center gap-2">
          <Ruler className="w-3.5 h-3.5 text-[#ffb95f]" />
          <span className="text-[11px] font-bold text-[#dde2f8] uppercase tracking-wide">Medir</span>
        </div>
        <button onClick={closePanel} className="text-[#869397] hover:text-[#dde2f8] transition-colors" title="Cerrar">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Iconos de herramientas */}
      <div className="grid grid-cols-3 gap-1.5 p-2">
        {TOOLS.map(({ kind, label, title, Icon }) => (
          <button
            key={kind}
            onClick={() => toggleMode(kind)}
            title={title}
            aria-pressed={mode === kind}
            className={cn(
              'flex flex-col items-center justify-center gap-1 py-2 rounded-lg border text-[10px] font-semibold transition-all duration-150',
              mode === kind
                ? 'bg-[#ffb95f] border-[#ffb95f] text-[#563400] shadow-md'
                : 'bg-[#0d1322] border-[#242a3a] text-[#bcc9cd] hover:text-[#dde2f8] hover:border-[#4cd7f6]/50'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
        <button
          onClick={requestClear}
          title="Borrar todas las mediciones del mapa"
          className="flex flex-col items-center justify-center gap-1 py-2 rounded-lg border border-[#242a3a] bg-[#0d1322] text-[10px] font-semibold text-[#ffb4ab] hover:bg-red-500/20 hover:border-red-400/40 transition-all duration-150"
        >
          <Trash2 className="w-4 h-4" />
          Borrar
        </button>
      </div>

      {/* Ayuda contextual */}
      <div className="px-3 pb-2 text-[10px] leading-tight text-[#bcc9cd]">
        {activeTool ? (
          <>
            <span className="text-[#ffb95f] font-semibold">{activeTool.label}:</span> {activeTool.hint}.{' '}
            <span className="text-[#869397]">Esc cancela · Retroceso deshace el último punto.</span>
          </>
        ) : (
          'Elige una herramienta para empezar a medir.'
        )}
      </div>

      {/* Lectura */}
      {rows.length > 0 && (
        <div className="mx-2 mb-2 rounded-lg bg-[#080e1d] border border-[#242a3a] divide-y divide-[#242a3a]">
          <div className="flex items-center justify-between px-2.5 py-1">
            <span className="text-[9px] font-mono font-bold text-[#869397] uppercase tracking-wider">
              {live ? 'En curso' : 'Última medición'}
            </span>
            {live && <span className="w-1.5 h-1.5 rounded-full bg-[#ffb95f] animate-pulse" />}
          </div>
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-2 px-2.5 py-1">
              <span className="text-[10px] text-[#bcc9cd]">{r.label}</span>
              <span className="text-[11px] font-mono font-semibold text-[#ffb95f] tabular-nums text-right">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Unidades */}
      <div className="flex items-center gap-2 px-2 pb-2.5">
        <label className="flex-1 flex items-center gap-1 text-[10px] text-[#bcc9cd] min-w-0">
          Dist.
          <select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value as DistanceUnit)} className={selectCls}>
            {DISTANCE_UNITS.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
          </select>
        </label>
        <label className="flex-1 flex items-center gap-1 text-[10px] text-[#bcc9cd] min-w-0">
          Área
          <select value={areaUnit} onChange={(e) => setAreaUnit(e.target.value as AreaUnit)} className={selectCls}>
            {AREA_UNITS.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
          </select>
        </label>
      </div>
    </div>
  ) : null;

  if (hideTrigger) {
    return (
      <div className="absolute right-14 top-1/2 -translate-y-1/2 z-30 pointer-events-auto">
        {panelNode}
      </div>
    );
  }

  return (
    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex items-start gap-2 pointer-events-none">
      <button
        onClick={() => (panelOpen ? closePanel() : openPanel())}
        title={panelOpen ? 'Cerrar herramientas de medición' : 'Herramientas de medición'}
        aria-pressed={panelOpen}
        className={cn(
          'pointer-events-auto w-10 h-10 flex items-center justify-center rounded-xl border shadow-2xl backdrop-blur-md transition-all duration-150',
          panelOpen
            ? 'bg-[#ffb95f] border-[#ffb95f] text-[#563400] shadow-md'
            : 'bg-[#151b2b]/92 border-[#242a3a] text-[#bcc9cd] hover:text-[#dde2f8] hover:border-[#4cd7f6]/50'
        )}
      >
        <Ruler className="w-5 h-5" />
      </button>

      {panelNode}
    </div>
  );
}
