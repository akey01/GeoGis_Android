/**
 * useContourStore.ts — Estado Zustand independiente para Curvas de Nivel por Parcela
 * GeoGIS6
 */

'use client';

import { create } from 'zustand';
import { toast } from 'react-hot-toast';
import type { Parcel } from '@/lib/store';
import {
  fetchParcelDEMAndContours,
  rebuildParcelContoursWithInterval,
  type ParcelContourData,
} from './contourEngine';

function computeParcelFingerprint(parcel: Parcel): string {
  const pts = parcel.puntos || [];
  const p0 = pts[0];
  const e0 = p0?.result?.este ?? p0?.input?.este ?? '';
  const n0 = p0?.result?.norte ?? p0?.input?.norte ?? '';
  const d0 = p0?.direction ?? '';
  return `v6.3-hydro|${pts.length}|${e0}|${n0}|${d0}`;
}

interface ContourState {
  contoursByParcelId: Record<string, ParcelContourData>;
  fingerprintsByParcelId: Record<string, string>;
  visibleParcelIds: string[];
  loadingParcelIds: string[];
  focusedParcelId: string | null;
  printModalParcelId: string | null;
  satOffset: { dE: number; dN: number };
  showMapGrid: boolean;
  showMapGridNodes: boolean;

  setSatOffset: (offset: { dE: number; dN: number }) => void;
  toggleShowMapGrid: () => void;
  toggleShowMapGridNodes: () => void;
  setFocusedParcelId: (parcelId: string | null) => void;
  toggleParcelContours: (
    parcel: Parcel,
    defaultHuso: number,
    defaultDirection?: string,
    forceShow?: boolean
  ) => Promise<void>;
  recalculateParcelContours: (
    parcel: Parcel,
    defaultHuso: number,
    defaultDirection?: string,
    customInterval?: number
  ) => Promise<ParcelContourData | null>;
  setParcelInterval: (parcelId: string, interval: number) => void;
  hideParcelContours: (parcelId: string) => void;
  clearAllContours: () => void;
  removeParcelContours: (parcelId: string) => void;
  openPrintModalForParcel: (
    parcel: Parcel,
    defaultHuso: number,
    defaultDirection?: string
  ) => Promise<void>;
  closePrintModal: () => void;
}

export const useContourStore = create<ContourState>((set, get) => ({
  contoursByParcelId: {},
  fingerprintsByParcelId: {},
  visibleParcelIds: [],
  loadingParcelIds: [],
  focusedParcelId: null,
  printModalParcelId: null,
  satOffset: { dE: 0, dN: 0 },
  showMapGrid: true,
  showMapGridNodes: true,

  setSatOffset: (offset) => set({ satOffset: offset }),

  toggleShowMapGrid: () => set((s) => ({ showMapGrid: !s.showMapGrid })),

  toggleShowMapGridNodes: () => set((s) => ({ showMapGridNodes: !s.showMapGridNodes })),

  setFocusedParcelId: (parcelId) => set({ focusedParcelId: parcelId }),

  recalculateParcelContours: async (parcel, defaultHuso, defaultDirection, customInterval) => {
    const pid = parcel.id;
    const fp = computeParcelFingerprint(parcel);

    if (!get().loadingParcelIds.includes(pid)) {
      set((s) => ({ loadingParcelIds: [...s.loadingParcelIds, pid] }));
    }

    try {
      const data = await fetchParcelDEMAndContours(
        parcel,
        defaultHuso,
        customInterval,
        defaultDirection
      );

      set((s) => ({
        contoursByParcelId: { ...s.contoursByParcelId, [pid]: data },
        fingerprintsByParcelId: { ...s.fingerprintsByParcelId, [pid]: fp },
        visibleParcelIds: s.visibleParcelIds.includes(pid)
          ? s.visibleParcelIds
          : [...s.visibleParcelIds, pid],
        focusedParcelId: pid,
        loadingParcelIds: s.loadingParcelIds.filter((id) => id !== pid),
      }));

      toast.success(
        `Curvas calculadas (${parcel.nombre || 'Parcela'}): ΔH=${data.deltaH.toFixed(1)}m · Equid. ${data.interval}m`,
        { id: `contour-${pid}`, duration: 3500 }
      );
      return data;
    } catch (err: any) {
      set((s) => ({
        loadingParcelIds: s.loadingParcelIds.filter((id) => id !== pid),
      }));
      toast.error(err?.message || 'No se pudieron calcular las curvas de nivel.');
      return null;
    }
  },

  toggleParcelContours: async (parcel, defaultHuso, defaultDirection, forceShow = false) => {
    const pid = parcel.id;
    const state = get();
    if (state.loadingParcelIds.includes(pid)) return;

    const isVisible = state.visibleParcelIds.includes(pid);
    if (isVisible && !forceShow) {
      set((s) => {
        const nextVisible = s.visibleParcelIds.filter((id) => id !== pid);
        return {
          visibleParcelIds: nextVisible,
          focusedParcelId:
            s.focusedParcelId === pid
              ? nextVisible[nextVisible.length - 1] ?? null
              : s.focusedParcelId,
        };
      });
      return;
    }

    const existing = state.contoursByParcelId[pid];
    const currentFp = computeParcelFingerprint(parcel);
    const cachedFp = state.fingerprintsByParcelId[pid];
    const isStaleFlatCache =
      !existing ||
      !existing.sourceType ||
      !existing.denseGridCols ||
      !(existing.areaM2 > 0);

    if (!isStaleFlatCache && cachedFp === currentFp) {
      set((s) => ({
        visibleParcelIds: s.visibleParcelIds.includes(pid)
          ? s.visibleParcelIds
          : [...s.visibleParcelIds, pid],
        focusedParcelId: pid,
      }));
      return;
    }

    await get().recalculateParcelContours(parcel, defaultHuso, defaultDirection);
  },

  setParcelInterval: (parcelId, interval) => {
    const existing = get().contoursByParcelId[parcelId];
    if (!existing) return;
    const updated = rebuildParcelContoursWithInterval(existing, interval);
    if (updated.wasIntervalClamped) {
      toast.error(
        `${updated.uncertaintyWarning ?? 'Altimetría satelital (30m/px): equidistancia mínima 0.2 m.'} Ajustado a ΔZ = ${updated.interval} m.`,
        { id: `sat-clamp-${parcelId}`, duration: 5000 }
      );
    } else if (updated.sourceType === 'SATELLITE_DEM' && updated.interval < 1) {
      toast(
        `Equidistancia ΔZ = ${updated.interval} m (anteproyecto referencial satelital).`,
        { id: `sat-sub-${parcelId}`, icon: '⚠️', duration: 3500 }
      );
    }
    set((s) => ({
      contoursByParcelId: { ...s.contoursByParcelId, [parcelId]: updated },
    }));
  },

  hideParcelContours: (parcelId) => {
    set((s) => {
      const nextVisible = s.visibleParcelIds.filter((id) => id !== parcelId);
      return {
        visibleParcelIds: nextVisible,
        focusedParcelId:
          s.focusedParcelId === parcelId
            ? nextVisible[nextVisible.length - 1] ?? null
            : s.focusedParcelId,
      };
    });
  },

  clearAllContours: () => {
    set({
      contoursByParcelId: {},
      fingerprintsByParcelId: {},
      visibleParcelIds: [],
      loadingParcelIds: [],
      focusedParcelId: null,
      printModalParcelId: null,
    });
  },

  removeParcelContours: (parcelId) => {
    set((s) => {
      const { [parcelId]: _, ...restContours } = s.contoursByParcelId;
      const { [parcelId]: __, ...restFps } = s.fingerprintsByParcelId;
      const nextVisible = s.visibleParcelIds.filter((id) => id !== parcelId);
      return {
        contoursByParcelId: restContours,
        fingerprintsByParcelId: restFps,
        visibleParcelIds: nextVisible,
        focusedParcelId:
          s.focusedParcelId === parcelId
            ? nextVisible[nextVisible.length - 1] ?? null
            : s.focusedParcelId,
        printModalParcelId: s.printModalParcelId === parcelId ? null : s.printModalParcelId,
      };
    });
  },

  openPrintModalForParcel: async (parcel, defaultHuso, defaultDirection) => {
    const pid = parcel.id;
    const state = get();
    const existing = state.contoursByParcelId[pid];
    const currentFp = computeParcelFingerprint(parcel);
    const cachedFp = state.fingerprintsByParcelId[pid];
    const isStaleFlatCache =
      !existing ||
      !existing.sourceType ||
      !existing.denseGridCols ||
      !(existing.areaM2 > 0);

    if (isStaleFlatCache || cachedFp !== currentFp) {
      const data = await get().recalculateParcelContours(parcel, defaultHuso, defaultDirection);
      if (!data) return;
    } else if (!state.visibleParcelIds.includes(pid)) {
      set((s) => ({
        visibleParcelIds: [...s.visibleParcelIds, pid],
        focusedParcelId: pid,
      }));
    }

    set({ printModalParcelId: pid, focusedParcelId: pid });
  },

  closePrintModal: () => set({ printModalParcelId: null }),
}));
