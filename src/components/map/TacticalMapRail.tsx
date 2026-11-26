/**
 * TacticalMapRail.tsx — Paleta táctica unificada, ampliada y arrastrable (estilo GeoGIS Android)
 * GeoGIS6
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  Globe,
  Grid3x3,
  GripHorizontal,
  Layers,
  Lock,
  Map as MapIcon,
  MapPin,
  Maximize2,
  Minus,
  MousePointer,
  Move,
  PenTool,
  Plus,
  RotateCcw,
  Route,
  Ruler,
  Satellite,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Parcel } from '@/lib/store';
import type { BaseLayerType } from '@/src/store/useMapStore';
import MeasureToolbar from '@/src/components/map/measure/MeasureToolbar';

export type TacticalPopoverType = 'none' | 'layers' | 'move' | 'calib';

const RAIL_STORAGE_KEY = 'geogis6_tactical_rail_pos';
const RAIL_MARGIN = 8;

export interface TacticalMapRailProps {
  baseLayer: BaseLayerType;
  roadsActive: boolean;
  placesActive: boolean;
  canUseSatellite: boolean;
  showAllParcels: boolean;
  parcelsCount: number;
  onFitAll: () => void;
  onToggleShowAllParcels: () => void;
  onSelectLayer: (layer: BaseLayerType) => void;
  onToggleRoads: () => void;
  onTogglePlaces: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;

  mapTool: 'select' | 'move';
  isDrawing: boolean;
  measureOpen: boolean;
  savedParcels: Parcel[];
  selectedParcelId: string | null;
  movableParcelIds: string[];
  onSelectTool: () => void;
  onToggleMoveTool: () => void;
  onToggleParcelMovement: (parcelId: string) => void;
  onClearAllParcelMovement: () => void;
  onToggleDraw: () => void;
  onToggleMeasure: () => void;

  satOffset: { dE: number; dN: number };
  calibStep: 'off' | 'vertex' | 'photo';
  onChangeSatOffset: (next: { dE: number; dN: number }) => void;
  onResetSatCalib: () => void;
  onToggleCalibPin: () => void;
  labelSizeOffset: number;
  onIncreaseText: () => void;
  onDecreaseText: () => void;
  onResetText: () => void;

  activePopover: TacticalPopoverType;
  onChangePopover: (next: TacticalPopoverType) => void;
}

const LAYER_OPTIONS: Array<{
  id: BaseLayerType;
  label: string;
  desc: string;
  satRequired: boolean;
  Icon: typeof Satellite;
}> = [
  { id: 'satellite', label: 'Google Satélite', desc: 'Ortofoto pura HD', satRequired: true, Icon: Satellite },
  { id: 'hybrid', label: 'Google Híbrido', desc: 'Satélite + vialidad', satRequired: true, Icon: Layers },
  { id: 'esri', label: 'Esri Satélite', desc: 'Alternativo sin nubes', satRequired: true, Icon: Globe },
  { id: 'streets', label: 'Calles', desc: 'Mapa vectorial vial', satRequired: false, Icon: MapIcon },
  { id: 'cad_dark', label: 'CAD Oscuro (Offline)', desc: 'Retícula técnica oscura', satRequired: false, Icon: Grid3x3 },
];

function RailTooltip({
  label,
  shortcut,
  openRight,
}: {
  label: string;
  shortcut?: string;
  openRight?: boolean;
}) {
  return (
    <span
      className={cn(
        'hidden group-hover:flex absolute top-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-1 rounded-md bg-[#080e1d]/95 border border-[#2f3445] text-[10.5px] font-medium text-[#dde2f8] shadow-xl pointer-events-none items-center gap-1.5 z-40',
        openRight ? 'left-12' : 'right-12'
      )}
    >
      <span>{label}</span>
      {shortcut && (
        <span className="px-1 py-0.5 rounded bg-[#191f2f] border border-[#2f3445] text-[9px] font-mono text-[#4cd7f6] leading-none">
          {shortcut}
        </span>
      )}
    </span>
  );
}

function clampPos(
  x: number,
  y: number,
  parentW: number,
  parentH: number,
  railW: number,
  railH: number
): { x: number; y: number } {
  const maxX = Math.max(RAIL_MARGIN, parentW - railW - RAIL_MARGIN);
  const maxY = Math.max(RAIL_MARGIN, parentH - railH - RAIL_MARGIN);
  return {
    x: Math.round(Math.min(maxX, Math.max(RAIL_MARGIN, x))),
    y: Math.round(Math.min(maxY, Math.max(RAIL_MARGIN, y))),
  };
}

export default function TacticalMapRail({
  baseLayer,
  roadsActive,
  placesActive,
  canUseSatellite,
  showAllParcels,
  parcelsCount,
  onFitAll,
  onToggleShowAllParcels,
  onSelectLayer,
  onToggleRoads,
  onTogglePlaces,
  onZoomIn,
  onZoomOut,
  mapTool,
  isDrawing,
  measureOpen,
  savedParcels,
  selectedParcelId,
  movableParcelIds,
  onSelectTool,
  onToggleMoveTool,
  onToggleParcelMovement,
  onClearAllParcelMovement,
  onToggleDraw,
  onToggleMeasure,
  satOffset,
  calibStep,
  onChangeSatOffset,
  onResetSatCalib,
  onToggleCalibPin,
  labelSizeOffset,
  onIncreaseText,
  onDecreaseText,
  onResetText,
  activePopover,
  onChangePopover,
}: TacticalMapRailProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    parentW: number;
    parentH: number;
    railW: number;
    railH: number;
  } | null>(null);

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parentSize, setParentSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [railHeight, setRailHeight] = useState<number>(510);

  // Cargar posición guardada al montar
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RAIL_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
        setPos({ x: parsed.x, y: parsed.y });
      }
    } catch {
      // Ignorar storage inaccesible
    }
  }, []);

  // Reajustar posición ante cambios de tamaño del visor/ventana
  useEffect(() => {
    const parent = wrapperRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return;

    const syncSizes = () => {
      const pw = parent.clientWidth;
      const ph = parent.clientHeight;
      const rw = railRef.current?.offsetWidth || 52;
      const rh = railRef.current?.offsetHeight || 510;
      setParentSize({ w: pw, h: ph });
      setRailHeight(rh);
      setPos((prev) => (prev ? clampPos(prev.x, prev.y, pw, ph, rw, rh) : prev));
    };

    syncSizes();
    const ro = new ResizeObserver(syncSizes);
    ro.observe(parent);
    if (railRef.current) ro.observe(railRef.current);
    return () => ro.disconnect();
  }, []);

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const parent = wrapperRef.current?.offsetParent as HTMLElement | null;
    const railEl = railRef.current;
    if (!parent || !railEl) return;

    const pRect = parent.getBoundingClientRect();
    const rRect = railEl.getBoundingClientRect();
    const startX = pos ? pos.x : rRect.left - pRect.left;
    const startY = pos ? pos.y : rRect.top - pRect.top;

    dragSessionRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX,
      startY,
      parentW: parent.clientWidth,
      parentH: parent.clientHeight,
      railW: rRect.width || 52,
      railH: rRect.height || 510,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore pointer capture fallback
    }
    setDragging(true);
    if (!pos) {
      setPos(clampPos(startX, startY, parent.clientWidth, parent.clientHeight, rRect.width || 52, rRect.height || 510));
    }
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - sess.startClientX;
    const dy = e.clientY - sess.startClientY;
    setPos(clampPos(sess.startX + dx, sess.startY + dy, sess.parentW, sess.parentH, sess.railW, sess.railH));
  };

  const handleDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.pointerId !== e.pointerId) return;
    e.stopPropagation();
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    const dx = e.clientX - sess.startClientX;
    const dy = e.clientY - sess.startClientY;
    const finalPos = clampPos(sess.startX + dx, sess.startY + dy, sess.parentW, sess.parentH, sess.railW, sess.railH);
    dragSessionRef.current = null;
    setDragging(false);
    setPos(finalPos);
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify(finalPos));
    } catch {
      // ignore
    }
  };

  const handleDragDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    dragSessionRef.current = null;
    setDragging(false);
    setPos(null);
    try {
      window.localStorage.removeItem(RAIL_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const calibActive = satOffset.dE !== 0 || satOffset.dN !== 0 || calibStep !== 'off';
  const moveActive = mapTool === 'move' || movableParcelIds.length > 0;

  const togglePopover = (target: Exclude<TacticalPopoverType, 'none'>) => {
    onChangePopover(activePopover === target ? 'none' : target);
  };

  // Orientación inteligente de tooltips y popovers según ubicación actual del riel
  const openRight = pos !== null && parentSize.w > 0 && pos.x + 26 < parentSize.w / 2;
  const nearTop = pos !== null && pos.y < 140;
  const nearBottom = pos !== null && parentSize.h > 0 && pos.y + railHeight > parentSize.h - 140;
  const popoverVerticalCls = nearTop
    ? 'top-0'
    : nearBottom
      ? 'bottom-0'
      : 'top-1/2 -translate-y-1/2';

  const hasPopover = activePopover !== 'none' || measureOpen;

  return (
    <div
      ref={wrapperRef}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={cn(
        'absolute z-30 pointer-events-none',
        !pos && 'right-3 top-1/2 -translate-y-1/2'
      )}
    >
      {/* ── Popover Desplegable hacia el Interior del Mapa (Lado Inteligente) ─ */}
      {hasPopover && (
        <div
          className={cn(
            'absolute z-30 pointer-events-auto',
            openRight ? 'left-full ml-2.5' : 'right-full mr-2.5',
            popoverVerticalCls
          )}
        >
          {measureOpen && <MeasureToolbar hideTrigger inline />}

          {activePopover === 'layers' && (
            <div className="w-64 bg-[#151b2b]/95 backdrop-blur-xl border border-[#2f3445] rounded-xl shadow-2xl shadow-black/70 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#242a3a] bg-[#191f2f]">
                <div className="flex items-center gap-2">
                  <Satellite className="w-3.5 h-3.5 text-[#4cd7f6]" />
                  <span className="text-[11px] font-bold text-[#dde2f8] uppercase tracking-wide">Capas Base</span>
                </div>
                <button
                  type="button"
                  onClick={() => onChangePopover('none')}
                  className="text-[#869397] hover:text-[#dde2f8] transition-colors"
                  title="Cerrar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="p-2 space-y-1">
                {LAYER_OPTIONS.map(({ id, label, desc, satRequired, Icon }) => {
                  const active = baseLayer === id;
                  const locked = satRequired && !canUseSatellite;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelectLayer(id)}
                      className={cn(
                        'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-all duration-150',
                        active
                          ? id === 'cad_dark'
                            ? 'bg-[#ffb95f]/20 border-[#ffb95f] text-[#ffb95f]'
                            : 'bg-[#06b6d4]/20 border-[#4cd7f6] text-[#dde2f8]'
                          : locked
                            ? 'bg-[#080e1d]/60 border-[#242a3a] text-[#869397] opacity-65'
                            : 'bg-[#0d1322] border-[#242a3a] text-[#bcc9cd] hover:text-[#dde2f8] hover:border-[#4cd7f6]/40'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon
                          className={cn(
                            'w-3.5 h-3.5 shrink-0',
                            active ? (id === 'cad_dark' ? 'text-[#ffb95f]' : 'text-[#4cd7f6]') : 'text-[#869397]'
                          )}
                        />
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold truncate">{label}</div>
                          <div className="text-[9px] text-[#869397] truncate">{desc}</div>
                        </div>
                      </div>
                      {locked ? (
                        <Lock className="w-3 h-3 text-[#ffb95f] shrink-0" />
                      ) : active ? (
                        <span
                          className={cn(
                            'text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0',
                            id === 'cad_dark' ? 'bg-[#ffb95f] text-[#563400]' : 'bg-[#4cd7f6] text-[#003640]'
                          )}
                        >
                          ON
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="px-2 pb-2 pt-1.5 border-t border-[#242a3a] grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={onToggleRoads}
                  disabled={!canUseSatellite || baseLayer === 'cad_dark'}
                  className={cn(
                    'flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-semibold transition-all disabled:opacity-40',
                    roadsActive
                      ? 'bg-[#06b6d4]/20 border-[#4cd7f6] text-[#4cd7f6]'
                      : 'bg-[#0d1322] border-[#242a3a] text-[#bcc9cd] hover:text-[#dde2f8]'
                  )}
                  title="Mostrar u ocultar líneas y nombres de calles"
                >
                  <span className="flex items-center gap-1">
                    <Route className="w-3 h-3" />
                    Vialidad
                  </span>
                  <span className="font-mono text-[8.5px]">{roadsActive ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  type="button"
                  onClick={onTogglePlaces}
                  disabled={!canUseSatellite || baseLayer === 'cad_dark'}
                  className={cn(
                    'flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-semibold transition-all disabled:opacity-40',
                    placesActive
                      ? 'bg-[#00a572]/25 border-[#4edea3] text-[#4edea3]'
                      : 'bg-[#0d1322] border-[#242a3a] text-[#bcc9cd] hover:text-[#dde2f8]'
                  )}
                  title="Mostrar u ocultar sitios de interés"
                >
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    Sitios
                  </span>
                  <span className="font-mono text-[8.5px]">{placesActive ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </div>
          )}

          {activePopover === 'move' && (
            <div className="w-64 bg-[#151b2b]/95 backdrop-blur-xl border border-[#2f3445] rounded-xl shadow-2xl shadow-black/70 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#242a3a] bg-[#191f2f]">
                <div className="flex items-center gap-2">
                  <Move className="w-3.5 h-3.5 text-[#ffb95f]" />
                  <span className="text-[11px] font-bold text-[#dde2f8] uppercase tracking-wide">Mover Parcelas</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {movableParcelIds.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearAllParcelMovement}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 border border-red-400/40 text-[#ffb4ab] hover:bg-red-500/30 transition-colors font-bold"
                      title="Desactivar movimiento en todas las parcelas"
                    >
                      Limpiar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onChangePopover('none')}
                    className="text-[#869397] hover:text-[#dde2f8] transition-colors"
                    title="Cerrar"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="p-2 space-y-2">
                <button
                  type="button"
                  onClick={onToggleMoveTool}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-bold transition-all',
                    mapTool === 'move'
                      ? 'bg-[#ffb95f] border-[#ffb95f] text-[#563400] shadow-md'
                      : 'bg-[#0d1322] border-[#242a3a] text-[#dde2f8] hover:border-[#ffb95f]/60'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Move className="w-3.5 h-3.5" />
                    Mover todas con ratón
                  </span>
                  <span className="font-mono text-[9px]">{mapTool === 'move' ? 'ON' : 'OFF'}</span>
                </button>

                {savedParcels.length > 0 ? (
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-[#242a3a] bg-[#080e1d] divide-y divide-[#242a3a]">
                    {savedParcels.map((parcel) => {
                      const isMovable = movableParcelIds.includes(parcel.id);
                      const isSelected = selectedParcelId === parcel.id;
                      return (
                        <div
                          key={parcel.id}
                          className={cn(
                            'flex items-center gap-2 px-2.5 py-2 transition-colors',
                            isSelected ? 'bg-[#06b6d4]/15 border-l-2 border-[#4cd7f6]' : 'hover:bg-[#191f2f]/70'
                          )}
                        >
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                            style={{ backgroundColor: parcel.hatchColor || '#ffff00' }}
                          />
                          <span className="flex-1 text-[11px] font-medium text-[#dde2f8] truncate">{parcel.nombre}</span>
                          <button
                            type="button"
                            onClick={() => onToggleParcelMovement(parcel.id)}
                            className={cn(
                              'px-2 py-0.5 rounded text-[9.5px] font-mono font-bold border transition-colors shrink-0',
                              isMovable
                                ? 'bg-[#ffb95f] border-[#ffb95f] text-[#563400]'
                                : 'bg-[#151b2b] border-[#2f3445] text-[#bcc9cd] hover:border-[#ffb95f]/60 hover:text-[#dde2f8]'
                            )}
                          >
                            {isMovable ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] text-[#869397] text-center py-2">
                    No hay parcelas guardadas en el proyecto.
                  </p>
                )}
              </div>
            </div>
          )}

          {activePopover === 'calib' && (
            <div className="w-64 bg-[#151b2b]/95 backdrop-blur-xl border border-[#2f3445] rounded-xl shadow-2xl shadow-black/70 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#242a3a] bg-[#191f2f]">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#4edea3]" />
                  <span className="text-[11px] font-bold text-[#dde2f8] uppercase tracking-wide">Calibrar Satélite</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onResetSatCalib}
                    disabled={satOffset.dE === 0 && satOffset.dN === 0 && calibStep === 'off'}
                    title="Restablecer desplazamiento a 0 m"
                    className="flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded bg-[#0d1322] border border-[#242a3a] text-[#bcc9cd] hover:text-[#dde2f8] hover:border-[#4cd7f6]/40 disabled:opacity-40 transition-colors font-mono"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangePopover('none')}
                    className="text-[#869397] hover:text-[#dde2f8] transition-colors"
                    title="Cerrar"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="p-2.5 space-y-2">
                <button
                  type="button"
                  onClick={onToggleCalibPin}
                  title="Alinear foto en 2 clics: 1) Clic en vértice del polígono, 2) Clic en rincón real sobre la foto satelital"
                  className={cn(
                    'w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all duration-150',
                    calibStep !== 'off'
                      ? 'bg-[#4edea3] border-[#6ffbbe] text-[#003824] shadow-md animate-pulse'
                      : 'bg-[#06b6d4]/15 border-[#4cd7f6]/40 text-[#4cd7f6] hover:bg-[#06b6d4]/25 hover:text-[#dde2f8]'
                  )}
                >
                  <Crosshair className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {calibStep === 'vertex'
                      ? '1/2 Clic en Vértice...'
                      : calibStep === 'photo'
                        ? '2/2 Clic en Foto...'
                        : 'Amarrar con Punto'}
                  </span>
                </button>

                <div className="grid grid-cols-2 gap-1.5">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-mono text-[#bcc9cd]">ΔE (m)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={satOffset.dE}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        onChangeSatOffset({ ...satOffset, dE: Number.isFinite(val) ? val : 0 });
                      }}
                      className="w-full px-1.5 py-1 rounded bg-[#080e1d] border border-[#242a3a] text-xs font-mono text-[#4cd7f6] tabular-nums focus:outline-none focus:border-[#4cd7f6]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[9px] font-mono text-[#bcc9cd]">ΔN (m)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={satOffset.dN}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        onChangeSatOffset({ ...satOffset, dN: Number.isFinite(val) ? val : 0 });
                      }}
                      className="w-full px-1.5 py-1 rounded bg-[#080e1d] border border-[#242a3a] text-xs font-mono text-[#4edea3] tabular-nums focus:outline-none focus:border-[#4edea3]"
                    />
                  </label>
                </div>

                <p className="text-[9.5px] text-[#869397] leading-tight">
                  Alinea visualmente la ortofoto con los vértices GNSS sin alterar coordenadas.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Paleta Táctica Única Vertical Ampliada (52px, Arrastrable) ────── */}
      <div
        ref={railRef}
        role="toolbar"
        aria-label="Paleta táctica del visor de mapa"
        className={cn(
          'pointer-events-auto w-[52px] bg-[#151b2b]/94 backdrop-blur-xl rounded-2xl border shadow-2xl py-1.5 flex flex-col items-center gap-0.5 transition-shadow',
          dragging ? 'border-[#4cd7f6] shadow-[#4cd7f6]/20' : 'border-[#2f3445]'
        )}
      >
        {/* Asa de Arrastre (Drag Handle + Doble Clic para Restablecer Posición) */}
        <div
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          onDoubleClick={handleDragDoubleClick}
          role="button"
          tabIndex={0}
          aria-label="Mover paleta de herramientas"
          className="w-10 h-6 rounded-lg flex items-center justify-center text-[#869397] hover:text-[#4cd7f6] hover:bg-[#242a3a]/70 cursor-grab active:cursor-grabbing touch-none select-none relative group transition-colors"
        >
          <GripHorizontal className="w-4 h-4" />
          <RailTooltip
            label={pos ? 'Arrastra para mover · Doble clic restablece' : 'Arrastra para mover paleta'}
            openRight={openRight}
          />
        </div>

        <div className="w-8 h-px bg-[#242a3a] my-0.5" />

        {/* 1. Navegación y Capas (Paridad Android) */}
        <button
          type="button"
          onClick={onFitAll}
          aria-label="Encuadrar Todas las Parcelas"
          className="w-10 h-9 rounded-lg flex items-center justify-center text-[#dde2f8] hover:text-[#4cd7f6] hover:bg-[#242a3a] transition-all duration-150 relative group active:scale-95"
        >
          <Maximize2 className="w-5 h-5" />
          <RailTooltip label="Encuadrar todo" shortcut="F" openRight={openRight} />
        </button>

        <button
          type="button"
          onClick={onToggleShowAllParcels}
          aria-label="Mostrar u ocultar colindantes"
          aria-pressed={showAllParcels}
          className={cn(
            'w-10 h-9 rounded-lg flex items-center justify-center transition-all duration-150 relative group active:scale-95',
            showAllParcels
              ? 'text-[#4edea3] bg-[#242a3a]/80'
              : 'text-[#bcc9cd] hover:text-[#dde2f8] hover:bg-[#242a3a]'
          )}
        >
          <Layers className="w-5 h-5" />
          <RailTooltip
            label={showAllParcels ? `Todas las parcelas (${parcelsCount})` : 'Solo parcela activa'}
            shortcut="L"
            openRight={openRight}
          />
        </button>

        <button
          type="button"
          onClick={() => togglePopover('layers')}
          aria-label="Capas Base del Mapa"
          aria-pressed={activePopover === 'layers'}
          className={cn(
            'w-10 h-9 rounded-lg flex items-center justify-center transition-all duration-150 relative group active:scale-95',
            activePopover === 'layers'
              ? 'bg-[#4cd7f6] text-[#003640] shadow-md'
              : baseLayer === 'cad_dark'
                ? 'bg-[#242a3a] text-[#ffb95f]'
                : 'text-[#4cd7f6] hover:bg-[#242a3a]'
          )}
        >
          <Satellite className="w-5 h-5" />
          <RailTooltip label="Capas base y superposiciones" shortcut="B" openRight={openRight} />
        </button>

        <button
          type="button"
          onClick={onZoomIn}
          aria-label="Acercar Zoom"
          className="w-10 h-9 rounded-lg flex items-center justify-center text-[#dde2f8] hover:text-[#4cd7f6] hover:bg-[#242a3a] transition-all duration-150 relative group active:scale-95"
        >
          <Plus className="w-5 h-5" />
          <RailTooltip label="Acercar" shortcut="+" openRight={openRight} />
        </button>

        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Alejar Zoom"
          className="w-10 h-9 rounded-lg flex items-center justify-center text-[#dde2f8] hover:text-[#4cd7f6] hover:bg-[#242a3a] transition-all duration-150 relative group active:scale-95"
        >
          <Minus className="w-5 h-5" />
          <RailTooltip label="Alejar" shortcut="-" openRight={openRight} />
        </button>

        <div className="w-8 h-px bg-[#242a3a] my-0.5" />

        {/* 2. Herramientas Tácticas */}
        <button
          type="button"
          onClick={onSelectTool}
          aria-label="Elegir Parcela"
          aria-pressed={mapTool === 'select' && !isDrawing && !measureOpen}
          className={cn(
            'w-10 h-9 rounded-lg flex items-center justify-center transition-all duration-150 relative group active:scale-95',
            mapTool === 'select' && !isDrawing && !measureOpen
              ? 'bg-[#4cd7f6] text-[#003640] shadow-md'
              : 'text-[#bcc9cd] hover:text-[#dde2f8] hover:bg-[#242a3a]'
          )}
        >
          <MousePointer className="w-5 h-5" />
          <RailTooltip label="Elegir / Seleccionar" shortcut="V" openRight={openRight} />
        </button>

        <button
          type="button"
          onClick={() => togglePopover('move')}
          aria-label="Mover Parcelas"
          aria-pressed={moveActive || activePopover === 'move'}
          className={cn(
            'w-10 h-9 rounded-lg flex items-center justify-center transition-all duration-150 relative group active:scale-95',
            moveActive
              ? 'bg-[#ffb95f] text-[#563400] shadow-md'
              : activePopover === 'move'
                ? 'bg-[#242a3a] text-[#ffb95f]'
                : 'text-[#bcc9cd] hover:text-[#ffb95f] hover:bg-[#242a3a]'
          )}
        >
          <Move className="w-5 h-5" />
          {movableParcelIds.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#080e1d] border border-[#ffb95f] text-[8.5px] font-mono font-bold text-[#ffb95f] flex items-center justify-center leading-none">
              {movableParcelIds.length}
            </span>
          )}
          <RailTooltip label="Mover parcelas con ratón" shortcut="M" openRight={openRight} />
        </button>

        <button
          type="button"
          onClick={onToggleDraw}
          aria-label={isDrawing ? 'Cancelar Nuevo Predio' : 'Dibujar Nuevo Predio'}
          aria-pressed={isDrawing}
          className={cn(
            'w-10 h-9 rounded-lg flex items-center justify-center transition-all duration-150 relative group active:scale-95',
            isDrawing
              ? 'bg-[#ffb95f] text-[#563400] shadow-md animate-pulse'
              : 'text-[#bcc9cd] hover:text-[#ffb95f] hover:bg-[#242a3a]'
          )}
        >
          <PenTool className="w-5 h-5" />
          <RailTooltip label={isDrawing ? 'Cancelar dibujo' : 'Nuevo Predio'} shortcut="D" openRight={openRight} />
        </button>

        <button
          type="button"
          onClick={onToggleMeasure}
          aria-label="Medir Distancia o Área"
          aria-pressed={measureOpen}
          className={cn(
            'w-10 h-9 rounded-lg flex items-center justify-center transition-all duration-150 relative group active:scale-95',
            measureOpen
              ? 'bg-[#ffb95f] text-[#563400] shadow-md'
              : 'text-[#bcc9cd] hover:text-[#ffb95f] hover:bg-[#242a3a]'
          )}
        >
          <Ruler className="w-5 h-5" />
          <RailTooltip label="Regla y medición" shortcut="R" openRight={openRight} />
        </button>

        <div className="w-8 h-px bg-[#242a3a] my-0.5" />

        {/* 3. Exclusivos Desktop (Calibración Satelital y Tamaño de Texto) */}
        <button
          type="button"
          onClick={() => togglePopover('calib')}
          aria-label="Calibrar Imagen Satelital"
          aria-pressed={calibActive || activePopover === 'calib'}
          className={cn(
            'w-10 h-9 rounded-lg flex items-center justify-center transition-all duration-150 relative group active:scale-95',
            calibActive
              ? 'bg-[#4edea3] text-[#003824] shadow-md'
              : activePopover === 'calib'
                ? 'bg-[#242a3a] text-[#4cd7f6]'
                : 'text-[#bcc9cd] hover:text-[#4edea3] hover:bg-[#242a3a]'
          )}
        >
          <SlidersHorizontal className="w-5 h-5" />
          <RailTooltip label="Calibrar satélite (ΔE / ΔN)" shortcut="C" openRight={openRight} />
        </button>

        <button
          type="button"
          onClick={onIncreaseText}
          disabled={labelSizeOffset >= 8}
          aria-label="Aumentar tamaño de letra de parcelas"
          className="w-10 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold text-[#dde2f8] hover:text-[#4cd7f6] hover:bg-[#242a3a] disabled:opacity-35 transition-colors relative group active:scale-95"
        >
          A+
          <RailTooltip label="Aumentar letra de parcela" openRight={openRight} />
        </button>

        <button
          type="button"
          onClick={onResetText}
          aria-label="Restablecer tamaño de letra"
          className={cn(
            'w-10 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold tabular-nums transition-colors relative group',
            labelSizeOffset !== 0
              ? 'text-[#4cd7f6] bg-[#242a3a]/80'
              : 'text-[#869397] hover:text-[#dde2f8]'
          )}
        >
          {labelSizeOffset > 0 ? `+${labelSizeOffset}` : labelSizeOffset < 0 ? `${labelSizeOffset}` : '1:1'}
          <RailTooltip label="Restablecer tamaño de letra (1:1)" openRight={openRight} />
        </button>

        <button
          type="button"
          onClick={onDecreaseText}
          disabled={labelSizeOffset <= -4}
          aria-label="Disminuir tamaño de letra de parcelas"
          className="w-10 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold text-[#dde2f8] hover:text-[#4cd7f6] hover:bg-[#242a3a] disabled:opacity-35 transition-colors relative group active:scale-95"
        >
          A−
          <RailTooltip label="Disminuir letra de parcela" openRight={openRight} />
        </button>
      </div>
    </div>
  );
}
