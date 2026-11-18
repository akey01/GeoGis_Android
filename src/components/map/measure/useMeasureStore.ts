/**
 * useMeasureStore.ts — Estado (Zustand) de las herramientas de medición.
 * Independiente de useMapStore/useAppStore. Todo es temporal: nada se persiste.
 */

import { create } from 'zustand';
import type { AreaUnit, DistanceUnit, MeasureKind, MeasureReading } from './measureUtils';

export type MeasureMode = 'off' | MeasureKind;

interface MeasureState {
  /** Panel de medición abierto. */
  panelOpen: boolean;
  /** Herramienta activa ('off' = ninguna). */
  mode: MeasureMode;
  distanceUnit: DistanceUnit;
  areaUnit: AreaUnit;
  /** Última lectura (en vivo mientras se dibuja, o la última finalizada). */
  reading: MeasureReading | null;
  /** true mientras hay un trazo en curso. */
  live: boolean;
  /** Se incrementa para ordenar al mapa borrar todas las medidas. */
  clearVersion: number;

  openPanel: () => void;
  closePanel: () => void;
  setMode: (mode: MeasureMode) => void;
  toggleMode: (mode: MeasureKind) => void;
  setDistanceUnit: (u: DistanceUnit) => void;
  setAreaUnit: (u: AreaUnit) => void;
  setReading: (reading: MeasureReading | null, live: boolean) => void;
  requestClear: () => void;
}

export const useMeasureStore = create<MeasureState>((set) => ({
  panelOpen: false,
  mode: 'off',
  distanceUnit: 'auto',
  areaUnit: 'auto',
  reading: null,
  live: false,
  clearVersion: 0,

  openPanel: () => set({ panelOpen: true }),
  // Cerrar el panel también desactiva la herramienta (las medidas dibujadas permanecen).
  closePanel: () => set({ panelOpen: false, mode: 'off', live: false }),
  setMode: (mode) => set(mode === 'off' ? { mode, live: false } : { mode }),
  toggleMode: (mode) =>
    set((s) => (s.mode === mode ? { mode: 'off', live: false } : { mode, panelOpen: true, live: false })),
  setDistanceUnit: (distanceUnit) => set({ distanceUnit }),
  setAreaUnit: (areaUnit) => set({ areaUnit }),
  setReading: (reading, live) => set({ reading, live }),
  requestClear: () => set((s) => ({ clearVersion: s.clearVersion + 1, reading: null, live: false })),
}));

