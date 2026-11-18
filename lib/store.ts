'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { DXFPolygon } from '@/lib/file-service';

export interface Point {
  id: string;
  lat?: number;
  lng?: number;
  este?: number;
  norte?: number;
  huso?: number;
  alt?: number;
  desc?: string;
  parcel?: string;
}

export interface TransformationResult {
  id: string;
  input: Point;
  result: any; // Simplified for now
  ok: boolean;
  direction?: 'canoa_regven' | 'regven_canoa' | 'dma_psad56_real' | 'dma_regven';
}

export interface Parcel {
  id: string;
  nombre: string;
  fecha: string;
  area?: number;
  perim?: number;
  ha?: number;
  actualizado?: string;
  puntos: TransformationResult[];
  geometryType: 'abierta' | 'cerrada' | 'puntos';
  method?: 'badekas' | 'rigida' | 'rigida02' | 'dma_badekas' | 'dma_badekas_regven';
  rigidCorrection?: { dn: number; de: number };
  adicoraCorrection?: { dn: number; de: number; cotaGeoidal?: number };
  hatchColor?: string;
  hatchOpacity?: number;
  // Mensura Metadata
  estado?: string;
  municipio?: string;
  parroquia?: string;
  propietario?: string;
  rif?: string;
  domicilio?: string;
  ubicacionSector?: string;
  profesional?: string;
  civ?: string;
  zona?: string;
  seccion?: string;
  cedulaCat?: string;
  observaciones?: string;
}

export type UserRole =
  | 'admin'
  | 'senior'
  | 'junior'
  | 'viewer'
  | 'demo'
  | 'operador_campo'
  | 'revisor_catastral';

export interface AdicoraCorrection {
  de: number; // Traslación Este (m)
  dn: number; // Traslación Norte (m)
  cotaGeoidal: number; // Cota geoidal regional (m)
  presetId?: string;
}

export const ADICORA_DEFAULT_CORRECTION: AdicoraCorrection = {
  de: -204.330,
  dn: -311.540,
  cotaGeoidal: -22.450,
  presetId: 'al318'
};

export const ADICORA_PRESETS = [
  {
    id: 'al318',
    nombre: 'Adícora AL-318 (Hito Oficial IGVSB)',
    de: -204.330,
    dn: -311.540,
    cotaGeoidal: -22.450,
    descripcion: 'Península de Paraguaná / Sector Adícora. Calibración directa sobre punto de apoyo AL-318.'
  },
  {
    id: 'buchuaco',
    nombre: 'Sector Buchuaco (Ajuste Local)',
    de: -217.520,
    dn: -320.130,
    cotaGeoidal: -22.450,
    descripcion: 'Municipio Falcón, eje costero Buchuaco - Adícora.'
  },
  {
    id: 'supi',
    nombre: 'Sector El Supí (Calibrado)',
    de: -227.310,
    dn: -330.030,
    cotaGeoidal: -22.450,
    descripcion: 'Municipio Falcón, eje norte El Supí / Tiraya.'
  },
] as const;

interface AppState {
  routine: 'transform' | 'ploteo';
  direction: 'canoa_regven' | 'regven_canoa' | 'dma_psad56_real' | 'dma_regven';
  method: 'badekas' | 'rigida' | 'rigida02' | 'dma_badekas' | 'dma_badekas_regven';
  coordType: 'utm' | 'geo' | 'cart';
  geometryType: 'abierta' | 'cerrada' | 'puntos';
  huso: number;
  rigidCorrection: { dn: number; de: number };
  adicoraCorrection: AdicoraCorrection;
  autoResiduoMalla: boolean;
  results: TransformationResult[];
  
  // DXF Preview
  dxfPreview: DXFPolygon[] | null;
  setDxfPreview: (polygons: DXFPolygon[] | null) => void;

  // Hatch (fill) settings for closed polygons
  hatchColor: string;
  hatchOpacity: number;
  setHatch: (color: string, opacity: number) => void;

  // Map State
  mapType: 'satellite' | 'standard' | 'hybrid' | 'physical';
  viewTarget: { type: 'parcel' | 'point' | 'all'; id: string | null; trigger: number };
  
  // Project State
  projectMeta: { nombre: string; notas: string };
  savedParcels: Parcel[];
  activeParcelId: string | null;
  movableParcelIds: string[];
  currentProjectId: string | null;
  ownerUserId: string | null;
  user: {
    id: string;
    username: string;
    rol: UserRole;
    nombre: string;
    email?: string;
    activo?: boolean;
    canonicalRole?: string;
    maxAllowedDevices?: number;
    maxVerticesPerCalculation?: number | null;
    roleConfig?: any;
  } | null;
  
  // Export State
  isExporting: boolean;
  exportType: 'PDF' | 'DXF' | 'KML' | 'DWG' | null;
  pdfProgress: number;
  
  // Actions
  setRoutine: (routine: 'transform' | 'ploteo') => void;
  setDirection: (dir: 'canoa_regven' | 'regven_canoa' | 'dma_psad56_real' | 'dma_regven') => void;
  setMethod: (method: 'badekas' | 'rigida' | 'rigida02' | 'dma_badekas' | 'dma_badekas_regven') => void;
  setCoordType: (type: 'utm' | 'geo' | 'cart') => void;
  setGeometryType: (type: 'abierta' | 'cerrada' | 'puntos') => void;
  setHuso: (huso: number) => void;
  setRigidCorrection: (correction: { dn: number; de: number }) => void;
  setAdicoraCorrection: (correction: Partial<AdicoraCorrection>) => void;
  resetAdicoraCorrection: () => void;
  setAutoResiduoMalla: (auto: boolean) => void;
  setResults: (results: TransformationResult[]) => void;
  /** Igual que setResults pero además limpia activeParcelId para evitar sobreescrituras de caché */
  setResultsFromBatch: (results: TransformationResult[]) => void;
  clearResults: () => void;
  
  // Map Actions
  setMapType: (type: 'satellite' | 'standard' | 'hybrid' | 'physical') => void;
  centerOnParcel: (id: string) => void;
  centerOnAll: () => void;
  setActiveParcelId: (id: string | null) => void;
  toggleParcelMovement: (id: string) => void;
  setParcelMovement: (id: string, movable: boolean) => void;
  clearAllParcelMovement: () => void;
  
  // Project Actions
  setProjectMeta: (meta: { nombre: string; notas: string }) => void;
  setCurrentProjectId: (id: string | null) => void;
  setExportingState: (isLoading: boolean, type?: 'PDF' | 'DXF' | 'KML' | 'DWG' | null, progress?: number) => void;
  saveCurrentParcel: () => void;
  loadParcel: (id: string) => void;
  viewParcelResults: (id: string) => void;
  renameParcel: (id: string, name: string) => void;
  updateParcelMetadata: (id: string, metadata: Partial<Parcel>) => void;
  deleteParcel: (id: string) => void;
  moveParcel: (id: string, dLat: number, dLng: number, dEste?: number, dNorte?: number) => void;
  importProject: (data: any) => void;
  clearCurrentParcel: () => void;
  clearProjectWorkspace: () => void;
  setUser: (user: any) => void;

}

function createUniqueParcelId(existingIds: Set<string>) {
  let id = '';
  do {
    id = `POL-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  } while (existingIds.has(id));

  existingIds.add(id);
  return id;
}

const OFFLINE_STORAGE_KEY = 'geotrans-offline-v1';

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
  routine: 'transform',
  direction: 'canoa_regven',
  method: 'badekas',
  coordType: 'utm',
  geometryType: 'cerrada',
  huso: 19,
  rigidCorrection: { dn: 44.642, de: 6.512 },
  adicoraCorrection: { ...ADICORA_DEFAULT_CORRECTION },
  autoResiduoMalla: true,
  results: [],
  dxfPreview: null,
  hatchColor: '#ffff00',
  hatchOpacity: 0.2,
  mapType: 'satellite',
  viewTarget: { type: 'all', id: null, trigger: 0 },
  
  projectMeta: { nombre: "Nuevo Proyecto", notas: "" },
  savedParcels: [],
  activeParcelId: null,
  movableParcelIds: [],
  currentProjectId: null,
  ownerUserId: null,
  user: null,
  isExporting: false,
  exportType: null,
  pdfProgress: 0,

  setRoutine: (routine) => set({ routine }),
  setDirection: (direction) => set({ direction }),
  setMethod: (method) => set({ method }),
  setCoordType: (coordType) => set({ coordType }),
  setGeometryType: (geometryType) => set({ geometryType }),
  setHuso: (huso) => set({ huso }),
  setRigidCorrection: (correction) => set({ rigidCorrection: correction }),
  setAdicoraCorrection: (correction) => set((state) => ({
    adicoraCorrection: { ...state.adicoraCorrection, ...correction }
  })),
  resetAdicoraCorrection: () => set({ adicoraCorrection: { ...ADICORA_DEFAULT_CORRECTION } }),
  setAutoResiduoMalla: (auto) => set({ autoResiduoMalla: auto }),
  setResults: (results) => set({ results }),
  setResultsFromBatch: (results) => set({ results, activeParcelId: null }),
  clearResults: () => set({ results: [], activeParcelId: null }),
  setDxfPreview: (polygons) => set({ dxfPreview: polygons }),
  setHatch: (color, opacity) => set({ hatchColor: color, hatchOpacity: opacity }),

  setMapType: (mapType) => set({ mapType }),
  centerOnParcel: (id) => set((state) => ({ 
    viewTarget: { type: 'parcel', id, trigger: state.viewTarget.trigger + 1 } 
  })),
  centerOnAll: () => set((state) => ({ 
    viewTarget: { type: 'all', id: null, trigger: state.viewTarget.trigger + 1 } 
  })),
  setActiveParcelId: (id) => set({ activeParcelId: id }),
  toggleParcelMovement: (id) => set((state) => ({
    movableParcelIds: state.movableParcelIds.includes(id)
      ? state.movableParcelIds.filter((pid) => pid !== id)
      : [...state.movableParcelIds, id],
  })),
  setParcelMovement: (id, movable) => set((state) => ({
    movableParcelIds: movable
      ? (state.movableParcelIds.includes(id) ? state.movableParcelIds : [...state.movableParcelIds, id])
      : state.movableParcelIds.filter((pid) => pid !== id),
  })),
  clearAllParcelMovement: () => set({ movableParcelIds: [] }),

  setProjectMeta: (meta) => set({ projectMeta: meta }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
  setExportingState: (isLoading: boolean, type: 'PDF' | 'DXF' | 'KML' | 'DWG' | null = null, progress: number = 0) => set({ isExporting: isLoading, exportType: type, pdfProgress: Math.min(progress, 100) }),
  renameParcel: (id, name) => set((state) => {
    const newParcels = state.savedParcels.map(p => p.id === id ? { ...p, nombre: name } : p);
    return { savedParcels: newParcels.sort((a, b) => a.nombre.localeCompare(b.nombre)) };
  }),
  updateParcelMetadata: (id, metadata) => set((state) => {
    const updatedParcels = state.savedParcels.map(p => p.id === id ? { ...p, ...metadata, actualizado: new Date().toISOString() } : p);
    return { savedParcels: updatedParcels };
  }),
  saveCurrentParcel: () => {
    const { results, savedParcels, activeParcelId } = get();
    if (results.length === 0) return;

    const geometryType = get().geometryType;
    let area = 0;
    let perim = 0;
    const utmPts = results.map(r => (r.result && r.result.este !== undefined) ? { x: r.result.este, y: r.result.norte } : null).filter(p => p !== null) as {x:number, y:number}[];
    
    if (geometryType === 'cerrada' && utmPts.length >= 3) {
      for (let i = 0; i < utmPts.length; i++) {
        let j = (i + 1) % utmPts.length;
        area += utmPts[i].x * utmPts[j].y;
        area -= utmPts[j].x * utmPts[i].y;
        const dx = utmPts[j].x - utmPts[i].x;
        const dy = utmPts[j].y - utmPts[i].y;
        perim += Math.sqrt(dx*dx + dy*dy);
      }
      area = Math.abs(area) / 2.0;
    } else if (geometryType === 'abierta' && utmPts.length >= 2) {
      for (let i = 0; i < utmPts.length - 1; i++) {
        const dx = utmPts[i+1].x - utmPts[i].x;
        const dy = utmPts[i+1].y - utmPts[i].y;
        perim += Math.sqrt(dx*dx + dy*dy);
      }
    }

    const pointsWithNewIds = results.map((r, i) => ({
      ...r,
      id: `P${i + 1}`
    }));

    const method = get().method;
    const rigidCorrection = get().rigidCorrection;
    const adicoraCorrection = get().adicoraCorrection;

    // Guard: si el activeParcelId no corresponde a ninguna parcela existente, ignorarlo y crear nueva
    const parcelStillExists = activeParcelId
      ? savedParcels.some(p => p.id === activeParcelId)
      : false;

    if (parcelStillExists) {
      const updatedParcels = savedParcels.map(p => {
        if (p.id !== activeParcelId) return p;
        return {
          ...p,
          area,
          perim,
          ha: area > 0 ? area / 10000 : 0,
          puntos: pointsWithNewIds,
          geometryType,
          method,
          rigidCorrection,
          adicoraCorrection,
          actualizado: new Date().toISOString()
        };
      });
      set({ savedParcels: updatedParcels, results: [], activeParcelId: null });
    } else {
      const firstId = results[0]?.id || "PAR";
      const parcelName = firstId.length > 5 ? firstId.substring(0, 5).toUpperCase() : firstId.toUpperCase();
      
        const newParcel: Parcel = {
          id: createUniqueParcelId(new Set(savedParcels.map(parcel => parcel.id))),
          nombre: parcelName,
          fecha: new Date().toLocaleDateString('es-VE'),
          area,
          perim,
          ha: area > 0 ? area / 10000 : 0,
          puntos: pointsWithNewIds,
          geometryType,
          method,
          rigidCorrection,
          adicoraCorrection,
        };

      const updatedParcels = [...savedParcels, newParcel].sort((a, b) => a.nombre.localeCompare(b.nombre));
      set((state) => ({ 
        savedParcels: updatedParcels, 
        results: [],
        viewTarget: { type: 'parcel', id: newParcel.id, trigger: state.viewTarget.trigger + 1 }
      }));
    }
  },

  loadParcel: (id) => {
    const { savedParcels } = get();
    const parcel = savedParcels.find(p => p.id === id);
    if (parcel) {
      set((state) => ({ 
        results: [...parcel.puntos],
        activeParcelId: id,
        geometryType: parcel.geometryType,
        method: parcel.method ?? 'badekas',
        rigidCorrection: parcel.rigidCorrection ?? { dn: 44.642, de: 6.512 },
        adicoraCorrection: parcel.adicoraCorrection 
          ? { ...ADICORA_DEFAULT_CORRECTION, ...parcel.adicoraCorrection } 
          : { ...ADICORA_DEFAULT_CORRECTION },
        viewTarget: { type: 'parcel', id, trigger: state.viewTarget.trigger + 1 }
      }));
    }
  },

  viewParcelResults: (id) => {
    const { savedParcels } = get();
    const parcel = savedParcels.find(p => p.id === id);
    if (parcel) {
      set((state) => ({ 
        results: [...parcel.puntos],
        activeParcelId: id,
        method: parcel.method ?? 'badekas',
        rigidCorrection: parcel.rigidCorrection ?? { dn: 44.642, de: 6.512 },
        viewTarget: { type: 'parcel', id, trigger: state.viewTarget.trigger + 1 },
      }));
    }
  },

  deleteParcel: (id: string) => {
    const { savedParcels, activeParcelId, movableParcelIds } = get();
    set({
      savedParcels: savedParcels.filter(p => p.id !== id),
      activeParcelId: activeParcelId === id ? null : activeParcelId,
      movableParcelIds: movableParcelIds.filter(pid => pid !== id),
    });
  },

  moveParcel: (id, dLat, dLng, dEste, dNorte) => {
    const { savedParcels, activeParcelId, results } = get();
    
    let parcelFound = false;
    const updatedParcels = savedParcels.map(p => {
      if (p.id !== id) return p;
      parcelFound = true;
      
      return {
        ...p,
        actualizado: new Date().toISOString(),
        puntos: p.puntos.map(pt => {
          if (!pt.result && !pt.input) return pt;
          const lat = Number(pt.result?.lat ?? pt.input?.lat);
          const lng = Number(pt.result?.lng ?? pt.input?.lng);
          const este = Number(pt.result?.este ?? pt.input?.este);
          const norte = Number(pt.result?.norte ?? pt.input?.norte);

          const hasLatLng = !isNaN(lat) && !isNaN(lng);
          const newLat = hasLatLng ? lat + dLat : pt.result?.lat;
          const newLng = hasLatLng ? lng + dLng : pt.result?.lng;

          const avgLat = hasLatLng ? ((lat + (newLat as number)) / 2 * Math.PI / 180) : 0.18;
          const calcDEste = dEste !== undefined ? dEste : (dLng * 111320 * Math.cos(avgLat));
          const calcDNorte = dNorte !== undefined ? dNorte : (dLat * 111320);

          const newEste = !isNaN(este) ? este + calcDEste : pt.result?.este;
          const newNorte = !isNaN(norte) ? norte + calcDNorte : pt.result?.norte;

          return {
            ...pt,
            input: pt.input ? {
              ...pt.input,
              lat: pt.input.lat !== undefined ? pt.input.lat + dLat : undefined,
              lng: pt.input.lng !== undefined ? pt.input.lng + dLng : undefined,
              este: pt.input.este !== undefined ? pt.input.este + calcDEste : undefined,
              norte: pt.input.norte !== undefined ? pt.input.norte + calcDNorte : undefined,
            } : pt.input,
            result: pt.result ? {
              ...pt.result,
              lat: newLat,
              lng: newLng,
              este: newEste,
              norte: newNorte,
            } : {
              lat: newLat,
              lng: newLng,
              este: newEste,
              norte: newNorte,
            }
          };
        })
      };
    });

    const nextState: any = {};
    if (parcelFound) {
      nextState.savedParcels = updatedParcels;
      if (activeParcelId === id) {
        const target = updatedParcels.find(p => p.id === id);
        if (target) {
          nextState.results = [...target.puntos];
        }
      }
    } else if (id === 'active' || id === activeParcelId) {
      nextState.results = results.map(pt => {
        const lat = Number(pt.result?.lat ?? pt.input?.lat);
        const lng = Number(pt.result?.lng ?? pt.input?.lng);
        const este = Number(pt.result?.este ?? pt.input?.este);
        const norte = Number(pt.result?.norte ?? pt.input?.norte);

        const hasLatLng = !isNaN(lat) && !isNaN(lng);
        const newLat = hasLatLng ? lat + dLat : pt.result?.lat;
        const newLng = hasLatLng ? lng + dLng : pt.result?.lng;

        const avgLat = hasLatLng ? ((lat + (newLat as number)) / 2 * Math.PI / 180) : 0.18;
        const calcDEste = dEste !== undefined ? dEste : (dLng * 111320 * Math.cos(avgLat));
        const calcDNorte = dNorte !== undefined ? dNorte : (dLat * 111320);

        const newEste = !isNaN(este) ? este + calcDEste : pt.result?.este;
        const newNorte = !isNaN(norte) ? norte + calcDNorte : pt.result?.norte;

        return {
          ...pt,
          input: pt.input ? {
            ...pt.input,
            lat: pt.input.lat !== undefined ? pt.input.lat + dLat : undefined,
            lng: pt.input.lng !== undefined ? pt.input.lng + dLng : undefined,
            este: pt.input.este !== undefined ? pt.input.este + calcDEste : undefined,
            norte: pt.input.norte !== undefined ? pt.input.norte + calcDNorte : undefined,
          } : pt.input,
          result: pt.result ? {
            ...pt.result,
            lat: newLat,
            lng: newLng,
            este: newEste,
            norte: newNorte,
          } : {
            lat: newLat,
            lng: newLng,
            este: newEste,
            norte: newNorte,
          }
        };
      });
    }

    set(nextState);
  },

  importProject: (data) => {
    if (data && Array.isArray(data.parcels)) {
      const usedParcelIds = new Set<string>();
      const formattedParcels = data.parcels.map((p: any) => {
        const rawId = typeof p.id === 'string' ? p.id.trim() : '';
        const id = rawId && !usedParcelIds.has(rawId)
          ? rawId
          : createUniqueParcelId(usedParcelIds);

        if (rawId) {
          usedParcelIds.add(id);
        }

        let pts = p.puntos?.map((pt: any, i: number) => ({
          ...pt,
          id: `P${i + 1}`
        })) || [];

        const geoType = p.geometryType || 'cerrada';
        if (geoType === 'cerrada' && pts.length >= 3) {
          const first = pts[0];
          const last = pts[pts.length - 1];
          const epsilon = 0.001;
          const lastIsRepeat =
            Math.abs(Number(last.result?.este) - Number(first.result?.este)) < epsilon &&
            Math.abs(Number(last.result?.norte) - Number(first.result?.norte)) < epsilon;
          if (lastIsRepeat) {
            pts = pts.slice(0, -1);
          }
        }

        let newNombre = p.nombre || 'Parcela';

        return {
          ...p,
          id,
          nombre: newNombre,
          puntos: pts,
          geometryType: geoType
        };
      });

      const sortedParcels = formattedParcels.sort((a: any, b: any) => a.nombre.localeCompare(b.nombre));
      set({
        projectMeta: data.meta || { nombre: 'Proyecto Recuperado', notas: '' },
        savedParcels: sortedParcels
      });
    }
  },
  clearCurrentParcel: () => set({ results: [], activeParcelId: null }),
  clearProjectWorkspace: () => set({
    projectMeta: { nombre: "Nuevo Proyecto", notas: "" },
    savedParcels: [],
    results: [],
    activeParcelId: null,
    movableParcelIds: [],
    currentProjectId: null,
    dxfPreview: null,
  }),
  setUser: (user) => set((state) => {
    if (!user) {
      return {
        user: null,
        ownerUserId: null,
        projectMeta: { nombre: "Nuevo Proyecto", notas: "" },
        savedParcels: [],
        results: [],
        activeParcelId: null,
        movableParcelIds: [],
        currentProjectId: null,
        dxfPreview: null,
      };
    }
    const isDifferentOrUntrackedUser = !state.ownerUserId || state.ownerUserId !== user.id;
    if (isDifferentOrUntrackedUser) {
      return {
        user,
        ownerUserId: user.id,
        projectMeta: { nombre: "Nuevo Proyecto", notas: "" },
        savedParcels: [],
        results: [],
        activeParcelId: null,
        movableParcelIds: [],
        currentProjectId: null,
        dxfPreview: null,
      };
    }
    return { user, ownerUserId: user.id };
  })
    }),
    {
      name: OFFLINE_STORAGE_KEY,
      version: 4,
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? localStorage : {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      })),
      migrate: (persistedState: any, version: number) => {
        // v0 → v2: resetear rigidCorrection a los valores correctos Canoa HJ-04
        if (version < 2) {
          persistedState.rigidCorrection = { dn: 44.642, de: 6.512 };
        }
        // v2 → v3: limpiar activeParcelId huérfano al recargar (ya no se persiste)
        if (version < 3) {
          persistedState.activeParcelId = null;
        }
        // v3 → v4: asegurar aislamiento por usuario; si no tiene ownerUserId, vaciar parcelas heredadas
        if (version < 4) {
          if (!persistedState.ownerUserId) {
            persistedState.savedParcels = [];
            persistedState.currentProjectId = null;
            persistedState.projectMeta = { nombre: "Nuevo Proyecto", notas: "" };
          }
        }
        return persistedState;
      },
      partialize: (state) => ({
        projectMeta: state.projectMeta,
        savedParcels: state.savedParcels,
        // activeParcelId NO se persiste: evita contaminación de caché entre sesiones
        currentProjectId: state.currentProjectId,
        ownerUserId: state.ownerUserId,
        routine: state.routine,
        direction: state.direction,
        method: state.method,
        coordType: state.coordType,
        geometryType: state.geometryType,
        huso: state.huso,
        rigidCorrection: state.rigidCorrection,
        autoResiduoMalla: state.autoResiduoMalla,
        hatchColor: state.hatchColor,
        hatchOpacity: state.hatchOpacity,
        // dxfPreview is NOT persisted (ephemeral)
        // results is NOT persisted (ephemeral)
        // activeParcelId is NOT persisted (ephemeral — evita bug de caché)
      }),
    },
  ),
);
export const useStore = useAppStore;
