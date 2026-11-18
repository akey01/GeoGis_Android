/**
 * LayerBand.tsx — Banda inferior anclada con el selector de capas del visor.
 *
 * Componente puramente presentacional: no contiene lógica de capas ni de permisos.
 * MapViewer le pasa el estado y los handlers existentes (handleToggleLayer,
 * handleToggleRoads, handleTogglePlaces). Al estar anclada debajo del mapa
 * (y no superpuesta), no oculta ninguna parte del visor.
 */

'use client';

import React from 'react';
import { Map as MapIcon, Satellite, Layers, Globe, Route, MapPin, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BaseLayerType } from '@/src/store/useMapStore';

export interface LayerBandProps {
  baseLayer: BaseLayerType;
  /** Calles efectivamente visibles (activadas y con base satelital/híbrida). */
  roadsActive: boolean;
  /** Sitios efectivamente visibles (activados y con base satelital/híbrida). */
  placesActive: boolean;
  onSelectLayer: (layer: BaseLayerType) => void;
  onToggleRoads: () => void;
  onTogglePlaces: () => void;
  satCalibActive?: boolean;
  satCalibOffsetNonZero?: boolean;
  onToggleSatCalib?: () => void;
}

function OnOffBadge({ on, tone }: { on: boolean; tone: 'blue' | 'purple' | 'emerald' }) {
  return (
    <span
      className={cn(
        'text-[9px] px-1 rounded font-mono font-bold leading-4 border',
        on
          ? tone === 'blue'
            ? 'bg-blue-400/30 text-blue-200 border-blue-300/40'
            : tone === 'emerald'
              ? 'bg-emerald-400/30 text-emerald-200 border-emerald-300/40'
              : 'bg-purple-400/30 text-purple-200 border-purple-300/40'
          : 'bg-slate-800 text-slate-500 border-white/5'
      )}
    >
      {on ? 'ON' : 'OFF'}
    </span>
  );
}

export default function LayerBand({
  baseLayer,
  roadsActive,
  placesActive,
  onSelectLayer,
  onToggleRoads,
  onTogglePlaces,
  satCalibActive = false,
  satCalibOffsetNonZero = false,
  onToggleSatCalib,
}: LayerBandProps) {
  return (
    <div
      role="toolbar"
      aria-label="Capas del mapa"
      className="shrink-0 flex items-center justify-start sm:justify-center gap-1.5 px-2 py-1.5 bg-slate-900/95 border-t border-white/10 backdrop-blur-md overflow-x-auto no-scrollbar"
    >
      <span className="hidden md:block text-[9px] font-mono font-bold text-slate-500 uppercase tracking-wider pr-1">
        Capas
      </span>

      {/* Capas base: Google Satélite, Google Híbrido, Esri Satélite (Alternativo), Calles */}
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-800/70 border border-white/5 shrink-0">
        <button
          onClick={() => onSelectLayer('satellite')}
          title="Google Satélite (Ortofoto pura de alta resolución)"
          aria-pressed={baseLayer === 'satellite'}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 whitespace-nowrap',
            baseLayer === 'satellite'
              ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
          )}
        >
          <Satellite className="w-3.5 h-3.5 shrink-0" />
          <span>Satélite</span>
        </button>

        <button
          onClick={() => onSelectLayer('hybrid')}
          title="Google Híbrido (Satélite + Vialidad y Etiquetas)"
          aria-pressed={baseLayer === 'hybrid'}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 whitespace-nowrap',
            baseLayer === 'hybrid'
              ? 'bg-teal-500 text-white shadow-md shadow-teal-500/30'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
          )}
        >
          <Layers className="w-3.5 h-3.5 shrink-0" />
          <span>Híbrido</span>
        </button>

        <button
          onClick={() => onSelectLayer('esri')}
          title="Esri World Imagery (Proveedor satelital alternativo para zonas con nubes en Google)"
          aria-pressed={baseLayer === 'esri'}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 whitespace-nowrap',
            baseLayer === 'esri'
              ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
          )}
        >
          <Globe className="w-3.5 h-3.5 shrink-0" />
          <span>Esri</span>
        </button>

        <button
          onClick={() => onSelectLayer('streets')}
          title="Calles (Mapa vectorial callejero)"
          aria-pressed={baseLayer === 'streets'}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 whitespace-nowrap',
            baseLayer === 'streets'
              ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/30'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
          )}
        >
          <MapIcon className="w-3.5 h-3.5 shrink-0" />
          <span>Calles</span>
        </button>
      </div>

      <div className="w-px h-5 bg-white/10 shrink-0" />

      {/* Superposiciones */}
      <button
        onClick={onToggleRoads}
        title={roadsActive ? 'Ocultar nombres y líneas de calles' : 'Mostrar nombres y líneas de calles'}
        aria-pressed={roadsActive}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all duration-150 whitespace-nowrap shrink-0',
          roadsActive
            ? 'bg-blue-600/90 border-blue-400 text-white shadow-md shadow-blue-500/30'
            : 'bg-slate-800/70 border-white/10 text-slate-400 hover:border-blue-500/50 hover:text-white'
        )}
      >
        <Route className="w-3.5 h-3.5 shrink-0" />
        <span>Vías</span>
        <OnOffBadge on={roadsActive} tone="blue" />
      </button>

      <button
        onClick={onTogglePlaces}
        title={placesActive ? 'Ocultar sitios de interés, posadas y comercios' : 'Mostrar sitios de interés, posadas y comercios'}
        aria-pressed={placesActive}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all duration-150 whitespace-nowrap shrink-0',
          placesActive
            ? 'bg-purple-600/90 border-purple-400 text-white shadow-md shadow-purple-500/30'
            : 'bg-slate-800/70 border-white/10 text-slate-400 hover:border-purple-500/50 hover:text-white'
        )}
      >
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span>Sitios</span>
        <OnOffBadge on={placesActive} tone="purple" />
      </button>

      {onToggleSatCalib && (
        <>
          <div className="w-px h-5 bg-white/10 shrink-0" />
          <button
            onClick={onToggleSatCalib}
            title="Calibrar Satélite (Desplazamiento ΔE / ΔN o Amarrar con Punto)"
            aria-pressed={satCalibActive}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all duration-150 whitespace-nowrap shrink-0',
              satCalibOffsetNonZero
                ? 'bg-emerald-600/90 border-emerald-400 text-white shadow-md shadow-emerald-500/30'
                : satCalibActive
                  ? 'bg-cyan-600/90 border-cyan-400 text-white shadow-md shadow-cyan-500/30'
                  : 'bg-slate-800/70 border-white/10 text-slate-300 hover:border-cyan-500/50 hover:text-white'
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span>Calibrar</span>
            <OnOffBadge on={satCalibOffsetNonZero} tone="emerald" />
          </button>
        </>
      )}
    </div>
  );
}

