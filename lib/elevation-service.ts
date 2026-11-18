import { GeoEngine, GRS80 } from './geo-engine';

export interface ElevationPointInput {
  id?: string;
  name?: string;
  lat?: number | null;
  lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  lon?: number | null;
  x?: number | null;
  y?: number | null;
  z?: number | null;
  este?: number | null;
  norte?: number | null;
  e?: number | null;
  n?: number | null;
  h?: number | null;
  alt?: number | null;
  input?: any;
  result?: any;
  [key: string]: any;
}

function autoDetectHuso(val: number): number {
  if (val >= -74 && val <= -66) return 19;
  if (val > -66 && val <= -60) return 20;
  if (val > -60 && val <= -54) return 21;
  if (val >= 100000 && val <= 900000) return 19;
  return 19;
}

export const ElevationService = {
  /**
   * Extrae la coordenada geográfica (lat, lng) de un punto en cualquier formato soportado
   */
  extractGeoCoordinate(p: ElevationPointInput): { lat: number; lng: number } | null {
    let lat = p.result?.lat ?? p.lat ?? p.latitude ?? p.input?.lat ?? null;
    let lng = p.result?.lng ?? p.lng ?? p.lon ?? p.longitude ?? p.input?.lng ?? null;

    if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return { lat: Number(lat), lng: Number(lng) };
    }

    // Intentar derivar desde UTM proyectadas
    const este = p.result?.este ?? p.este ?? p.e ?? p.x ?? p.result?.x ?? p.input?.este ?? p.input?.x ?? null;
    const norte = p.result?.norte ?? p.norte ?? p.n ?? p.y ?? p.result?.y ?? p.input?.norte ?? p.input?.y ?? null;

    if (este != null && norte != null && Number.isFinite(Number(este)) && Number.isFinite(Number(norte))) {
      const huso = p.input?.huso ?? p.huso ?? autoDetectHuso(Number(este));
      const geo = GeoEngine.utmToGeo(Number(este), Number(norte), Number(huso), false, GRS80);
      if (Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        return { lat: geo.lat, lng: geo.lng };
      }
    }

    return null;
  },

  /**
   * Consulta altitudes satelitales (Google Earth Elevation / Copernicus DEM) para un conjunto de puntos
   */
  async fetchElevations(coords: Array<{ lat: number; lng: number }>): Promise<number[]> {
    if (!coords || coords.length === 0) return [];

    // 1. Si estamos en el navegador, intentar a través de la API interna de Next.js
    if (typeof window !== 'undefined') {
      try {
        const res = await fetch('/api/elevation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locations: coords }),
          signal: AbortSignal.timeout(10000)
        });

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.elevations) && data.elevations.length === coords.length) {
            return data.elevations.map((e: any) => Number(e ?? 0));
          }
        }
      } catch (err) {
        console.warn('[ElevationService] Error llamando a /api/elevation, usando DEM satelital directo...', err);
      }
    }

    // 2. Consulta directa a Open-Meteo DEM (Copernicus 30m / SRTM v4.1)
    try {
      const lats = coords.map(c => c.lat.toFixed(6)).join(',');
      const lngs = coords.map(c => c.lng.toFixed(6)).join(',');
      const openMeteoUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
      const directRes = await fetch(openMeteoUrl, { signal: AbortSignal.timeout(8000) });
      if (directRes.ok) {
        const d = await directRes.json();
        if (Array.isArray(d.elevation)) {
          return d.elevation.map((e: any) => Number(e ?? 0));
        }
      }
    } catch (directErr) {
      console.warn('[ElevationService] Fallback directo DEM satelital falló:', directErr);
    }

    // 3. Fallback Open-Elevation
    try {
      const openElevationUrl = 'https://api.open-elevation.com/api/v1/lookup';
      const res = await fetch(openElevationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          locations: coords.map(l => ({ latitude: l.lat, longitude: l.lng }))
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.results)) {
          return data.results.map((r: any) => Number(r.elevation ?? 0));
        }
      }
    } catch (openElevErr) {
      console.warn('[ElevationService] Open-Elevation falló:', openElevErr);
    }

    return coords.map(() => 0);
  },

  /**
   * Enriquece un arreglo de puntos topográficos con la altitud satelital real obtenida de DEM/Google
   * Si un punto ya tiene una altitud válida distinta de cero y overrideExisting es false, se conserva.
   */
  async enrichPointsWithSatelliteElevation<T extends ElevationPointInput>(
    points: T[],
    overrideExisting: boolean = true
  ): Promise<T[]> {
    if (!points || points.length === 0) return points;

    // Extraer coordenadas de cada punto
    const geoCoords = points.map(p => this.extractGeoCoordinate(p));
    const validIndexes: number[] = [];
    const validCoords: Array<{ lat: number; lng: number }> = [];

    geoCoords.forEach((coord, idx) => {
      if (coord) {
        validIndexes.push(idx);
        validCoords.push(coord);
      }
    });

    if (validCoords.length === 0) return points;

    const elevations = await this.fetchElevations(validCoords);

    // Clonar puntos y asignar la altitud satelital
    return points.map((pt, idx) => {
      const copy = { ...pt };
      const validPos = validIndexes.indexOf(idx);

      if (validPos !== -1) {
        const satAlt = elevations[validPos] ?? 0;
        const currentH = pt.result?.h ?? pt.result?.alt ?? pt.result?.z ?? pt.input?.alt ?? pt.input?.z ?? pt.h ?? pt.alt ?? pt.z ?? 0;

        // Si se fuerza override o el valor actual es 0 / nulo
        const newAlt = (overrideExisting || Number(currentH) === 0) && Number.isFinite(satAlt) ? satAlt : Number(currentH);

        // Actualizar en todos los niveles para consistencia
        if (copy.result) {
          copy.result = { ...copy.result, h: newAlt, alt: newAlt, z: newAlt };
        }
        if (copy.input) {
          copy.input = { ...copy.input, alt: newAlt, z: newAlt };
        }
        copy.h = newAlt;
        copy.alt = newAlt;
        copy.z = newAlt;
      }

      return copy;
    });
  }
};
