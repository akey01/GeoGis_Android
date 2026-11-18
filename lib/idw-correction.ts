import { MALLA_PATVEN98, MALLA_STATS, PuntoMalla } from "./malla-patven98";

export interface ResiduoCorrection {
  de: number;
  dn: number;
  metodo: "idw" | "exacto" | "fallback" | "badekas";
  distanciaMinimaKm: number;
}

/**
 * Calcula el residuo de corrección planimétrica (ΔE, ΔN) en metros
 * mediante interpolación espacial IDW (Inverse Distance Weighting, p=2, k=5)
 * sobre la malla de 50 puntos homólogos PATVEN-98 (PSAD56 <-> REGVEN).
 * 
 * Si las coordenadas corresponden a Huso 20 (lon > -66°W) o están fuera
 * de la cobertura razonable de la grilla (distancia > 250 km), se conmuta
 * a transformación Badekas 7-parámetros estándar (de=0, dn=0).
 * 
 * @param lat Latitud en grados decimales (+N)
 * @param lon Longitud en grados decimales (negativa para el Oeste, ej. -71.4)
 * @param k Número de vecinos más cercanos (defecto 5)
 * @param power Potencia IDW (defecto 2)
 */
export function getResiduoMalla(
  lat: number,
  lon: number,
  k: number = 5,
  power: number = 2
): ResiduoCorrection {
  if (!MALLA_PATVEN98 || MALLA_PATVEN98.length === 0) {
    return {
      de: MALLA_STATS.deltaEstePromedio,
      dn: MALLA_STATS.deltaNortePromedio,
      metodo: "fallback",
      distanciaMinimaKm: 0,
    };
  }

  // Normalizar longitud (asegurar que sea negativa para Oeste)
  const lonNorm = lon > 0 ? -lon : lon;

  // Calcular distancias euclídeas aproximadas a cada punto de la malla
  const puntosConDistancia = MALLA_PATVEN98.map((p) => {
    const dLat = lat - p.latPsad56;
    const dLon = lonNorm - p.lonPsad56;
    const distDeg = Math.sqrt(dLat * dLat + dLon * dLon);
    return { punto: p, distDeg };
  });

  // Coincidencia exacta o extremadamente cercana (< ~0.1 m en grados)
  const exacto = puntosConDistancia.find((p) => p.distDeg < 1e-6);
  if (exacto) {
    return {
      de: exacto.punto.deltaEsteUtm,
      dn: exacto.punto.deltaNorteUtm,
      metodo: "exacto",
      distanciaMinimaKm: exacto.distDeg * 111.0,
    };
  }

  // Ordenar por distancia y tomar los k vecinos más cercanos
  puntosConDistancia.sort((a, b) => a.distDeg - b.distDeg);
  const vecinos = puntosConDistancia.slice(0, Math.min(k, puntosConDistancia.length));
  const distMinKm = vecinos[0].distDeg * 111.0;

  // Si las coordenadas están en Huso 20 (lon > -66°W) o a más de 250 km de la malla
  // Conmutar a transformación Badekas 7-parámetros (de=0, dn=0) para prevenir errores de extrapolación
  if (lonNorm > -66.0 || distMinKm > 250.0) {
    return {
      de: 0,
      dn: 0,
      metodo: "badekas",
      distanciaMinimaKm: distMinKm,
    };
  }

  let sumW = 0;
  let sumDeW = 0;
  let sumDnW = 0;

  for (const item of vecinos) {
    const w = 1.0 / Math.pow(item.distDeg, power);
    sumW += w;
    sumDeW += item.punto.deltaEsteUtm * w;
    sumDnW += item.punto.deltaNorteUtm * w;
  }

  return {
    de: sumDeW / sumW,
    dn: sumDnW / sumW,
    metodo: "idw",
    distanciaMinimaKm: distMinKm,
  };
}

