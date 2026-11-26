import proj4 from 'proj4';
import {
  ensureVenezuelaProjections,
  type LiveGnssFix,
} from '@/components/geogis6-mobile/data/fieldData';

export type GnssFilterMode = 'static_hd' | 'dynamic' | 'raw';

export interface GnssCorrectionConfig {
  enabled: boolean;
  filterMode: GnssFilterMode;
  maxAccuracyM: number | null;
  shiftEsteM: number;
  shiftNorteM: number;
  shiftCotaM: number;
  antennaHeightM: number;
  geoidUndulationM: number;
  calibrationLabel: string | null;
  calibratedAt: string | null;
}

export interface GnssEpochSample {
  lat: number;
  lng: number;
  alt: number;
  accuracy: number;
  altitudeAccuracy: number | null;
  esteRegven: number;
  norteRegven: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface GnssSolutionTier {
  code: 'RTK_CM' | 'DGPS_SUBM' | 'GNSS_HD' | 'GNSS_STD' | 'WEAK' | 'NO_FIX';
  label: string;
  shortLabel: string;
  colorHex: string;
}

export interface GnssFieldStats {
  sampleCount: number;
  rejectedCount: number;
  updateHz: number;
  hrmsM: number | null;
  sigmaEM: number | null;
  sigmaNM: number | null;
  cep50M: number | null;
  r95M: number | null;
  solutionTier: GnssSolutionTier;
  scatterPoints: Array<{ dE: number; dN: number; accuracy: number; isLatest: boolean }>;
  accuracyHistory: Array<{ ts: number; accuracy: number }>;
}

export const DEFAULT_GNSS_CORRECTION: GnssCorrectionConfig = {
  enabled: true,
  filterMode: 'dynamic',
  maxAccuracyM: null,
  shiftEsteM: 0,
  shiftNorteM: 0,
  shiftCotaM: 0,
  antennaHeightM: 0,
  geoidUndulationM: 0,
  calibrationLabel: null,
  calibratedAt: null,
};

const STORAGE_KEY = 'geogis6_gnss_correction_v1';

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeHuso(huso: number): number {
  return [18, 19, 20, 21].includes(Number(huso)) ? Number(huso) : 19;
}

function regvenEpsgFor(huso: number): string {
  const h = safeHuso(huso);
  return `EPSG:220${h - 17}`;
}

function psadEpsgFor(huso: number): string {
  const h = safeHuso(huso);
  return `EPSG:248${h}`;
}

export function loadGnssCorrectionConfig(): GnssCorrectionConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_GNSS_CORRECTION };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GNSS_CORRECTION };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_GNSS_CORRECTION };
    const filterMode: GnssFilterMode =
      parsed.filterMode === 'static_hd' ||
      parsed.filterMode === 'dynamic' ||
      parsed.filterMode === 'raw'
        ? parsed.filterMode
        : DEFAULT_GNSS_CORRECTION.filterMode;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      filterMode,
      maxAccuracyM:
        typeof parsed.maxAccuracyM === 'number' &&
        Number.isFinite(parsed.maxAccuracyM) &&
        parsed.maxAccuracyM > 0
          ? parsed.maxAccuracyM
          : null,
      shiftEsteM:
        typeof parsed.shiftEsteM === 'number' && Number.isFinite(parsed.shiftEsteM)
          ? parsed.shiftEsteM
          : 0,
      shiftNorteM:
        typeof parsed.shiftNorteM === 'number' && Number.isFinite(parsed.shiftNorteM)
          ? parsed.shiftNorteM
          : 0,
      shiftCotaM:
        typeof parsed.shiftCotaM === 'number' && Number.isFinite(parsed.shiftCotaM)
          ? parsed.shiftCotaM
          : 0,
      antennaHeightM:
        typeof parsed.antennaHeightM === 'number' &&
        Number.isFinite(parsed.antennaHeightM) &&
        parsed.antennaHeightM >= 0
          ? parsed.antennaHeightM
          : 0,
      geoidUndulationM:
        typeof parsed.geoidUndulationM === 'number' && Number.isFinite(parsed.geoidUndulationM)
          ? parsed.geoidUndulationM
          : 0,
      calibrationLabel:
        typeof parsed.calibrationLabel === 'string' && parsed.calibrationLabel.trim()
          ? parsed.calibrationLabel.trim()
          : null,
      calibratedAt:
        typeof parsed.calibratedAt === 'string' && parsed.calibratedAt.trim()
          ? parsed.calibratedAt.trim()
          : null,
    };
  } catch {
    return { ...DEFAULT_GNSS_CORRECTION };
  }
}

export function saveGnssCorrectionConfig(cfg: GnssCorrectionConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage quota failure
  }
}

export function classifyGnssSolution(
  accuracyM: number,
  isLiveHardware: boolean,
): GnssSolutionTier {
  if (!isLiveHardware || !Number.isFinite(accuracyM) || accuracyM <= 0) {
    return {
      code: 'NO_FIX',
      label: 'BUSCANDO GNSS',
      shortLabel: 'SIN FIX',
      colorHex: '#ffb95f',
    };
  }
  if (accuracyM <= 0.08) {
    return {
      code: 'RTK_CM',
      label: 'RTK CENTIMÉTRICO',
      shortLabel: 'RTK CM',
      colorHex: '#4edea3',
    };
  }
  if (accuracyM <= 0.5) {
    return {
      code: 'DGPS_SUBM',
      label: 'DGPS SUBMÉTRICO',
      shortLabel: 'DGPS',
      colorHex: '#4cd7f6',
    };
  }
  if (accuracyM <= 3.5) {
    return {
      code: 'GNSS_HD',
      label: 'ALTA DEFINICIÓN',
      shortLabel: 'GNSS HD',
      colorHex: '#4edea3',
    };
  }
  if (accuracyM <= 10.0) {
    return {
      code: 'GNSS_STD',
      label: 'GNSS ESTÁNDAR',
      shortLabel: 'GNSS',
      colorHex: '#ffb95f',
    };
  }
  return {
    code: 'WEAK',
    label: 'SEÑAL DÉBIL',
    shortLabel: 'DÉBIL',
    colorHex: '#ffb4ab',
  };
}

export function regvenToPsad56(
  esteRegven: number,
  norteRegven: number,
  huso = 19,
): { este: number; norte: number } {
  ensureVenezuelaProjections();
  try {
    const [e, n] = proj4(regvenEpsgFor(huso), psadEpsgFor(huso), [
      esteRegven,
      norteRegven,
    ]);
    if (Number.isFinite(e) && Number.isFinite(n)) {
      return { este: round3(e), norte: round3(n) };
    }
  } catch {
    // fallback approximation
  }
  return {
    este: round3(esteRegven + 204.33),
    norte: round3(norteRegven + 311.54),
  };
}

export function psad56ToRegven(
  estePsad: number,
  nortePsad: number,
  huso = 19,
): { este: number; norte: number } {
  ensureVenezuelaProjections();
  try {
    const [e, n] = proj4(psadEpsgFor(huso), regvenEpsgFor(huso), [
      estePsad,
      nortePsad,
    ]);
    if (Number.isFinite(e) && Number.isFinite(n)) {
      return { este: round3(e), norte: round3(n) };
    }
  } catch {
    // fallback approximation
  }
  return {
    este: round3(estePsad - 204.33),
    norte: round3(nortePsad - 311.54),
  };
}

function medianOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function filterOutliers3Sigma(samples: GnssEpochSample[]): GnssEpochSample[] {
  if (samples.length < 4) return samples;
  const medE = medianOf(samples.map((s) => s.esteRegven));
  const medN = medianOf(samples.map((s) => s.norteRegven));
  const dists = samples.map((s) => Math.hypot(s.esteRegven - medE, s.norteRegven - medN));
  const medDist = medianOf(dists);
  const threshold = Math.max(3.0, 2.5 * medDist);
  const kept = samples.filter((_, i) => dists[i] <= threshold);
  return kept.length >= 2 ? kept : samples;
}

export function computeGnssFieldStats(
  samples: GnssEpochSample[],
  rejectedCount: number,
  isLiveHardware: boolean,
  latestAccuracy: number,
): GnssFieldStats {
  const solutionTier = classifyGnssSolution(latestAccuracy, isLiveHardware);
  const recent = samples.slice(-40);
  const accHistory = samples
    .slice(-30)
    .map((s) => ({ ts: s.timestamp, accuracy: round2(s.accuracy) }));

  if (recent.length === 0) {
    return {
      sampleCount: 0,
      rejectedCount,
      updateHz: 0,
      hrmsM: null,
      sigmaEM: null,
      sigmaNM: null,
      cep50M: null,
      r95M: null,
      solutionTier,
      scatterPoints: [],
      accuracyHistory: accHistory,
    };
  }

  let updateHz = 0;
  if (recent.length >= 2) {
    const dtSec = (recent[recent.length - 1].timestamp - recent[0].timestamp) / 1000;
    if (dtSec > 0.2) {
      updateHz = Math.round(((recent.length - 1) / dtSec) * 10) / 10;
    }
  }

  let sumW = 0;
  let meanE = 0;
  let meanN = 0;
  for (const s of recent) {
    const acc = Math.max(0.25, Number.isFinite(s.accuracy) ? s.accuracy : 5);
    const w = 1 / (acc * acc);
    sumW += w;
    meanE += s.esteRegven * w;
    meanN += s.norteRegven * w;
  }
  meanE /= sumW;
  meanN /= sumW;

  let varE = 0;
  let varN = 0;
  const scatterPoints = recent.map((s, idx) => {
    const dE = s.esteRegven - meanE;
    const dN = s.norteRegven - meanN;
    varE += dE * dE;
    varN += dN * dN;
    return {
      dE,
      dN,
      accuracy: s.accuracy,
      isLatest: idx === recent.length - 1,
    };
  });

  const denom = Math.max(1, recent.length - 1);
  const sigmaEM = recent.length >= 2 ? round3(Math.sqrt(varE / denom)) : 0;
  const sigmaNM = recent.length >= 2 ? round3(Math.sqrt(varN / denom)) : 0;
  const hrmsM = recent.length >= 2 ? round3(Math.hypot(sigmaEM, sigmaNM)) : 0;
  const cep50M = recent.length >= 2 ? round3(0.5887 * (sigmaEM + sigmaNM)) : 0;
  const r95M = recent.length >= 2 ? round3(1.7308 * hrmsM) : 0;

  return {
    sampleCount: samples.length,
    rejectedCount,
    updateHz,
    hrmsM,
    sigmaEM,
    sigmaNM,
    cep50M,
    r95M,
    solutionTier,
    scatterPoints,
    accuracyHistory: accHistory,
  };
}

export function applyGnssFilterAndCorrection(
  rawFix: LiveGnssFix,
  samples: GnssEpochSample[],
  config: GnssCorrectionConfig,
  huso = 19,
): LiveGnssFix {
  if (!rawFix.isLiveHardware) {
    return rawFix;
  }

  let lat = rawFix.lat;
  let lng = rawFix.lng;
  let alt = rawFix.alt;
  let accuracy = rawFix.accuracy;
  let esteRegven = rawFix.esteRegven;
  let norteRegven = rawFix.norteRegven;

  if (config.filterMode === 'static_hd' && samples.length > 0) {
    const windowSamples = filterOutliers3Sigma(samples.slice(-15));
    let sumW = 0;
    let sumE = 0;
    let sumN = 0;
    let sumAlt = 0;
    let sumLat = 0;
    let sumLng = 0;
    let minAcc = Infinity;

    for (const s of windowSamples) {
      const acc = Math.max(0.25, Number.isFinite(s.accuracy) ? s.accuracy : 5);
      if (acc < minAcc) minAcc = acc;
      const w = 1 / (acc * acc);
      sumW += w;
      sumE += s.esteRegven * w;
      sumN += s.norteRegven * w;
      sumAlt += s.alt * w;
      sumLat += s.lat * w;
      sumLng += s.lng * w;
    }

    if (sumW > 0) {
      esteRegven = round3(sumE / sumW);
      norteRegven = round3(sumN / sumW);
      alt = round2(sumAlt / sumW);
      lat = sumLat / sumW;
      lng = sumLng / sumW;
      accuracy = round2(minAcc / Math.sqrt(windowSamples.length));
    }
  } else if (config.filterMode === 'dynamic' && samples.length > 0) {
    const latestSpeed = rawFix.speed ?? samples[samples.length - 1]?.speed ?? 0;
    const windowSize = typeof latestSpeed === 'number' && latestSpeed >= 1.2 ? 3 : 6;
    const recent = samples.slice(-windowSize);
    let sumW = 0;
    let sumE = 0;
    let sumN = 0;
    let sumAlt = 0;
    let sumLat = 0;
    let sumLng = 0;
    let weightedAcc = 0;

    recent.forEach((s, idx) => {
      const acc = Math.max(0.25, Number.isFinite(s.accuracy) ? s.accuracy : 5);
      const recency = idx + 1;
      const w = recency / (acc * acc);
      sumW += w;
      sumE += s.esteRegven * w;
      sumN += s.norteRegven * w;
      sumAlt += s.alt * w;
      sumLat += s.lat * w;
      sumLng += s.lng * w;
      weightedAcc += acc * w;
    });

    if (sumW > 0) {
      esteRegven = round3(sumE / sumW);
      norteRegven = round3(sumN / sumW);
      alt = round2(sumAlt / sumW);
      lat = sumLat / sumW;
      lng = sumLng / sumW;
      accuracy = round2(weightedAcc / sumW);
    }
  }

  if (config.enabled) {
    const hasPlanarShift =
      Math.abs(config.shiftEsteM) > 0.0001 || Math.abs(config.shiftNorteM) > 0.0001;
    esteRegven = round3(esteRegven + config.shiftEsteM);
    norteRegven = round3(norteRegven + config.shiftNorteM);
    alt = round2(
      alt - config.geoidUndulationM - config.antennaHeightM + config.shiftCotaM,
    );

    if (hasPlanarShift) {
      ensureVenezuelaProjections();
      try {
        const [lonCorr, latCorr] = proj4(regvenEpsgFor(huso), 'EPSG:4326', [
          esteRegven,
          norteRegven,
        ]);
        if (Number.isFinite(latCorr) && Number.isFinite(lonCorr)) {
          lat = latCorr;
          lng = lonCorr;
        }
      } catch {
        // retain filtered geographic coords if proj4 throws
      }
    }
  }

  return {
    ...rawFix,
    lat,
    lng,
    alt,
    accuracy,
    esteRegven,
    norteRegven,
  };
}

export function computeOnePointCalibration(
  samples: GnssEpochSample[],
  knownEsteRegven: number,
  knownNorteRegven: number,
  knownCota: number | null,
  antennaHeightM: number,
  geoidUndulationM: number,
): {
  shiftEsteM: number;
  shiftNorteM: number;
  shiftCotaM: number;
  sampleCount: number;
  residualRmsM: number;
} {
  if (!samples || samples.length === 0) {
    throw new Error('Se requieren lecturas GNSS reales para calibrar');
  }

  const filtered = filterOutliers3Sigma(samples);
  let sumW = 0;
  let meanE = 0;
  let meanN = 0;
  let meanAlt = 0;

  for (const s of filtered) {
    const acc = Math.max(0.25, Number.isFinite(s.accuracy) ? s.accuracy : 5);
    const w = 1 / (acc * acc);
    sumW += w;
    meanE += s.esteRegven * w;
    meanN += s.norteRegven * w;
    meanAlt += s.alt * w;
  }

  meanE /= sumW;
  meanN /= sumW;
  meanAlt /= sumW;

  let sqErrSum = 0;
  for (const s of filtered) {
    sqErrSum += Math.pow(s.esteRegven - meanE, 2) + Math.pow(s.norteRegven - meanN, 2);
  }
  const residualRmsM = round3(Math.sqrt(sqErrSum / filtered.length));

  const shiftEsteM = round3(knownEsteRegven - meanE);
  const shiftNorteM = round3(knownNorteRegven - meanN);
  const orthoRaw = meanAlt - geoidUndulationM - antennaHeightM;
  const shiftCotaM =
    knownCota !== null && Number.isFinite(knownCota)
      ? round3(knownCota - orthoRaw)
      : 0;

  return {
    shiftEsteM,
    shiftNorteM,
    shiftCotaM,
    sampleCount: filtered.length,
    residualRmsM,
  };
}
