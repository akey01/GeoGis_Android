/**
 * useMapStore.ts — Store de Zustand para el Visor de Mapa OpenLayers
 * GeoGIS6 · Datum: REGVEN / EPSG:32619
 *
 * Responsabilidades:
 *  - Mantener el estado de la capa base activa (streets | satellite).
 *  - Almacenar el array de parcelas cargadas desde Supabase (PostGIS).
 *  - Exponer acciones asíncronas para fetchParcelas y toggle de capa base.
 *  - Guardar la parcela actualmente seleccionada en el mapa.
 *
 * Todas las coordenadas en memoria se almacenan en metros UTM [X_este, Y_norte]
 * bajo el datum REGVEN Zona 19N (EPSG:32619).
 */

import { create } from 'zustand';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Tipos de capa base disponibles ───────────────────────────────────────────
export type BaseLayerType = 'streets' | 'satellite' | 'hybrid' | 'esri' | 'cad_dark';

// ─── Interfaz principal de Parcela Catastral ──────────────────────────────────
/**
 * Representa un predio catastral almacenado en PostGIS bajo EPSG:32619.
 * `coordenadas` contiene los vértices del polígono en metros UTM [Este, Norte].
 */
export interface Parcela {
  /** Identificador único de la parcela (UUID o entero desde Supabase). */
  id: string | number;
  /** Código catastral oficial del predio. */
  codigo: string;
  /** Nombre del propietario registrado. */
  propietario: string;
  /** Superficie del predio expresada en hectáreas. */
  area_ha: number;
  /** Municipio donde se ubica el predio. */
  municipio: string;
  /**
   * Vértices del polígono en orden.
   * Cada tupla es [X_este_m, Y_norte_m] en EPSG:32619 (metros UTM REGVEN 19N).
   */
  coordenadas: [number, number][];
}

// ─── Shape del Store ──────────────────────────────────────────────────────────
interface MapState {
  // ── Estado ─────────────────────────────────────────────────────────────────
  /** Capa base actualmente visible en el visor. */
  baseLayer: BaseLayerType;
  /** Array de parcelas catastrales cargadas desde Supabase. */
  parcelas: Parcela[];
  /** Indica si hay una operación de carga en curso. */
  isLoading: boolean;
  /** Error ocurrido durante la última carga, si existe. */
  fetchError: string | null;
  /** Parcela actualmente seleccionada por el usuario en el mapa. */
  selectedParcela: Parcela | null;

  // ── Acciones ───────────────────────────────────────────────────────────────
  toggleBaseLayer: (layer?: BaseLayerType) => void;
  fetchParcelas: (supabaseClient?: SupabaseClient) => Promise<void>;
  setSelectedParcela: (parcela: Parcela | null) => void;
  clearParcelas: () => void;
}

// ─── Utilidad: parseo de geometría GeoJSON → coordenadas UTM ──────────────────
function parseGeometryToUTM(rawGeometry: unknown): [number, number][] {
  if (!rawGeometry || typeof rawGeometry !== 'object') return [];
  const geom = rawGeometry as { type?: string; coordinates?: unknown };

  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    const ring = geom.coordinates[0];
    if (!Array.isArray(ring)) return [];
    return ring
      .filter((v): v is [number, number] => Array.isArray(v) && v.length >= 2)
      .map(([x, y]) => [x, y] as [number, number]);
  }

  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    const firstPoly = geom.coordinates[0];
    if (!Array.isArray(firstPoly) || !Array.isArray(firstPoly[0])) return [];
    return firstPoly[0]
      .filter((v): v is [number, number] => Array.isArray(v) && v.length >= 2)
      .map(([x, y]) => [x, y] as [number, number]);
  }

  return [];
}

// ─── Creación del Store ───────────────────────────────────────────────────────
export const useMapStore = create<MapState>((set, _get) => ({
  baseLayer: 'satellite',
  parcelas: [],
  isLoading: false,
  fetchError: null,
  selectedParcela: null,

  toggleBaseLayer: (layer?: BaseLayerType) => {
    set((state) => ({
      baseLayer: layer ?? (state.baseLayer === 'streets' ? 'satellite' : 'streets'),
    }));
  },

  fetchParcelas: async (supabaseClient?: SupabaseClient) => {
    set({ isLoading: true, fetchError: null });
    try {
      let rawData: Record<string, unknown>[] = [];

      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from('parcelas_geojson')
          .select('id, codigo, propietario, area_ha, municipio, geom_json');

        if (error) throw new Error(error.message);
        rawData = (data as Record<string, unknown>[]) || [];
      } else {
        const res = await fetch('/api/parcelas-gis');
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const json = await res.json();
        rawData = (json.data as Record<string, unknown>[]) || [];
      }

      const parcelas: Parcela[] = rawData
        .map((row) => {
          const coordenadas = parseGeometryToUTM(row['geom_json']);
          if (coordenadas.length < 3) return null;
          return {
            id: row['id'] as string | number,
            codigo: String(row['codigo'] ?? ''),
            propietario: String(row['propietario'] ?? ''),
            area_ha: Number(row['area_ha'] ?? 0),
            municipio: String(row['municipio'] ?? ''),
            coordenadas,
          } satisfies Parcela;
        })
        .filter((p): p is Parcela => p !== null);

      set({ parcelas, isLoading: false });
      console.info(`[useMapStore] ${parcelas.length} parcelas cargadas.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      set({ fetchError: message, isLoading: false });
      console.error('[useMapStore] Error al cargar parcelas:', message);
    }
  },

  setSelectedParcela: (parcela: Parcela | null) => {
    set({ selectedParcela: parcela });
  },

  clearParcelas: () => {
    set({ parcelas: [], fetchError: null, selectedParcela: null });
  },
}));
