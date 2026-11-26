'use client';

import { useEffect, useRef, useState } from 'react';
import type { LiveGnssFix } from '@/components/geogis6-mobile/data/fieldData';

export function normalizeAngle360(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

export function computeRelativeBearing(
  targetAzimuthDeg: number,
  deviceHeadingDeg: number,
): number {
  let diff = normalizeAngle360(targetAzimuthDeg - deviceHeadingDeg);
  if (diff > 180) diff -= 360;
  return diff;
}

export function smoothHeadingDeg(
  prevDeg: number | null,
  nextDeg: number,
  alpha = 0.25,
): number {
  const cleanNext = normalizeAngle360(nextDeg);
  if (prevDeg === null || !Number.isFinite(prevDeg)) return cleanNext;
  const p = (normalizeAngle360(prevDeg) * Math.PI) / 180;
  const n = (cleanNext * Math.PI) / 180;
  const sin = (1 - alpha) * Math.sin(p) + alpha * Math.sin(n);
  const cos = (1 - alpha) * Math.cos(p) + alpha * Math.cos(n);
  return normalizeAngle360((Math.atan2(sin, cos) * 180) / Math.PI);
}

const CARDINALS_ES = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const;

export function getCardinalDirection(azimuthDeg: number): string {
  const idx = Math.round(normalizeAngle360(azimuthDeg) / 45) % 8;
  return CARDINALS_ES[idx];
}

export function formatFieldDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '--';
  if (meters < 10) return `${meters.toFixed(2)} m`;
  if (meters < 1000) return `${meters.toFixed(1)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

const RADAR_SCALE_STEPS = [
  0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
];

export function selectRadarScaleMeters(distanceMeters: number): {
  outerM: number;
  midM: number;
  innerM: number;
} {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0.35) {
    return { outerM: 0.5, midM: 0.25, innerM: 0.1 };
  }
  const targetOuter = distanceMeters * 1.15;
  const outerM =
    RADAR_SCALE_STEPS.find((step) => step >= targetOuter) ??
    RADAR_SCALE_STEPS[RADAR_SCALE_STEPS.length - 1];
  return {
    outerM,
    midM: Math.round(outerM * 0.5 * 100) / 100,
    innerM: Math.round(outerM * 0.25 * 100) / 100,
  };
}

export type DirectionTurnType =
  | 'arrived'
  | 'straight'
  | 'right'
  | 'left'
  | 'back'
  | 'azimuth_only';

export function getDirectionGuidance(
  distanceM: number,
  targetAzimuthDeg: number,
  deviceHeadingDeg: number | null,
  toleranceM = 2.0,
): {
  headline: string;
  sublabel: string;
  turnType: DirectionTurnType;
  relativeDeg: number | null;
} {
  const cardinal = getCardinalDirection(targetAzimuthDeg);
  const azRounded = Math.round(normalizeAngle360(targetAzimuthDeg));

  if (Number.isFinite(distanceM) && distanceM <= toleranceM) {
    return {
      headline: '¡En el punto!',
      sublabel: `Dentro de tolerancia (${formatFieldDistance(distanceM)})`,
      turnType: 'arrived',
      relativeDeg:
        deviceHeadingDeg !== null
          ? computeRelativeBearing(targetAzimuthDeg, deviceHeadingDeg)
          : null,
    };
  }

  if (deviceHeadingDeg === null || !Number.isFinite(deviceHeadingDeg)) {
    return {
      headline: `Rumbo ${cardinal} (${azRounded}°)`,
      sublabel: `Camina hacia el ${cardinal} · ${formatFieldDistance(distanceM)}`,
      turnType: 'azimuth_only',
      relativeDeg: null,
    };
  }

  const rel = computeRelativeBearing(targetAzimuthDeg, deviceHeadingDeg);
  const absRel = Math.abs(rel);

  if (absRel <= 15) {
    return {
      headline: 'Sigue de frente',
      sublabel: `Alineado ${cardinal} (${azRounded}°) · ${formatFieldDistance(distanceM)}`,
      turnType: 'straight',
      relativeDeg: rel,
    };
  }
  if (rel > 15 && rel <= 135) {
    return {
      headline: `Gira ${Math.round(rel)}° derecha`,
      sublabel: `Objetivo al ${cardinal} (${azRounded}°) · ${formatFieldDistance(distanceM)}`,
      turnType: 'right',
      relativeDeg: rel,
    };
  }
  if (rel < -15 && rel >= -135) {
    return {
      headline: `Gira ${Math.round(absRel)}° izquierda`,
      sublabel: `Objetivo al ${cardinal} (${azRounded}°) · ${formatFieldDistance(distanceM)}`,
      turnType: 'left',
      relativeDeg: rel,
    };
  }
  return {
    headline: 'Detrás de ti · Da la vuelta',
    sublabel: `Objetivo al ${cardinal} (${azRounded}°) · ${formatFieldDistance(distanceM)}`,
    turnType: 'back',
    relativeDeg: rel,
  };
}

export interface GnssSampleInput {
  lat: number;
  lng: number;
  alt: number;
  accuracy: number;
  esteRegven: number;
  norteRegven: number;
}

export function computeWeightedGnssAverage(samples: GnssSampleInput[]): {
  lat: number;
  lng: number;
  alt: number;
  accuracy: number;
  esteRegven: number;
  norteRegven: number;
  sampleCount: number;
} {
  if (!samples || samples.length === 0) {
    throw new Error('Se requiere al menos una muestra GNSS');
  }
  let sumW = 0;
  let latSum = 0;
  let lngSum = 0;
  let altSum = 0;
  let estSum = 0;
  let norSum = 0;
  let bestAcc = Infinity;

  for (const s of samples) {
    const acc = Math.max(0.5, Number.isFinite(s.accuracy) ? s.accuracy : 5);
    if (acc < bestAcc) bestAcc = acc;
    const w = 1 / (acc * acc);
    sumW += w;
    latSum += s.lat * w;
    lngSum += s.lng * w;
    altSum += s.alt * w;
    estSum += s.esteRegven * w;
    norSum += s.norteRegven * w;
  }

  return {
    lat: latSum / sumW,
    lng: lngSum / sumW,
    alt: Math.round((altSum / sumW) * 100) / 100,
    accuracy: Math.round((bestAcc / Math.sqrt(samples.length)) * 100) / 100,
    esteRegven: Math.round((estSum / sumW) * 1000) / 1000,
    norteRegven: Math.round((norSum / sumW) * 1000) / 1000,
    sampleCount: samples.length,
  };
}

export interface DeviceCompassState {
  headingDeg: number | null;
  source: 'magnetometer' | 'gps_course' | 'none';
}

export function useDeviceCompass(gnssFix: LiveGnssFix): DeviceCompassState {
  const [headingDeg, setHeadingDeg] = useState<number | null>(null);
  const [source, setSource] = useState<'magnetometer' | 'gps_course' | 'none'>('none');
  const smoothRef = useRef<number | null>(null);
  const lastMagTsRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOrientation = (ev: DeviceOrientationEvent) => {
      const anyEv = ev as DeviceOrientationEvent & {
        webkitCompassHeading?: number;
        absolute?: boolean;
      };
      let rawHeading: number | null = null;

      if (
        typeof anyEv.webkitCompassHeading === 'number' &&
        Number.isFinite(anyEv.webkitCompassHeading)
      ) {
        rawHeading = anyEv.webkitCompassHeading;
      } else if (typeof ev.alpha === 'number' && Number.isFinite(ev.alpha)) {
        rawHeading = normalizeAngle360(360 - ev.alpha);
      }

      if (rawHeading === null) return;
      lastMagTsRef.current = Date.now();
      const smoothed = smoothHeadingDeg(smoothRef.current, rawHeading, 0.25);
      smoothRef.current = smoothed;
      setHeadingDeg(smoothed);
      setSource('magnetometer');
    };

    window.addEventListener('deviceorientationabsolute', handleOrientation as EventListener, true);
    window.addEventListener('deviceorientation', handleOrientation, true);

    return () => {
      window.removeEventListener(
        'deviceorientationabsolute',
        handleOrientation as EventListener,
        true,
      );
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, []);

  // Respaldo con rumbo GPS si el usuario está en movimiento y no hay magnetómetro reciente
  useEffect(() => {
    const magRecent = Date.now() - lastMagTsRef.current < 4000;
    if (magRecent) return;

    if (
      gnssFix.isLiveHardware &&
      typeof gnssFix.heading === 'number' &&
      Number.isFinite(gnssFix.heading) &&
      (gnssFix.speed ?? 0) >= 0.4
    ) {
      const smoothed = smoothHeadingDeg(smoothRef.current, gnssFix.heading, 0.35);
      smoothRef.current = smoothed;
      setHeadingDeg(smoothed);
      setSource('gps_course');
    }
  }, [gnssFix.heading, gnssFix.isLiveHardware, gnssFix.speed, gnssFix.timestamp]);

  return { headingDeg, source };
}
