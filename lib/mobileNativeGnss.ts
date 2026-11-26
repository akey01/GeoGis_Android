'use client';

import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type NativeConstellation =
  | 'GPS'
  | 'GLONASS'
  | 'GALILEO'
  | 'BEIDOU'
  | 'QZSS'
  | 'SBAS'
  | 'NAVIC'
  | 'OTHER';

export interface NativeSatelliteInfo {
  prn: string;
  svid: number;
  constellation: NativeConstellation;
  elevationDeg: number;
  azimuthDeg: number;
  cn0DbHz: number;
  usedInFix: boolean;
  hasEphemeris: boolean;
  hasAlmanac: boolean;
  carrierFrequencyMhz: number | null;
}

export interface NativeGnssSnapshot {
  available: boolean;
  running: boolean;
  permissionDenied: boolean;
  satellites: NativeSatelliteInfo[];
  usedCount: number;
  visibleCount: number;
  pdop: number | null;
  hdop: number | null;
  vdop: number | null;
  timestamp: number;
}

interface GeoGisGnssStatusEvent {
  satellites?: NativeSatelliteInfo[];
  usedCount?: number;
  visibleCount?: number;
  pdop?: number | null;
  hdop?: number | null;
  vdop?: number | null;
  timestamp?: number;
}

interface GeoGisGnssPluginInterface {
  start(): Promise<{ started: boolean; permissionDenied?: boolean }>;
  stop(): Promise<void>;
  getStatus(): Promise<GeoGisGnssStatusEvent>;
  addListener(
    eventName: 'gnssStatus',
    listenerFunc: (event: GeoGisGnssStatusEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const GeoGisGnss = registerPlugin<GeoGisGnssPluginInterface>('GeoGisGnss');

const INITIAL_SNAPSHOT: NativeGnssSnapshot = {
  available: false,
  running: false,
  permissionDenied: false,
  satellites: [],
  usedCount: 0,
  visibleCount: 0,
  pdop: null,
  hdop: null,
  vdop: null,
  timestamp: 0,
};

function sanitizeConstellation(val: unknown): NativeConstellation {
  switch (val) {
    case 'GPS':
    case 'GLONASS':
    case 'GALILEO':
    case 'BEIDOU':
    case 'QZSS':
    case 'SBAS':
    case 'NAVIC':
      return val;
    default:
      return 'OTHER';
  }
}

function normalizeEventToSnapshot(
  ev: GeoGisGnssStatusEvent,
  running: boolean,
): NativeGnssSnapshot {
  const sats = Array.isArray(ev.satellites)
    ? ev.satellites.map((s) => ({
        prn: String(s.prn || `S${s.svid ?? 0}`),
        svid: Number(s.svid || 0),
        constellation: sanitizeConstellation(s.constellation),
        elevationDeg: Number(s.elevationDeg || 0),
        azimuthDeg: Number(s.azimuthDeg || 0),
        cn0DbHz: Number(s.cn0DbHz || 0),
        usedInFix: Boolean(s.usedInFix),
        hasEphemeris: Boolean(s.hasEphemeris),
        hasAlmanac: Boolean(s.hasAlmanac),
        carrierFrequencyMhz:
          typeof s.carrierFrequencyMhz === 'number' &&
          Number.isFinite(s.carrierFrequencyMhz) &&
          s.carrierFrequencyMhz > 0
            ? Math.round(s.carrierFrequencyMhz * 100) / 100
            : null,
      }))
    : [];

  return {
    available: true,
    running,
    permissionDenied: false,
    satellites: sats,
    usedCount:
      typeof ev.usedCount === 'number'
        ? ev.usedCount
        : sats.filter((s) => s.usedInFix).length,
    visibleCount:
      typeof ev.visibleCount === 'number' ? ev.visibleCount : sats.length,
    pdop: typeof ev.pdop === 'number' && Number.isFinite(ev.pdop) ? ev.pdop : null,
    hdop: typeof ev.hdop === 'number' && Number.isFinite(ev.hdop) ? ev.hdop : null,
    vdop: typeof ev.vdop === 'number' && Number.isFinite(ev.vdop) ? ev.vdop : null,
    timestamp: Number(ev.timestamp || Date.now()),
  };
}

export function useNativeGnssStatus(active = true): NativeGnssSnapshot {
  const [snapshot, setSnapshot] = useState<NativeGnssSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    if (
      !active ||
      typeof window === 'undefined' ||
      !Capacitor.isNativePlatform() ||
      !Capacitor.isPluginAvailable('GeoGisGnss')
    ) {
      return;
    }

    let cancelled = false;
    let listenerHandle: PluginListenerHandle | null = null;

    setSnapshot((prev) => ({ ...prev, available: true }));

    void (async () => {
      try {
        listenerHandle = await GeoGisGnss.addListener('gnssStatus', (ev) => {
          if (!cancelled) {
            setSnapshot(normalizeEventToSnapshot(ev, true));
          }
        });

        const startRes = await GeoGisGnss.start();
        if (cancelled) return;

        if (startRes?.permissionDenied) {
          setSnapshot((prev) => ({
            ...prev,
            available: true,
            running: false,
            permissionDenied: true,
          }));
          return;
        }

        const current = await GeoGisGnss.getStatus().catch(() => null);
        if (!cancelled && current) {
          setSnapshot(normalizeEventToSnapshot(current, Boolean(startRes?.started ?? true)));
        } else if (!cancelled) {
          setSnapshot((prev) => ({ ...prev, available: true, running: Boolean(startRes?.started ?? true) }));
        }
      } catch {
        if (!cancelled) {
          setSnapshot((prev) => ({ ...prev, running: false }));
        }
      }
    })();

    return () => {
      cancelled = true;
      void listenerHandle?.remove().catch(() => {});
      void GeoGisGnss.stop().catch(() => {});
    };
  }, [active]);

  return snapshot;
}
