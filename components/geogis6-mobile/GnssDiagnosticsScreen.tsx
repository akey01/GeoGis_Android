'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  Compass,
  Crosshair,
  Download,
  Pencil,
  RefreshCw,
  RotateCcw,
  Satellite,
  Sliders,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import {
  APK_DOWNLOAD_URL,
  formatCoord,
  type CrsMode,
  type FieldParcel,
  type LiveGnssFix,
} from './data/fieldData';
import {
  computeOnePointCalibration,
  DEFAULT_GNSS_CORRECTION,
  psad56ToRegven,
  regvenToPsad56,
  type GnssCorrectionConfig,
  type GnssEpochSample,
  type GnssFieldStats,
  type GnssFilterMode,
} from '@/lib/mobileGnssCorrection';
import type {
  NativeConstellation,
  NativeGnssSnapshot,
  NativeSatelliteInfo,
} from '@/lib/mobileNativeGnss';

interface GnssDiagnosticsScreenProps {
  rawGnssFix: LiveGnssFix;
  correctedGnssFix: LiveGnssFix;
  gnssStats: GnssFieldStats;
  nativeGnss: NativeGnssSnapshot;
  correctionConfig: GnssCorrectionConfig;
  crsMode: CrsMode;
  huso: number;
  parcels: FieldParcel[];
  activeParcel: FieldParcel | null;
  onUpdateCorrection: (next: GnssCorrectionConfig) => void;
  onRestartGnss: () => void;
  onClearFilterBuffer: () => void;
  onNotify: (msg: string) => void;
}

type InstrumentTab = 'skyplot' | 'dispersion' | 'imu' | 'convergence';

const CONSTELLATION_STYLE: Record<
  NativeConstellation,
  { label: string; color: string; bands: string }
> = {
  GPS: { label: 'GPS NAVSTAR', color: '#4cd7f6', bands: 'L1 / L5' },
  GLONASS: { label: 'GLONASS', color: '#ffb95f', bands: 'G1 / G2' },
  GALILEO: { label: 'GALILEO', color: '#4edea3', bands: 'E1 / E5a' },
  BEIDOU: { label: 'BEIDOU-3', color: '#acedff', bands: 'B1I / B2a' },
  QZSS: { label: 'QZSS', color: '#c084fc', bands: 'L1 / L5' },
  SBAS: { label: 'SBAS', color: '#f472b6', bands: 'WAAS/EGNOS' },
  NAVIC: { label: 'NAVIC', color: '#fb923c', bands: 'L5' },
  OTHER: { label: 'OTROS', color: '#869397', bands: 'GNSS' },
};

const SCATTER_RINGS_M = [0.5, 1, 2, 5, 10, 25, 50];

export default function GnssDiagnosticsScreen({
  rawGnssFix,
  correctedGnssFix,
  gnssStats,
  nativeGnss,
  correctionConfig,
  crsMode,
  huso,
  parcels,
  activeParcel,
  onUpdateCorrection,
  onRestartGnss,
  onClearFilterBuffer,
  onNotify,
}: GnssDiagnosticsScreenProps) {
  const [activeTab, setActiveTab] = useState<InstrumentTab>('skyplot');
  const [skySubView, setSkySubView] = useState<'polar' | 'bars'>('polar');
  const [maskAngleDeg, setMaskAngleDeg] = useState<0 | 10 | 15 | 20>(10);
  const [selectedPrn, setSelectedPrn] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  // Nivel IMU electrónico real (DeviceOrientationEvent beta/gamma)
  const [imuRaw, setImuRaw] = useState<{ pitch: number; roll: number; active: boolean }>({
    pitch: 0,
    roll: 0,
    active: false,
  });
  const [imuTare, setImuTare] = useState<{ pitch: number; roll: number }>({
    pitch: 0,
    roll: 0,
  });

  // Modales de calibración y parámetros físicos
  const [showCalibModal, setShowCalibModal] = useState(false);
  const [calibSource, setCalibSource] = useState<'vertex' | 'manual'>('vertex');
  const [calibParcelId, setCalibParcelId] = useState<string>(activeParcel?.id || parcels[0]?.id || '');
  const [calibVertexId, setCalibVertexId] = useState<string>(activeParcel?.vertices[0]?.id || '');
  const [manualE, setManualE] = useState('');
  const [manualN, setManualN] = useState('');
  const [manualZ, setManualZ] = useState('');
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibSamples, setCalibSamples] = useState<GnssEpochSample[]>([]);
  const lastCalibTsRef = useRef<number>(0);

  const [showManualShiftModal, setShowManualShiftModal] = useState(false);
  const [draftShiftE, setDraftShiftE] = useState(correctionConfig.shiftEsteM.toFixed(3));
  const [draftShiftN, setDraftShiftN] = useState(correctionConfig.shiftNorteM.toFixed(3));
  const [draftShiftZ, setDraftShiftZ] = useState(correctionConfig.shiftCotaM.toFixed(3));
  const [draftAntH, setDraftAntH] = useState(correctionConfig.antennaHeightM.toFixed(3));
  const [draftGeoidN, setDraftGeoidN] = useState(correctionConfig.geoidUndulationM.toFixed(2));

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Sincronizar parcela por defecto en modal de calibración
  useEffect(() => {
    if (!calibParcelId && (activeParcel || parcels[0])) {
      const p = activeParcel || parcels[0];
      setCalibParcelId(p.id);
      setCalibVertexId(p.vertices[0]?.id || '');
    }
  }, [activeParcel, calibParcelId, parcels]);

  // Sensor IMU real cuando la pestaña Nivel IMU está visible
  useEffect(() => {
    if (activeTab !== 'imu' || typeof window === 'undefined') return;
    const handleOrientation = (ev: DeviceOrientationEvent) => {
      if (typeof ev.beta !== 'number' || typeof ev.gamma !== 'number') return;
      if (!Number.isFinite(ev.beta) || !Number.isFinite(ev.gamma)) return;
      setImuRaw({ pitch: ev.beta, roll: ev.gamma, active: true });
    };
    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => window.removeEventListener('deviceorientation', handleOrientation, true);
  }, [activeTab]);

  // Recolección de 10 épocas GNSS reales durante Calibración en 1 Punto
  const CAL_TARGET = 10;
  useEffect(() => {
    if (!isCalibrating || !rawGnssFix.isLiveHardware) return;
    if (rawGnssFix.timestamp === lastCalibTsRef.current) return;
    lastCalibTsRef.current = rawGnssFix.timestamp;

    setCalibSamples((prev) =>
      [
        ...prev,
        {
          lat: rawGnssFix.lat,
          lng: rawGnssFix.lng,
          alt: rawGnssFix.alt,
          accuracy: rawGnssFix.accuracy || 3.5,
          altitudeAccuracy: rawGnssFix.altitudeAccuracy ?? null,
          esteRegven: rawGnssFix.esteRegven,
          norteRegven: rawGnssFix.norteRegven,
          speed: rawGnssFix.speed ?? null,
          heading: rawGnssFix.heading ?? null,
          timestamp: rawGnssFix.timestamp,
        },
      ].slice(0, CAL_TARGET),
    );
  }, [
    isCalibrating,
    rawGnssFix.accuracy,
    rawGnssFix.alt,
    rawGnssFix.altitudeAccuracy,
    rawGnssFix.esteRegven,
    rawGnssFix.heading,
    rawGnssFix.isLiveHardware,
    rawGnssFix.lat,
    rawGnssFix.lng,
    rawGnssFix.norteRegven,
    rawGnssFix.speed,
    rawGnssFix.timestamp,
  ]);

  const calibTargetCoords = useMemo(() => {
    if (calibSource === 'vertex') {
      const p = parcels.find((x) => x.id === calibParcelId) || activeParcel || null;
      const v = p?.vertices.find((vx) => vx.id === calibVertexId) || p?.vertices[0] || null;
      if (!p || !v) return null;
      return {
        label: `${p.code} · ${v.id}`,
        esteRegven: v.esteRegven,
        norteRegven: v.norteRegven,
        cota: Number.isFinite(v.cota) ? v.cota : null,
      };
    }

    const eNum = Number.parseFloat(manualE);
    const nNum = Number.parseFloat(manualN);
    const zNum = Number.parseFloat(manualZ);
    if (!Number.isFinite(eNum) || !Number.isFinite(nNum)) return null;

    const regven =
      crsMode === 'regven'
        ? { este: eNum, norte: nNum }
        : psad56ToRegven(eNum, nNum, huso);

    return {
      label: `BM Manual (${crsMode.toUpperCase()})`,
      esteRegven: regven.este,
      norteRegven: regven.norte,
      cota: Number.isFinite(zNum) ? zNum : null,
    };
  }, [
    activeParcel,
    calibParcelId,
    calibSource,
    calibVertexId,
    crsMode,
    huso,
    manualE,
    manualN,
    manualZ,
    parcels,
  ]);

  const finalizeCalibration = (samples: GnssEpochSample[]) => {
    if (!calibTargetCoords || samples.length === 0) {
      setIsCalibrating(false);
      setCalibSamples([]);
      return;
    }
    const cal = computeOnePointCalibration(
      samples,
      calibTargetCoords.esteRegven,
      calibTargetCoords.norteRegven,
      calibTargetCoords.cota,
      correctionConfig.antennaHeightM,
      correctionConfig.geoidUndulationM,
    );
    const nextCfg: GnssCorrectionConfig = {
      ...correctionConfig,
      enabled: true,
      shiftEsteM: cal.shiftEsteM,
      shiftNorteM: cal.shiftNorteM,
      shiftCotaM: calibTargetCoords.cota !== null ? cal.shiftCotaM : correctionConfig.shiftCotaM,
      calibrationLabel: calibTargetCoords.label,
      calibratedAt: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }),
    };
    onUpdateCorrection(nextCfg);
    setIsCalibrating(false);
    setCalibSamples([]);
    setShowCalibModal(false);
    onNotify(
      `Calibración aplicada (${cal.sampleCount} épocas): ΔE ${cal.shiftEsteM >= 0 ? '+' : ''}${cal.shiftEsteM.toFixed(3)}m · ΔN ${cal.shiftNorteM >= 0 ? '+' : ''}${cal.shiftNorteM.toFixed(3)}m`,
    );
  };

  useEffect(() => {
    if (isCalibrating && calibSamples.length >= CAL_TARGET) {
      finalizeCalibration(calibSamples);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibSamples, isCalibrating]);

  const hasLiveGps = Boolean(rawGnssFix.isLiveHardware);
  const epochAgeSec = hasLiveGps
    ? Math.max(0, Math.round((nowTick - rawGnssFix.timestamp) / 1000))
    : null;

  const rawUtmDisplay = useMemo(() => {
    if (!hasLiveGps) return null;
    if (crsMode === 'regven') {
      return { este: rawGnssFix.esteRegven, norte: rawGnssFix.norteRegven };
    }
    return regvenToPsad56(rawGnssFix.esteRegven, rawGnssFix.norteRegven, huso);
  }, [crsMode, hasLiveGps, huso, rawGnssFix.esteRegven, rawGnssFix.norteRegven]);

  const corrUtmDisplay = useMemo(() => {
    if (!hasLiveGps) return null;
    if (crsMode === 'regven') {
      return { este: correctedGnssFix.esteRegven, norte: correctedGnssFix.norteRegven };
    }
    return regvenToPsad56(correctedGnssFix.esteRegven, correctedGnssFix.norteRegven, huso);
  }, [
    correctedGnssFix.esteRegven,
    correctedGnssFix.norteRegven,
    crsMode,
    hasLiveGps,
    huso,
  ]);

  const shiftVectorM = correctionConfig.enabled
    ? Math.hypot(correctionConfig.shiftEsteM, correctionConfig.shiftNorteM)
    : 0;

  // Satélites reales filtrados por máscara de elevación
  const visibleSats = nativeGnss.satellites;
  const activeMaskSats = visibleSats.filter((s) => s.elevationDeg >= maskAngleDeg);
  const selectedSat: NativeSatelliteInfo | null =
    visibleSats.find((s) => s.prn === selectedPrn) ||
    visibleSats.find((s) => s.usedInFix) ||
    visibleSats[0] ||
    null;

  const constellationBreakdown = useMemo(() => {
    const order: NativeConstellation[] = ['GPS', 'GLONASS', 'GALILEO', 'BEIDOU'];
    return order.map((id) => {
      const group = visibleSats.filter((s) => s.constellation === id);
      const used = group.filter((s) => s.usedInFix).length;
      const avgSnr =
        group.length > 0
          ? Math.round(group.reduce((acc, s) => acc + s.cn0DbHz, 0) / group.length)
          : 0;
      return {
        id,
        ...CONSTELLATION_STYLE[id],
        used,
        visible: group.length,
        avgSnr,
      };
    });
  }, [visibleSats]);

  // Escala automática del gráfico Bullseye de dispersión
  const scatterScaleM = useMemo(() => {
    const maxPt = gnssStats.scatterPoints.reduce(
      (mx, p) => Math.max(mx, Math.hypot(p.dE, p.dN)),
      0,
    );
    const maxR95 = gnssStats.r95M ?? 0;
    const req = Math.max(maxPt, maxR95) * 1.2;
    return SCATTER_RINGS_M.find((step) => step >= req) ?? 50;
  }, [gnssStats.r95M, gnssStats.scatterPoints]);

  // Cálculos del nivel IMU electrónico real
  const tiltPitch = Math.round((imuRaw.pitch - imuTare.pitch) * 10) / 10;
  const tiltRoll = Math.round((imuRaw.roll - imuTare.roll) * 10) / 10;
  const tiltTotalDeg = Math.round(Math.hypot(tiltPitch, tiltRoll) * 10) / 10;
  const imuLeveled = imuRaw.active && tiltTotalDeg <= 2.0;

  const handleOpenManualShift = () => {
    setDraftShiftE(correctionConfig.shiftEsteM.toFixed(3));
    setDraftShiftN(correctionConfig.shiftNorteM.toFixed(3));
    setDraftShiftZ(correctionConfig.shiftCotaM.toFixed(3));
    setDraftAntH(correctionConfig.antennaHeightM.toFixed(3));
    setDraftGeoidN(correctionConfig.geoidUndulationM.toFixed(2));
    setShowManualShiftModal(true);
  };

  const handleSaveManualShift = () => {
    const e = Number.parseFloat(draftShiftE);
    const n = Number.parseFloat(draftShiftN);
    const z = Number.parseFloat(draftShiftZ);
    const hAnt = Number.parseFloat(draftAntH);
    const nGeoid = Number.parseFloat(draftGeoidN);

    const nextCfg: GnssCorrectionConfig = {
      ...correctionConfig,
      enabled: true,
      shiftEsteM: Number.isFinite(e) ? e : 0,
      shiftNorteM: Number.isFinite(n) ? n : 0,
      shiftCotaM: Number.isFinite(z) ? z : 0,
      antennaHeightM: Number.isFinite(hAnt) && hAnt >= 0 && hAnt <= 10 ? hAnt : 0,
      geoidUndulationM: Number.isFinite(nGeoid) ? nGeoid : 0,
      calibrationLabel:
        (Number.isFinite(e) && Math.abs(e) > 0.0001) ||
        (Number.isFinite(n) && Math.abs(n) > 0.0001)
          ? correctionConfig.calibrationLabel || 'Ajuste Manual Campo'
          : null,
    };
    onUpdateCorrection(nextCfg);
    setShowManualShiftModal(false);
    onNotify('Parámetros de corrección de coordenadas guardados');
  };

  const handleResetCorrection = () => {
    onUpdateCorrection({
      ...DEFAULT_GNSS_CORRECTION,
      filterMode: correctionConfig.filterMode,
      maxAccuracyM: correctionConfig.maxAccuracyM,
    });
    onNotify('Desfase ΔE/ΔN/ΔZ y parámetros restablecidos a 0');
  };

  const selectedCalibParcel =
    parcels.find((p) => p.id === calibParcelId) || activeParcel || parcels[0] || null;

  return (
    <div className="flex flex-col w-full h-full overflow-y-auto no-scrollbar px-3 py-2 space-y-2.5 text-[#dde2f8] bg-[#0d1322] select-none relative">
      {/* 1. Cabecera Táctica de Solución y Precisión Real */}
      <section className="w-full bg-[#151b2b] rounded-xl p-2.5 shadow-md flex flex-col gap-2 border border-[#242a3a]">
        <div className="flex items-center justify-between gap-1.5">
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded border"
            style={{
              backgroundColor: `${gnssStats.solutionTier.colorHex}20`,
              borderColor: `${gnssStats.solutionTier.colorHex}55`,
              color: gnssStats.solutionTier.colorHex,
            }}
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: gnssStats.solutionTier.colorHex }}
            />
            <span className="font-stitch-headline text-[11px] tracking-wider font-bold">
              {gnssStats.solutionTier.label}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {nativeGnss.available ? (
              <div className="flex items-center gap-1 bg-[#191f2f] border border-[#2f3445] px-2 py-1 rounded text-[#dde2f8]">
                <Satellite className="w-3.5 h-3.5 text-[#4cd7f6]" />
                <span className="font-stitch-mono text-[10px]">
                  <strong className="text-[#4edea3]">{nativeGnss.usedCount}</strong>/
                  {nativeGnss.visibleCount} SAT
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1 bg-[#191f2f] border border-[#2f3445] px-2 py-1 rounded font-stitch-mono text-[10px] text-[#4cd7f6]">
                <Activity className="w-3 h-3" />
                <span>{gnssStats.updateHz > 0 ? `${gnssStats.updateHz.toFixed(1)} Hz` : '-- Hz'}</span>
              </div>
            )}

            <div className="bg-[#191f2f] border border-[#2f3445] px-2 py-1 rounded font-stitch-mono text-[10px] text-[#bcc9cd]">
              {epochAgeSec !== null ? `${epochAgeSec}s` : '--'}
            </div>
          </div>
        </div>

        {/* 4 KPI reales calculados en vivo */}
        <div className="grid grid-cols-4 gap-1.5">
          <div className="bg-[#0d1322] border border-[#242a3a] px-1.5 py-1.5 rounded text-center">
            <span className="block text-[9px] text-[#869397] uppercase">PREC. H</span>
            <span
              className="font-stitch-mono text-[13px] font-bold"
              style={{ color: gnssStats.solutionTier.colorHex }}
            >
              {hasLiveGps ? `±${correctedGnssFix.accuracy.toFixed(2)}m` : '--'}
            </span>
          </div>

          <div className="bg-[#0d1322] border border-[#242a3a] px-1.5 py-1.5 rounded text-center">
            <span className="block text-[9px] text-[#869397] uppercase">HRMS REAL</span>
            <span className="font-stitch-mono text-[13px] font-bold text-[#4cd7f6]">
              {gnssStats.hrmsM !== null ? `${gnssStats.hrmsM.toFixed(2)}m` : '--'}
            </span>
          </div>

          <div className="bg-[#0d1322] border border-[#242a3a] px-1.5 py-1.5 rounded text-center">
            <span className="block text-[9px] text-[#869397] uppercase">
              {nativeGnss.hdop !== null ? 'HDOP' : 'PREC. V'}
            </span>
            <span className="font-stitch-mono text-[13px] font-bold text-[#dde2f8]">
              {nativeGnss.hdop !== null
                ? nativeGnss.hdop.toFixed(1)
                : rawGnssFix.altitudeAccuracy != null
                  ? `±${rawGnssFix.altitudeAccuracy.toFixed(1)}m`
                  : '--'}
            </span>
          </div>

          <div className="bg-[#0d1322] border border-[#242a3a] px-1.5 py-1.5 rounded text-center">
            <span className="block text-[9px] text-[#869397] uppercase">SHIFT Δ</span>
            <span
              className={`font-stitch-mono text-[13px] font-bold ${
                shiftVectorM > 0.001 ? 'text-[#ffb95f]' : 'text-[#869397]'
              }`}
            >
              {shiftVectorM > 0.001 ? `${shiftVectorM.toFixed(2)}m` : '0.00m'}
            </span>
          </div>
        </div>
      </section>

      {/* 2. Instrumento Central Táctico (4 Vistas Reales) */}
      <section className="w-full bg-[#151b2b] rounded-xl p-2.5 shadow-md flex flex-col gap-2 border border-[#242a3a]">
        <div className="grid grid-cols-4 gap-1 bg-[#080e1d] p-1 rounded-lg font-stitch-mono text-[9.5px]">
          {(
            [
              { id: 'skyplot', label: 'SKYPLOT' },
              { id: 'dispersion', label: 'DISPERSIÓN' },
              { id: 'imu', label: 'NIVEL IMU' },
              { id: 'convergence', label: 'CURVA ±m' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`py-1.5 rounded font-bold transition-colors ${
                activeTab === t.id
                  ? 'bg-[#4cd7f6] text-[#003640]'
                  : 'text-[#bcc9cd] hover:text-[#dde2f8]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Vista A: Skyplot Nativo Real */}
        {activeTab === 'skyplot' && (
          <div className="flex flex-col items-center gap-2">
            {nativeGnss.available ? (
              <>
                <div className="w-full flex items-center justify-between font-stitch-mono text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setMaskAngleDeg((m) => (m === 0 ? 10 : m === 10 ? 15 : m === 15 ? 20 : 0))
                      }
                      className="px-2 py-0.5 rounded bg-[#242a3a] text-[#ffb95f] font-bold"
                    >
                      Máscara {maskAngleDeg}°
                    </button>
                    <span className="text-[#869397]">
                      {activeMaskSats.length} sobre {maskAngleDeg}°
                    </span>
                  </div>

                  <div className="flex items-center bg-[#080e1d] rounded p-0.5">
                    <button
                      type="button"
                      onClick={() => setSkySubView('polar')}
                      className={`px-2 py-0.5 rounded ${
                        skySubView === 'polar' ? 'bg-[#242a3a] text-[#4cd7f6] font-bold' : 'text-[#869397]'
                      }`}
                    >
                      Polar
                    </button>
                    <button
                      type="button"
                      onClick={() => setSkySubView('bars')}
                      className={`px-2 py-0.5 rounded ${
                        skySubView === 'bars' ? 'bg-[#242a3a] text-[#4cd7f6] font-bold' : 'text-[#869397]'
                      }`}
                    >
                      C/N0
                    </button>
                  </div>
                </div>

                {skySubView === 'polar' ? (
                  <div className="w-[218px] h-[218px] relative">
                    <svg className="w-full h-full" viewBox="0 0 240 240">
                      <circle cx="120" cy="120" r="106" fill="#080e1d" stroke="#2f3445" strokeWidth="1.5" />
                      {maskAngleDeg > 0 && (
                        <circle
                          cx="120"
                          cy="120"
                          r={(106 * (90 - maskAngleDeg)) / 90}
                          fill="none"
                          stroke="#ffb95f"
                          strokeOpacity="0.45"
                          strokeDasharray="3 3"
                          strokeWidth="1"
                        />
                      )}
                      <circle cx="120" cy="120" r={106 * (60 / 90)} fill="none" stroke="#242a3a" strokeWidth="1" />
                      <circle cx="120" cy="120" r={106 * (30 / 90)} fill="none" stroke="#242a3a" strokeWidth="1" />
                      <line x1="120" y1="14" x2="120" y2="226" stroke="#242a3a" strokeWidth="1" />
                      <line x1="14" y1="120" x2="226" y2="120" stroke="#242a3a" strokeWidth="1" />
                      <text x="120" y="11" textAnchor="middle" fill="#4cd7f6" fontSize="10" fontWeight="700">N</text>
                      <text x="233" y="124" textAnchor="middle" fill="#869397" fontSize="9.5" fontWeight="700">E</text>
                      <text x="120" y="237" textAnchor="middle" fill="#869397" fontSize="9.5" fontWeight="700">S</text>
                      <text x="7" y="124" textAnchor="middle" fill="#869397" fontSize="9.5" fontWeight="700">O</text>

                      {visibleSats.map((sat) => {
                        const r = ((90 - Math.max(0, Math.min(90, sat.elevationDeg))) / 90) * 106;
                        const rad = ((sat.azimuthDeg - 90) * Math.PI) / 180;
                        const cx = 120 + r * Math.cos(rad);
                        const cy = 120 + r * Math.sin(rad);
                        const masked = sat.elevationDeg < maskAngleDeg;
                        const cColor = masked ? '#3d494c' : CONSTELLATION_STYLE[sat.constellation].color;
                        const isSel = selectedSat?.prn === sat.prn;
                        return (
                          <g
                            key={sat.prn}
                            onClick={() => setSelectedPrn(sat.prn)}
                            style={{ cursor: 'pointer' }}
                          >
                            {isSel && (
                              <circle cx={cx} cy={cy} r="12" fill="none" stroke="#ffffff" strokeWidth="1.5" />
                            )}
                            <circle
                              cx={cx}
                              cy={cy}
                              r={sat.usedInFix ? 9.5 : 8}
                              fill={sat.usedInFix ? cColor : '#151b2b'}
                              stroke={cColor}
                              strokeWidth={sat.usedInFix ? 1.5 : 1.8}
                            />
                            <text
                              x={cx}
                              y={cy + 2.8}
                              textAnchor="middle"
                              fontSize="7"
                              fontWeight="700"
                              fill={sat.usedInFix && !masked ? '#00242c' : '#dde2f8'}
                            >
                              {sat.prn}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                    {visibleSats.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="font-stitch-mono text-[10px] text-[#ffb95f] bg-[#080e1d]/90 px-2.5 py-1 rounded border border-[#ffb95f]/40">
                          {nativeGnss.permissionDenied
                            ? 'Permiso GPS requerido'
                            : 'Escaneando cielo GNSS...'}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full max-h-[218px] overflow-y-auto no-scrollbar space-y-1.5 py-1">
                    {visibleSats.slice(0, 14).map((sat) => {
                      const cColor =
                        sat.elevationDeg < maskAngleDeg
                          ? '#3d494c'
                          : CONSTELLATION_STYLE[sat.constellation].color;
                      return (
                        <div key={sat.prn} className="flex items-center gap-2 font-stitch-mono text-[10px]">
                          <span className="w-8 font-bold text-[#dde2f8]">{sat.prn}</span>
                          <span className="w-9 text-[9px] text-[#869397]">{Math.round(sat.elevationDeg)}°</span>
                          <div className="flex-1 h-2 bg-[#080e1d] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, Math.round((sat.cn0DbHz / 50) * 100))}%`,
                                backgroundColor: cColor,
                              }}
                            />
                          </div>
                          <span className="w-14 text-right font-bold" style={{ color: cColor }}>
                            {sat.cn0DbHz.toFixed(0)} dB
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedSat && (
                  <div className="w-full bg-[#080e1d] border border-[#242a3a] px-2.5 py-1.5 rounded flex items-center justify-between font-stitch-mono text-[10px]">
                    <span className="font-bold" style={{ color: CONSTELLATION_STYLE[selectedSat.constellation].color }}>
                      {selectedSat.prn} · {selectedSat.constellation}
                    </span>
                    <span className="text-[#bcc9cd]">
                      El {selectedSat.elevationDeg.toFixed(0)}° · Az {selectedSat.azimuthDeg.toFixed(0)}°
                      {selectedSat.carrierFrequencyMhz ? ` · ${selectedSat.carrierFrequencyMhz}MHz` : ''}
                    </span>
                    <span className="text-[#4edea3] font-bold">{selectedSat.cn0DbHz.toFixed(1)} dB-Hz</span>
                  </div>
                )}

                <div className="w-full grid grid-cols-4 gap-1.5">
                  {constellationBreakdown.map((c) => (
                    <div
                      key={c.id}
                      className="bg-[#080e1d] border border-[#242a3a] rounded p-1.5 flex flex-col"
                    >
                      <span className="font-stitch-headline text-[9px] font-bold truncate" style={{ color: c.color }}>
                        {c.id}
                      </span>
                      <span className="font-stitch-mono text-[11px] font-bold text-[#dde2f8]">
                        {c.used}/{c.visible}
                      </span>
                      <span className="font-stitch-mono text-[8.5px] text-[#869397]">
                        {c.avgSnr > 0 ? `${c.avgSnr} dB` : '--'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="w-full bg-[#080e1d] border border-[#242a3a] rounded-xl p-3.5 text-center space-y-2">
                <Satellite className="w-7 h-7 text-[#4cd7f6] mx-auto opacity-85" />
                <div className="font-stitch-headline text-[13px] font-bold text-[#dde2f8]">
                  Telemetría PRN/C-N0 Nativa Lista en el Nuevo APK
                </div>
                <p className="font-stitch-mono text-[10px] text-[#bcc9cd] leading-relaxed">
                  Android WebView no expone satélites individuales sin el sensor nativo{' '}
                  <span className="text-[#4cd7f6]">GeoGisGnss</span>. Mientras usas la corrección de coordenadas
                  abajo o las pestañas <strong className="text-[#4edea3]">Dispersión / IMU / Curva</strong>,
                  puedes descargar el APK firmado actualizado para activar el Skyplot satelital real.
                </p>
                <button
                  type="button"
                  onClick={() => window.open(APK_DOWNLOAD_URL, '_blank')}
                  className="px-3.5 py-2 rounded-lg bg-[#4cd7f6] text-[#003640] font-stitch-headline text-[11px] font-bold uppercase inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar APK con Skyplot Real</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Vista B: Dispersión Bullseye Real */}
        {activeTab === 'dispersion' && (
          <div className="flex flex-col items-center gap-2">
            <div className="w-[214px] h-[214px] relative">
              <svg className="w-full h-full" viewBox="0 0 220 220">
                <circle cx="110" cy="110" r="96" fill="#080e1d" stroke="#2f3445" strokeWidth="1.5" />
                <circle cx="110" cy="110" r="64" fill="none" stroke="#242a3a" strokeWidth="1" />
                <circle cx="110" cy="110" r="32" fill="none" stroke="#242a3a" strokeWidth="1" />
                <line x1="14" y1="110" x2="206" y2="110" stroke="#242a3a" strokeWidth="1" />
                <line x1="110" y1="14" x2="110" y2="206" stroke="#242a3a" strokeWidth="1" />

                {gnssStats.r95M !== null && gnssStats.r95M > 0 && (
                  <circle
                    cx="110"
                    cy="110"
                    r={Math.min(96, (gnssStats.r95M / scatterScaleM) * 96)}
                    fill="rgba(78, 222, 163, 0.06)"
                    stroke="#4edea3"
                    strokeDasharray="4 3"
                    strokeWidth="1.2"
                  />
                )}

                {gnssStats.cep50M !== null && gnssStats.cep50M > 0 && (
                  <circle
                    cx="110"
                    cy="110"
                    r={Math.min(96, (gnssStats.cep50M / scatterScaleM) * 96)}
                    fill="none"
                    stroke="#4cd7f6"
                    strokeWidth="1.2"
                  />
                )}

                {gnssStats.scatterPoints.map((pt, idx) => {
                  const px = 110 + Math.max(-94, Math.min(94, (pt.dE / scatterScaleM) * 96));
                  const py = 110 - Math.max(-94, Math.min(94, (pt.dN / scatterScaleM) * 96));
                  return (
                    <circle
                      key={idx}
                      cx={px}
                      cy={py}
                      r={pt.isLatest ? 4.5 : 2.3}
                      fill={pt.isLatest ? '#ffb95f' : '#4cd7f6'}
                      fillOpacity={pt.isLatest ? 1 : 0.65}
                    />
                  );
                })}

                <text x="113" y="24" fill="#869397" fontSize="8.5" fontFamily="monospace">
                  {scatterScaleM}m
                </text>
                <text x="113" y="56" fill="#869397" fontSize="8.5" fontFamily="monospace">
                  {(scatterScaleM * 0.66).toFixed(1)}m
                </text>
              </svg>
            </div>

            <div className="w-full grid grid-cols-4 gap-1.5 font-stitch-mono text-[9.5px]">
              <div className="bg-[#080e1d] px-2 py-1 rounded text-center">
                <span className="text-[#869397] block text-[8.5px]">CEP50</span>
                <strong className="text-[#4cd7f6]">
                  {gnssStats.cep50M !== null ? `${gnssStats.cep50M.toFixed(2)}m` : '--'}
                </strong>
              </div>
              <div className="bg-[#080e1d] px-2 py-1 rounded text-center">
                <span className="text-[#869397] block text-[8.5px]">R95</span>
                <strong className="text-[#4edea3]">
                  {gnssStats.r95M !== null ? `${gnssStats.r95M.toFixed(2)}m` : '--'}
                </strong>
              </div>
              <div className="bg-[#080e1d] px-2 py-1 rounded text-center">
                <span className="text-[#869397] block text-[8.5px]">σE / σN</span>
                <strong className="text-[#dde2f8]">
                  {gnssStats.sigmaEM !== null && gnssStats.sigmaNM !== null
                    ? `${gnssStats.sigmaEM.toFixed(2)}/${gnssStats.sigmaNM.toFixed(2)}`
                    : '--'}
                </strong>
              </div>
              <div className="bg-[#080e1d] px-2 py-1 rounded text-center">
                <span className="text-[#869397] block text-[8.5px]">ÉPOCAS</span>
                <strong className="text-[#ffb95f]">{gnssStats.sampleCount}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Vista C: Nivel Electrónico IMU Real */}
        {activeTab === 'imu' && (
          <div className="flex flex-col items-center gap-2">
            <div className="w-[214px] h-[214px] relative">
              <svg className="w-full h-full" viewBox="0 0 220 220">
                <circle
                  cx="110"
                  cy="110"
                  r="94"
                  fill="#080e1d"
                  stroke={imuLeveled ? '#4edea3' : '#2f3445'}
                  strokeWidth="2"
                />
                <circle cx="110" cy="110" r="60" fill="none" stroke="#242a3a" strokeWidth="1" />
                <circle
                  cx="110"
                  cy="110"
                  r="18"
                  fill={imuLeveled ? 'rgba(78, 222, 163, 0.14)' : 'none'}
                  stroke={imuLeveled ? '#4edea3' : '#4cd7f6'}
                  strokeDasharray="3 3"
                  strokeWidth="1.5"
                />
                <line x1="16" y1="110" x2="204" y2="110" stroke="#242a3a" strokeWidth="1" />
                <line x1="110" y1="16" x2="110" y2="204" stroke="#242a3a" strokeWidth="1" />
                {(() => {
                  const clampedR = Math.max(-15, Math.min(15, tiltRoll));
                  const clampedP = Math.max(-15, Math.min(15, tiltPitch));
                  const bx = 110 + (clampedR / 15) * 76;
                  const by = 110 + (clampedP / 15) * 76;
                  return (
                    <circle
                      cx={bx}
                      cy={by}
                      r="11"
                      fill={imuLeveled ? '#4edea3' : '#ffb95f'}
                      fillOpacity="0.9"
                      stroke="#080e1d"
                      strokeWidth="2"
                    />
                  );
                })()}
              </svg>
            </div>

            <div className="w-full flex items-center justify-between gap-2 font-stitch-mono text-[10px]">
              <div className="bg-[#080e1d] px-2.5 py-1.5 rounded flex-1">
                <span className={imuLeveled ? 'text-[#4edea3] font-bold' : 'text-[#ffb95f] font-bold'}>
                  {!imuRaw.active
                    ? 'Acelerómetro IMU sin respuesta'
                    : imuLeveled
                      ? `✓ NIVELADO (${tiltTotalDeg.toFixed(1)}°)`
                      : `INCLINACIÓN ${tiltTotalDeg.toFixed(1)}° · Nivela ≤2°`}
                </span>
                <span className="block text-[9px] text-[#869397]">
                  Pitch {tiltPitch.toFixed(1)}° · Roll {tiltRoll.toFixed(1)}°
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setImuTare({ pitch: imuRaw.pitch, roll: imuRaw.roll });
                  onNotify('Nivel IMU tarado a 0.0° en posición actual');
                }}
                className="px-3 py-2 rounded bg-[#242a3a] text-[#4cd7f6] font-bold shrink-0"
              >
                Tarar 0°
              </button>
            </div>
          </div>
        )}

        {/* Vista D: Curva de Convergencia Real (±m) */}
        {activeTab === 'convergence' && (
          <div className="flex flex-col gap-2">
            <div className="w-full h-[140px] bg-[#080e1d] rounded-lg p-2 border border-[#242a3a]">
              {gnssStats.accuracyHistory.length >= 2 ? (
                <svg className="w-full h-full" viewBox="0 0 280 100" preserveAspectRatio="none">
                  {(() => {
                    const hist = gnssStats.accuracyHistory;
                    const maxAcc = Math.max(5, ...hist.map((h) => h.accuracy));
                    const pts = hist
                      .map((h, i) => {
                        const x = (i / Math.max(1, hist.length - 1)) * 276 + 2;
                        const y = 94 - (Math.min(maxAcc, h.accuracy) / maxAcc) * 86;
                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                      })
                      .join(' ');
                    return (
                      <>
                        <line x1="2" y1="50" x2="278" y2="50" stroke="#1f293d" strokeDasharray="3 3" />
                        <polyline fill="none" stroke="#4cd7f6" strokeWidth="2.2" points={pts} />
                      </>
                    );
                  })()}
                </svg>
              ) : (
                <div className="w-full h-full flex items-center justify-center font-stitch-mono text-[10.5px] text-[#869397]">
                  Recopilando lecturas GNSS para graficar convergencia...
                </div>
              )}
            </div>
            {gnssStats.accuracyHistory.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5 font-stitch-mono text-[10px]">
                <div className="bg-[#080e1d] p-1.5 rounded text-center">
                  <span className="text-[#869397] block text-[8.5px]">ACTUAL</span>
                  <strong className="text-[#4cd7f6]">
                    ±{gnssStats.accuracyHistory[gnssStats.accuracyHistory.length - 1].accuracy.toFixed(2)}m
                  </strong>
                </div>
                <div className="bg-[#080e1d] p-1.5 rounded text-center">
                  <span className="text-[#869397] block text-[8.5px]">MÍNIMA</span>
                  <strong className="text-[#4edea3]">
                    ±{Math.min(...gnssStats.accuracyHistory.map((x) => x.accuracy)).toFixed(2)}m
                  </strong>
                </div>
                <div className="bg-[#080e1d] p-1.5 rounded text-center">
                  <span className="text-[#869397] block text-[8.5px]">PROMEDIO</span>
                  <strong className="text-[#dde2f8]">
                    ±
                    {(
                      gnssStats.accuracyHistory.reduce((a, b) => a + b.accuracy, 0) /
                      gnssStats.accuracyHistory.length
                    ).toFixed(2)}
                    m
                  </strong>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3. Motor de Corrección de Coordenadas en Campo */}
      <section className="w-full bg-[#151b2b] rounded-xl p-2.5 shadow-md flex flex-col gap-2 border border-[#242a3a]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Target className="w-4 h-4 text-[#4edea3] shrink-0" />
            <span className="font-stitch-headline text-[12px] font-bold uppercase text-[#dde2f8] truncate">
              Corrección de Coordenadas
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              onUpdateCorrection({ ...correctionConfig, enabled: !correctionConfig.enabled })
            }
            className={`px-2.5 py-1 rounded-full font-stitch-mono text-[10px] font-bold border ${
              correctionConfig.enabled
                ? 'bg-[#4edea3]/20 border-[#4edea3] text-[#4edea3]'
                : 'bg-[#242a3a] border-[#3d494c] text-[#869397]'
            }`}
          >
            {correctionConfig.enabled ? 'ACTIVA' : 'DESACTIVADA'}
          </button>
        </div>

        {/* Selector de Filtro de Estabilización */}
        <div className="grid grid-cols-3 gap-1 bg-[#080e1d] p-1 rounded-lg font-stitch-mono text-[10px]">
          {(
            [
              { id: 'static_hd', label: 'Estático HD' },
              { id: 'dynamic', label: 'Dinámico' },
              { id: 'raw', label: 'Crudo' },
            ] as Array<{ id: GnssFilterMode; label: string }>
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                onUpdateCorrection({ ...correctionConfig, filterMode: mode.id });
                onNotify(`Filtro GNSS: ${mode.label}`);
              }}
              className={`py-1.5 rounded font-bold transition-colors ${
                correctionConfig.filterMode === mode.id
                  ? 'bg-[#06b6d4] text-[#003640]'
                  : 'text-[#bcc9cd] hover:text-[#dde2f8]'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Umbral Máx ±m */}
        <div className="flex items-center justify-between gap-1.5 bg-[#080e1d] px-2 py-1.5 rounded-lg font-stitch-mono text-[9.5px]">
          <span className="text-[#869397] shrink-0">
            Filtro Máx ±m{gnssStats.rejectedCount > 0 ? ` (${gnssStats.rejectedCount} desc.)` : ''}:
          </span>
          <div className="flex items-center gap-1">
            {[null, 10, 5, 3].map((lim) => {
              const active = correctionConfig.maxAccuracyM === lim;
              return (
                <button
                  key={String(lim)}
                  type="button"
                  onClick={() => onUpdateCorrection({ ...correctionConfig, maxAccuracyM: lim })}
                  className={`px-2 py-0.5 rounded font-bold ${
                    active ? 'bg-[#ffb95f] text-[#3a2200]' : 'bg-[#191f2f] text-[#bcc9cd]'
                  }`}
                >
                  {lim === null ? 'Libre' : `${lim}m`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Calibración en 1 Punto Conocido (Site Calibration) */}
        <button
          type="button"
          onClick={() => setShowCalibModal(true)}
          className="w-full py-2.5 px-3 rounded-lg bg-[#4edea3]/15 hover:bg-[#4edea3]/25 border border-[#4edea3]/60 text-[#4edea3] font-stitch-headline text-[11.5px] font-bold uppercase flex items-center justify-center gap-2"
        >
          <Crosshair className="w-4 h-4" />
          <span>Calibrar en Punto Conocido (10 lecturas)</span>
        </button>

        {correctionConfig.calibrationLabel && (
          <div className="bg-[#080e1d] border border-[#ffb95f]/40 px-2.5 py-1.5 rounded flex items-center justify-between font-stitch-mono text-[9.5px]">
            <span className="text-[#ffb95f] truncate">
              Calibrado en: <strong>{correctionConfig.calibrationLabel}</strong>
            </span>
            {correctionConfig.calibratedAt && (
              <span className="text-[#869397] shrink-0 ml-2">{correctionConfig.calibratedAt}</span>
            )}
          </div>
        )}

        {/* Desfase ΔE / ΔN / ΔZ + Altura Jalón + Ondulación Geoidal */}
        <div className="grid grid-cols-12 gap-1.5">
          <button
            type="button"
            onClick={handleOpenManualShift}
            className="col-span-7 bg-[#080e1d] hover:bg-[#191f2f] border border-[#242a3a] rounded-lg p-2 text-left flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <span className="font-stitch-mono text-[9px] text-[#869397] uppercase">
                Ajuste Shift ΔE / ΔN / ΔZ
              </span>
              <Pencil className="w-3 h-3 text-[#4cd7f6]" />
            </div>
            <div className="font-stitch-mono text-[10.5px] text-[#dde2f8] font-bold mt-0.5">
              ΔE {correctionConfig.shiftEsteM >= 0 ? '+' : ''}
              {correctionConfig.shiftEsteM.toFixed(3)} · ΔN {correctionConfig.shiftNorteM >= 0 ? '+' : ''}
              {correctionConfig.shiftNorteM.toFixed(3)}
            </div>
            <span className="font-stitch-mono text-[9.5px] text-[#4cd7f6]">
              ΔZ {correctionConfig.shiftCotaM >= 0 ? '+' : ''}
              {correctionConfig.shiftCotaM.toFixed(3)}m · Jalón {correctionConfig.antennaHeightM.toFixed(2)}m · N{' '}
              {correctionConfig.geoidUndulationM.toFixed(1)}m
            </span>
          </button>

          <button
            type="button"
            onClick={handleResetCorrection}
            className="col-span-5 bg-[#191f2f] hover:bg-[#242a3a] border border-[#242a3a] rounded-lg p-2 flex flex-col items-center justify-center gap-1 text-[#bcc9cd]"
          >
            <RotateCcw className="w-4 h-4 text-[#ffb95f]" />
            <span className="font-stitch-headline text-[10px] font-bold uppercase">Reset Δ a 0</span>
          </button>
        </div>

        {/* Auditoría Crudo vs Corregido */}
        <div className="bg-[#080e1d] border border-[#242a3a] rounded-lg p-2 space-y-1 font-stitch-mono text-[9.5px]">
          <div className="flex items-center justify-between text-[#869397]">
            <span>AUDITORÍA {crsMode === 'regven' ? `REGVEN ${huso}N` : `PSAD56 ${huso}N`}</span>
            <span>
              {hasLiveGps
                ? `${correctedGnssFix.lat.toFixed(6)}, ${correctedGnssFix.lng.toFixed(6)}`
                : 'Sin fix GNSS'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-[#bcc9cd] border-t border-[#191f2f] pt-1">
            <span className="text-[#869397]">Crudo:</span>
            <span>{rawUtmDisplay ? `E ${formatCoord(rawUtmDisplay.este)}` : '--'}</span>
            <span>{rawUtmDisplay ? `N ${formatCoord(rawUtmDisplay.norte)}` : '--'}</span>
            <span className="text-right">{hasLiveGps ? `Z ${rawGnssFix.alt.toFixed(2)}` : '--'}</span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-[#4edea3] font-bold">
            <span>Correg.:</span>
            <span>{corrUtmDisplay ? `E ${formatCoord(corrUtmDisplay.este)}` : '--'}</span>
            <span>{corrUtmDisplay ? `N ${formatCoord(corrUtmDisplay.norte)}` : '--'}</span>
            <span className="text-right">{hasLiveGps ? `Z ${correctedGnssFix.alt.toFixed(2)}` : '--'}</span>
          </div>
        </div>
      </section>

      {/* 4. Acciones Reales de Hardware y Búfer */}
      <div className="w-full grid grid-cols-2 gap-2 pb-1">
        <button
          type="button"
          onClick={onClearFilterBuffer}
          className="h-10 bg-[#242a3a] hover:bg-[#33394a] active:scale-95 transition text-[#dde2f8] rounded-lg font-stitch-headline text-[11px] font-bold uppercase flex items-center justify-center gap-1.5"
        >
          <Trash2 className="w-4 h-4 text-[#ffb95f]" />
          <span>Limpiar Búfer</span>
        </button>
        <button
          type="button"
          onClick={onRestartGnss}
          className="h-10 bg-[#4cd7f6] hover:bg-[#acedff] active:scale-95 transition text-[#003640] rounded-lg font-stitch-headline text-[11px] font-bold uppercase flex items-center justify-center gap-1.5 shadow-md"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Reiniciar GNSS</span>
        </button>
      </div>

      {/* Modal 1: Calibración en Punto Conocido (10 épocas reales) */}
      {showCalibModal && (
        <div className="fixed inset-0 z-50 bg-[#0d1322]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#191f2f] rounded-2xl p-4 shadow-2xl flex flex-col gap-3 border border-[#2f3445]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-[#4edea3]" />
                <h3 className="font-stitch-headline text-[14px] font-bold uppercase">
                  Calibración en 1 Punto (BM)
                </h3>
              </div>
              {!isCalibrating && (
                <button
                  type="button"
                  onClick={() => setShowCalibModal(false)}
                  className="w-7 h-7 rounded bg-[#242a3a] text-[#bcc9cd] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <p className="font-stitch-mono text-[10px] text-[#bcc9cd] leading-relaxed">
              Colócate exactamente sobre un vértice o BM conocido. Al pulsar calibrar, promediaremos{' '}
              {CAL_TARGET} lecturas GPS reales para corregir Este, Norte y Cota en toda la app.
            </p>

            <div className="grid grid-cols-2 gap-1 bg-[#080e1d] p-1 rounded-lg font-stitch-mono text-[10px]">
              <button
                type="button"
                disabled={isCalibrating}
                onClick={() => setCalibSource('vertex')}
                className={`py-1.5 rounded font-bold ${
                  calibSource === 'vertex' ? 'bg-[#4cd7f6] text-[#003640]' : 'text-[#bcc9cd]'
                }`}
              >
                Vértice Parcela
              </button>
              <button
                type="button"
                disabled={isCalibrating}
                onClick={() => setCalibSource('manual')}
                className={`py-1.5 rounded font-bold ${
                  calibSource === 'manual' ? 'bg-[#4cd7f6] text-[#003640]' : 'text-[#bcc9cd]'
                }`}
              >
                BM Manual ({crsMode.toUpperCase()})
              </button>
            </div>

            {calibSource === 'vertex' ? (
              <div className="space-y-2 font-stitch-mono text-[11px]">
                {parcels.length > 0 && selectedCalibParcel ? (
                  <>
                    <div>
                      <label className="text-[9.5px] text-[#869397] block mb-1">Parcela</label>
                      <select
                        disabled={isCalibrating}
                        value={selectedCalibParcel.id}
                        onChange={(e) => {
                          const p = parcels.find((x) => x.id === e.target.value);
                          setCalibParcelId(e.target.value);
                          setCalibVertexId(p?.vertices[0]?.id || '');
                        }}
                        className="w-full bg-[#080e1d] border border-[#242a3a] rounded-lg px-2.5 py-2 text-[#dde2f8]"
                      >
                        {parcels.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} ({p.vertices.length}V)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9.5px] text-[#869397] block mb-1">Vértice conocido</label>
                      <select
                        disabled={isCalibrating}
                        value={calibVertexId}
                        onChange={(e) => setCalibVertexId(e.target.value)}
                        className="w-full bg-[#080e1d] border border-[#242a3a] rounded-lg px-2.5 py-2 text-[#dde2f8]"
                      >
                        {selectedCalibParcel.vertices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.id} · E {(crsMode === 'regven' ? v.esteRegven : v.estePsad56).toFixed(2)} N{' '}
                            {(crsMode === 'regven' ? v.norteRegven : v.nortePsad56).toFixed(2)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <p className="text-[#ffb95f] text-[10px]">
                    Sin parcelas en este proyecto · Usa &quot;BM Manual&quot; para calibrar.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 font-stitch-mono text-[11px]">
                <div>
                  <label className="text-[9.5px] text-[#869397] block mb-1">Este conocido (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    disabled={isCalibrating}
                    value={manualE}
                    onChange={(e) => setManualE(e.target.value)}
                    placeholder="729500.000"
                    className="w-full bg-[#080e1d] border border-[#242a3a] rounded px-2 py-1.5 text-[#dde2f8]"
                  />
                </div>
                <div>
                  <label className="text-[9.5px] text-[#869397] block mb-1">Norte conocido (m)</label>
                  <input
                    type="number"
                    step="0.001"
                    disabled={isCalibrating}
                    value={manualN}
                    onChange={(e) => setManualN(e.target.value)}
                    placeholder="1159200.000"
                    className="w-full bg-[#080e1d] border border-[#242a3a] rounded px-2 py-1.5 text-[#dde2f8]"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[9.5px] text-[#869397] block mb-1">
                    Cota ortométrica conocida (opcional)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    disabled={isCalibrating}
                    value={manualZ}
                    onChange={(e) => setManualZ(e.target.value)}
                    placeholder="Opcional"
                    className="w-full bg-[#080e1d] border border-[#242a3a] rounded px-2 py-1.5 text-[#dde2f8]"
                  />
                </div>
              </div>
            )}

            {isCalibrating && (
              <div className="space-y-1.5">
                <div className="flex justify-between font-stitch-mono text-[10px] text-[#4edea3]">
                  <span>Promediando épocas GNSS reales...</span>
                  <span>
                    {calibSamples.length}/{CAL_TARGET}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-[#080e1d] overflow-hidden border border-[#242a3a]">
                  <div
                    className="h-full bg-[#4edea3] transition-all"
                    style={{ width: `${Math.round((calibSamples.length / CAL_TARGET) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              {isCalibrating ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCalibrating(false);
                      setCalibSamples([]);
                    }}
                    className="flex-1 h-10 rounded-lg bg-[#242a3a] font-stitch-headline text-[11px] font-bold uppercase"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={calibSamples.length === 0}
                    onClick={() => finalizeCalibration(calibSamples)}
                    className="flex-1 h-10 rounded-lg bg-[#4edea3] text-[#003824] font-stitch-headline text-[11px] font-bold uppercase disabled:opacity-45"
                  >
                    Aplicar ({calibSamples.length})
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={!hasLiveGps || !calibTargetCoords}
                  onClick={() => {
                    lastCalibTsRef.current = rawGnssFix.timestamp;
                    setCalibSamples([
                      {
                        lat: rawGnssFix.lat,
                        lng: rawGnssFix.lng,
                        alt: rawGnssFix.alt,
                        accuracy: rawGnssFix.accuracy || 3.5,
                        altitudeAccuracy: rawGnssFix.altitudeAccuracy ?? null,
                        esteRegven: rawGnssFix.esteRegven,
                        norteRegven: rawGnssFix.norteRegven,
                        speed: rawGnssFix.speed ?? null,
                        heading: rawGnssFix.heading ?? null,
                        timestamp: rawGnssFix.timestamp,
                      },
                    ]);
                    setIsCalibrating(true);
                  }}
                  className="w-full h-11 rounded-lg bg-[#4edea3] text-[#003824] font-stitch-headline text-[12px] font-bold uppercase flex items-center justify-center gap-1.5 disabled:opacity-45"
                >
                  <Check className="w-4 h-4" />
                  <span>{hasLiveGps ? 'Iniciar Calibración (10 épocas)' : 'Requiere señal GPS activa'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Ajuste fino de Shift ΔE/ΔN/ΔZ, Altura de Jalón y Geoide */}
      {showManualShiftModal && (
        <div className="fixed inset-0 z-50 bg-[#0d1322]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#191f2f] rounded-2xl p-4 shadow-2xl flex flex-col gap-3 border border-[#2f3445]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#4cd7f6]" />
                <h3 className="font-stitch-headline text-[14px] font-bold uppercase">
                  Parámetros de Corrección
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowManualShiftModal(false)}
                className="w-7 h-7 rounded bg-[#242a3a] text-[#bcc9cd] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 font-stitch-mono text-[11px]">
              <div>
                <label className="text-[9px] text-[#869397] block mb-1">Shift ΔE (m)</label>
                <input
                  type="number"
                  step="0.001"
                  value={draftShiftE}
                  onChange={(e) => setDraftShiftE(e.target.value)}
                  className="w-full bg-[#080e1d] border border-[#242a3a] rounded px-2 py-1.5 text-[#4cd7f6] font-bold"
                />
              </div>
              <div>
                <label className="text-[9px] text-[#869397] block mb-1">Shift ΔN (m)</label>
                <input
                  type="number"
                  step="0.001"
                  value={draftShiftN}
                  onChange={(e) => setDraftShiftN(e.target.value)}
                  className="w-full bg-[#080e1d] border border-[#242a3a] rounded px-2 py-1.5 text-[#4cd7f6] font-bold"
                />
              </div>
              <div>
                <label className="text-[9px] text-[#869397] block mb-1">Shift ΔZ (m)</label>
                <input
                  type="number"
                  step="0.001"
                  value={draftShiftZ}
                  onChange={(e) => setDraftShiftZ(e.target.value)}
                  className="w-full bg-[#080e1d] border border-[#242a3a] rounded px-2 py-1.5 text-[#4cd7f6] font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 font-stitch-mono text-[11px]">
              <div>
                <label className="text-[9px] text-[#869397] block mb-1">Altura Jalón h_ant (m)</label>
                <input
                  type="number"
                  step="0.01"
                  value={draftAntH}
                  onChange={(e) => setDraftAntH(e.target.value)}
                  className="w-full bg-[#080e1d] border border-[#242a3a] rounded px-2 py-1.5 text-[#dde2f8] font-bold"
                />
                <div className="flex gap-1 mt-1">
                  {[0, 1.8, 2.0].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDraftAntH(v.toFixed(3))}
                      className="flex-1 py-0.5 rounded bg-[#242a3a] text-[9px] text-[#4cd7f6]"
                    >
                      {v}m
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[9px] text-[#869397] block mb-1">Ondulación Geoide N (m)</label>
                <input
                  type="number"
                  step="0.05"
                  value={draftGeoidN}
                  onChange={(e) => setDraftGeoidN(e.target.value)}
                  className="w-full bg-[#080e1d] border border-[#242a3a] rounded px-2 py-1.5 text-[#dde2f8] font-bold"
                />
                <div className="flex gap-1 mt-1">
                  {[0, -22.45].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDraftGeoidN(v.toFixed(2))}
                      className="flex-1 py-0.5 rounded bg-[#242a3a] text-[9px] text-[#ffb95f]"
                    >
                      {v === 0 ? '0m' : '-22.45'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowManualShiftModal(false)}
                className="flex-1 h-10 rounded-lg bg-[#242a3a] font-stitch-headline text-[11px] font-bold uppercase"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveManualShift}
                className="flex-1 h-10 rounded-lg bg-[#4cd7f6] text-[#003640] font-stitch-headline text-[11px] font-bold uppercase"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
