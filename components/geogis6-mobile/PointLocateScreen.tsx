'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  Box,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flag,
  ListOrdered,
  MapPin,
  Navigation,
  Radar,
  Save,
  Sliders,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { formatAzimuthDms, type CrsMode, type FieldParcel, type LiveGnssFix } from './data/fieldData';

interface PointLocateScreenProps {
  parcel: FieldParcel | null;
  selectedVertexId: string;
  crsMode: CrsMode;
  gnssFix: LiveGnssFix;
  shiftEste: number;
  shiftNorte: number;
  onSelectVertex: (vertexId: string) => void;
  onApplyShift: (dE: number, dN: number) => void;
  onCaptureCurrentVertex: () => void;
  onOpenProjects: () => void;
  onNotify: (msg: string) => void;
}

export default function PointLocateScreen({
  parcel,
  selectedVertexId,
  crsMode,
  gnssFix,
  shiftEste,
  shiftNorte,
  onSelectVertex,
  onApplyShift,
  onCaptureCurrentVertex,
  onOpenProjects,
  onNotify,
}: PointLocateScreenProps) {
  const [viewMode, setViewMode] = useState<'radar' | 'ar'>('radar');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showPointsPicker, setShowPointsPicker] = useState(false);
  const [draftShiftE, setDraftShiftE] = useState(shiftEste.toFixed(3));
  const [draftShiftN, setDraftShiftN] = useState(shiftNorte.toFixed(3));
  const [epochCount, setEpochCount] = useState(15);
  const [capturing, setCapturing] = useState(false);
  const [storedPointNo, setStoredPointNo] = useState(104);
  const [captureBanner, setCaptureBanner] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const vertices = parcel?.vertices ?? [];
  const currentIdx = Math.max(
    0,
    vertices.findIndex((v) => v.id === selectedVertexId)
  );
  const target = vertices[currentIdx] || vertices[0] || null;

  // Try activating real rear camera when switching to AR mode on Android hardware
  useEffect(() => {
    if (viewMode !== 'ar') {
      setCameraActive(false);
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then((s) => {
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop());
            return;
          }
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
            void videoRef.current.play().catch(() => {});
          }
          setCameraActive(true);
        })
        .catch(() => {
          setCameraActive(false);
        });
    }
    return () => {
      cancelled = true;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [viewMode]);

  if (!parcel || !target) {
    return (
      <div className="flex flex-col w-full h-full items-center justify-center p-6 text-center bg-[#0d1322] text-[#dde2f8] gap-3">
        <Radar className="w-10 h-10 text-[#4cd7f6] opacity-75" />
        <h2 className="font-stitch-headline text-[16px] font-bold uppercase">
          Sin vértice para replanteo
        </h2>
        <p className="font-stitch-mono text-[11px] text-[#bcc9cd] max-w-xs leading-relaxed">
          Selecciona o crea un proyecto con al menos una parcela para iniciar la localización RTK.
        </p>
        {gnssFix.isLiveHardware && (
          <div className="bg-[#151b2b] border border-[#242a3a] rounded-xl px-4 py-2.5 font-stitch-mono text-[11px] text-[#4edea3]">
            GPS VIVO: {gnssFix.esteRegven.toFixed(2)}E · {gnssFix.norteRegven.toFixed(2)}N (±{gnssFix.accuracy.toFixed(1)}m)
          </div>
        )}
        <button
          type="button"
          onClick={onOpenProjects}
          className="px-4 py-2.5 rounded-lg bg-[#06b6d4] text-[#003640] font-stitch-headline text-xs font-bold uppercase"
        >
          Ir a Proyectos
        </button>
      </div>
    );
  }

  const rawNorth = gnssFix.isLiveHardware
    ? target.norteRegven - gnssFix.norteRegven
    : target.stakeNorthDelta;
  const rawEast = gnssFix.isLiveHardware
    ? target.esteRegven - gnssFix.esteRegven
    : target.stakeEastDelta;
  const adjustedNorth = rawNorth + shiftNorte;
  const adjustedEast = rawEast + shiftEste;
  const adjustedRadial = Math.hypot(adjustedNorth, adjustedEast);
  const inTolerance = adjustedRadial <= 0.05;
  const liveAz = formatAzimuthDms(adjustedEast, adjustedNorth);
  const displayAzDeg = gnssFix.isLiveHardware ? liveAz.degMin : target.stakeAzimuthDeg;
  const displayAzSec = gnssFix.isLiveHardware ? liveAz.sec : target.stakeAzimuthSec;
  const liveCutFill = gnssFix.isLiveHardware ? target.cota - gnssFix.alt : target.stakeCutFill;
  const roverPxX = gnssFix.isLiveHardware
    ? Math.max(-72, Math.min(72, Math.round(-adjustedEast * 24)))
    : target.roverOffsetX;
  const roverPxY = gnssFix.isLiveHardware
    ? Math.max(-72, Math.min(72, Math.round(adjustedNorth * 24)))
    : target.roverOffsetY;

  const handlePrev = () => {
    const nextIdx = (currentIdx - 1 + vertices.length) % vertices.length;
    onSelectVertex(vertices[nextIdx].id);
  };

  const handleNext = () => {
    const nextIdx = (currentIdx + 1) % vertices.length;
    onSelectVertex(vertices[nextIdx].id);
  };

  const handleCapturePoint = () => {
    if (capturing) return;
    setCapturing(true);
    setEpochCount(3);
    setTimeout(() => setEpochCount(9), 260);
    setTimeout(() => setEpochCount(15), 540);
    setTimeout(() => {
      setCapturing(false);
      setStoredPointNo((n) => n + 1);
      onCaptureCurrentVertex();
      setCaptureBanner(`¡${target.id} Calibrado & Almacenado!`);
      setTimeout(() => setCaptureBanner(null), 2400);
    }, 680);
  };

  const handleSaveShift = () => {
    const eVal = Number.parseFloat(draftShiftE);
    const nVal = Number.parseFloat(draftShiftN);
    const safeE = Number.isFinite(eVal) ? eVal : 0;
    const safeN = Number.isFinite(nVal) ? nVal : 0;
    onApplyShift(safeE, safeN);
    setShowShiftModal(false);
    onNotify(
      `Shift aplicado: ΔE ${safeE >= 0 ? '+' : ''}${safeE.toFixed(3)}m · ΔN ${safeN >= 0 ? '+' : ''}${safeN.toFixed(3)}m`
    );
  };

  return (
    <div className="flex flex-col w-full h-full overflow-y-auto no-scrollbar text-[#dde2f8] bg-[#0d1322] select-none pb-3 relative">
      {/* Section 1: Telemetry & Epoch Calibration Ribbon */}
      <section className="px-3 pt-2 flex flex-col gap-1.5">
        <div className="bg-[#151b2b] rounded-xl px-3 py-2 flex items-center justify-between shadow-sm border border-[#242a3a]">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-[#00a572]/30 px-2 py-0.5 rounded text-[#4edea3]">
              <span className="w-2 h-2 rounded-full bg-[#4edea3] animate-ping" />
              <span className="font-stitch-headline text-[11px] font-bold tracking-wider text-[#4edea3]">
                {gnssFix.isLiveHardware ? 'GNSS LIVE' : 'FIXED'}
              </span>
            </div>
            <span className="font-stitch-mono text-[10.5px] text-[#bcc9cd]">
              EDAD: <strong className="text-[#dde2f8]">1.0s</strong>
            </span>
          </div>

          <div className="flex items-center gap-2.5 font-stitch-mono text-[10.5px]">
            <div className="flex items-center gap-0.5">
              <span className="text-[#bcc9cd]">H:</span>
              <span className="text-[#4edea3] font-semibold">
                {gnssFix.isLiveHardware ? `${gnssFix.accuracy.toFixed(2)}m` : '0.007m'}
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <span className="text-[#bcc9cd]">V:</span>
              <span className="text-[#4edea3] font-semibold">0.012m</span>
            </div>
            <div className="flex items-center gap-0.5 bg-[#191f2f] px-1.5 py-0.5 rounded text-[#4cd7f6]">
              <span className="text-[#bcc9cd]">PDOP:</span>
              <span className="font-semibold">1.1</span>
            </div>
          </div>
        </div>

        <div className="bg-[#191f2f] rounded-xl p-2 flex items-center justify-between shadow-sm gap-2 border border-[#242a3a]">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 truncate">
                <Sliders className="w-3.5 h-3.5 text-[#ffb95f] shrink-0" />
                <span className="font-stitch-headline text-[11.5px] font-bold text-[#dde2f8] truncate">
                  Calibración Épocas: {epochCount}/15
                </span>
              </div>
              <span className="font-stitch-mono text-[10px] text-[#4edea3] bg-[#242a3a] px-1.5 py-0.5 rounded font-medium">
                {capturing ? 'Promediando...' : 'Ponderado OK'}
              </span>
            </div>
            <div className="w-full h-1.5 bg-[#2f3445] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#ffb95f] to-[#4edea3] transition-all duration-300"
                style={{ width: `${Math.round((epochCount / 15) * 100)}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setDraftShiftE(shiftEste.toFixed(3));
              setDraftShiftN(shiftNorte.toFixed(3));
              setShowShiftModal(true);
            }}
            className="h-10 px-2.5 bg-[#242a3a] hover:bg-[#33394a] text-[#4cd7f6] flex items-center gap-1 rounded transition-colors whitespace-nowrap shadow-sm"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="font-stitch-headline text-[11px] font-bold uppercase">Shift ΔE ΔN</span>
          </button>
        </div>
      </section>

      {/* Section 2: Directional Stakeout HUD Banner */}
      <section className="px-3 pt-2">
        <div className="bg-[#151b2b] rounded-xl p-2.5 shadow-md flex flex-col gap-2 border border-[#242a3a]">
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded bg-[#06b6d4] text-[#003640] flex items-center justify-center font-stitch-headline font-bold text-[12px] shrink-0">
                {target.shortId}
              </span>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-stitch-headline text-[17px] font-semibold tracking-tight leading-none">
                    {target.id}
                  </span>
                  <span className="font-stitch-mono text-[10px] bg-[#2f3445] px-1.5 py-0.5 rounded text-[#bcc9cd] truncate">
                    Parcela {parcel.code}
                  </span>
                </div>
                <span className="font-stitch-mono text-[10px] text-[#bcc9cd] truncate mt-0.5">
                  {target.code} · {crsMode === 'regven' ? `REGVEN UTM ${parcel.huso}N` : `PSAD56 UTM ${parcel.huso}N`}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end shrink-0 pl-2">
              <span className="font-stitch-mono text-[9.5px] text-[#4cd7f6] uppercase tracking-wider font-semibold">
                Dist. Radial
              </span>
              <span
                className={`font-stitch-headline text-[24px] leading-tight font-bold tracking-tight ${
                  inTolerance ? 'text-[#4edea3]' : 'text-[#4cd7f6]'
                }`}
              >
                {adjustedRadial.toFixed(3)}{' '}
                <span className="font-stitch-mono text-[11px] text-[#bcc9cd]">m</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 pt-0.5">
            <div className="bg-[#191f2f] p-2 rounded flex flex-col items-center justify-center text-center">
              <div className="flex items-center gap-0.5 text-[#4cd7f6]">
                <ArrowUp className="w-3.5 h-3.5" />
                <span className="font-stitch-mono text-[10px] uppercase font-bold">
                  {adjustedNorth >= 0 ? 'Norte' : 'Sur'}
                </span>
              </div>
              <span className="font-stitch-mono text-[15px] text-[#dde2f8] font-bold tracking-tight mt-0.5">
                {Math.abs(adjustedNorth).toFixed(3)}
              </span>
              <span className="font-stitch-mono text-[9.5px] text-[#bcc9cd]">m</span>
            </div>

            <div className="bg-[#191f2f] p-2 rounded flex flex-col items-center justify-center text-center">
              <div className="flex items-center gap-0.5 text-[#4cd7f6]">
                <ArrowRight className="w-3.5 h-3.5" />
                <span className="font-stitch-mono text-[10px] uppercase font-bold">
                  {adjustedEast >= 0 ? 'Este' : 'Oeste'}
                </span>
              </div>
              <span className="font-stitch-mono text-[15px] text-[#dde2f8] font-bold tracking-tight mt-0.5">
                {Math.abs(adjustedEast).toFixed(3)}
              </span>
              <span className="font-stitch-mono text-[9.5px] text-[#bcc9cd]">m</span>
            </div>

            <div className="bg-[#191f2f] p-2 rounded flex flex-col items-center justify-center text-center">
              <div className="flex items-center gap-0.5 text-[#ffb95f]">
                <Compass className="w-3.5 h-3.5" />
                <span className="font-stitch-mono text-[10px] uppercase font-bold">Azimut</span>
              </div>
              <span className="font-stitch-mono text-[13px] text-[#dde2f8] font-bold tracking-tight mt-1 truncate max-w-full">
                {displayAzDeg}
              </span>
              <span className="font-stitch-mono text-[9.5px] text-[#bcc9cd]">{displayAzSec}</span>
            </div>

            <div className="bg-[#191f2f] p-2 rounded flex flex-col items-center justify-center text-center">
              <div className="flex items-center gap-0.5 text-[#4edea3]">
                <ArrowDownToLine className="w-3.5 h-3.5" />
                <span className="font-stitch-mono text-[10px] uppercase font-bold">
                  {liveCutFill < 0 ? 'Corte' : 'Relleno'}
                </span>
              </div>
              <span className="font-stitch-mono text-[15px] text-[#4edea3] font-bold tracking-tight mt-0.5">
                {liveCutFill >= 0 ? '+' : ''}
                {liveCutFill.toFixed(3)}
              </span>
              <span className="font-stitch-mono text-[9.5px] text-[#bcc9cd]">m</span>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Central Precision Bullseye & AR Viewfinder Canvas */}
      <section className="px-3 pt-2 flex-1 flex flex-col min-h-[280px] relative">
        <div className="relative w-full h-[280px] bg-[#080e1d] rounded-xl overflow-hidden shadow-inner flex items-center justify-center border border-[#242a3a]">
          <div className="absolute top-2 inset-x-2 z-20 flex items-center justify-between">
            <div className="flex items-center gap-2 bg-[#191f2f]/90 backdrop-blur-md px-2.5 py-1 rounded-full shadow-md border border-[#2f3445]">
              <div className="relative w-6 h-6 rounded-full bg-[#2f3445] flex items-center justify-center overflow-hidden">
                <div className="absolute w-4 h-4 rounded-full border border-[#3d494c]" />
                <div className="absolute w-1.5 h-1.5 rounded-full bg-[#4edea3] translate-x-[2px] translate-y-[-1px] animate-pulse" />
              </div>
              <div className="flex flex-col">
                <span className="font-stitch-mono text-[8.5px] text-[#bcc9cd] leading-none">INCLINACIÓN</span>
                <span className="font-stitch-mono text-[10px] text-[#4edea3] font-bold leading-tight">
                  0.5° OK
                </span>
              </div>
            </div>

            <div className="flex items-center bg-[#151b2b] p-0.5 rounded-full shadow-md border border-[#242a3a]">
              <button
                type="button"
                onClick={() => setViewMode('radar')}
                className={`px-2.5 py-1 rounded-full font-stitch-headline text-[11px] flex items-center gap-1 transition-all ${
                  viewMode === 'radar'
                    ? 'bg-[#06b6d4] text-[#003640] font-bold'
                    : 'text-[#bcc9cd]'
                }`}
              >
                <Radar className="w-3.5 h-3.5" />
                Radar
              </button>
              <button
                type="button"
                onClick={() => setViewMode('ar')}
                className={`px-2.5 py-1 rounded-full font-stitch-headline text-[11px] flex items-center gap-1 transition-all ${
                  viewMode === 'ar'
                    ? 'bg-[#06b6d4] text-[#003640] font-bold'
                    : 'text-[#bcc9cd]'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                Cámara AR
              </button>
            </div>
          </div>

          {viewMode === 'radar' ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="absolute inset-0 w-full h-full opacity-15 pointer-events-none">
                <defs>
                  <pattern height="30" id="prod-radar-grid" patternUnits="userSpaceOnUse" width="30">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#869397" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect fill="url(#prod-radar-grid)" height="100%" width="100%" />
              </svg>

              <div className="relative w-56 h-56 flex items-center justify-center mt-4">
                <div className="absolute w-56 h-56 rounded-full border border-dashed border-[#3d494c] flex items-center justify-center">
                  <span className="absolute top-1 text-[#bcc9cd] font-stitch-mono text-[9.5px]">1.00 m</span>
                </div>
                <div className="absolute w-32 h-32 rounded-full border border-[#3d494c] flex items-center justify-center bg-[#242a3a]/20">
                  <span className="absolute top-1 text-[#bcc9cd] font-stitch-mono text-[8.5px]">0.20 m</span>
                </div>
                <div className="absolute w-14 h-14 rounded-full bg-[#4edea3]/15 flex items-center justify-center animate-pulse">
                  <div className="w-9 h-9 rounded-full border border-[#4edea3] flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#4edea3]" />
                  </div>
                  <span className="absolute bottom-0.5 text-[#4edea3] font-stitch-mono text-[7.5px] font-bold">
                    0.05m
                  </span>
                </div>

                <div className="absolute inset-x-0 h-[1px] bg-[#3d494c]/45" />
                <div className="absolute inset-y-0 w-[1px] bg-[#3d494c]/45" />

                <span className="absolute top-1.5 font-stitch-headline text-[11px] text-[#4cd7f6] font-bold">N</span>
                <span className="absolute right-2 font-stitch-headline text-[11px] text-[#bcc9cd]">E</span>
                <span className="absolute bottom-1.5 font-stitch-headline text-[11px] text-[#bcc9cd]">S</span>
                <span className="absolute left-2 font-stitch-headline text-[11px] text-[#bcc9cd]">W</span>

                <div className="absolute z-10 flex flex-col items-center pointer-events-none">
                  <div className="w-5 h-5 rounded-full bg-[#ffb4ab] flex items-center justify-center text-[#690005] shadow-md">
                    <Flag className="w-3 h-3" />
                  </div>
                  <span className="bg-[#080e1d] px-1 rounded font-stitch-mono text-[9.5px] text-[#ffb4ab] font-bold mt-0.5">
                    {target.id}
                  </span>
                </div>

                <div
                  className="absolute z-10 flex flex-col items-center transition-all duration-300"
                  style={{
                    transform: `translate(${roverPxX}px, ${roverPxY}px)`,
                  }}
                >
                  <div className="w-7 h-7 rounded-full bg-[#4cd7f6]/20 flex items-center justify-center shadow-lg">
                    <div className="w-4 h-4 rounded-full bg-[#4cd7f6] flex items-center justify-center text-[#003640]">
                      <Navigation className="w-2.5 h-2.5 rotate-45" />
                    </div>
                  </div>
                  <span className="bg-[#242a3a] px-1.5 py-0.5 rounded text-[#dde2f8] font-stitch-mono text-[9px] whitespace-nowrap mt-0.5 shadow font-bold">
                    ROVER ({adjustedRadial.toFixed(2)}m)
                  </span>
                </div>
              </div>

              <div className="absolute bottom-2 left-2.5 bg-[#191f2f]/85 backdrop-blur px-2 py-0.5 rounded text-[#bcc9cd] font-stitch-mono text-[9.5px]">
                Escala Radar: 1 cm = 0.25 m
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 stitch-ar-grid flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`absolute inset-0 w-full h-full object-cover transition-opacity ${
                  cameraActive ? 'opacity-80' : 'opacity-0 pointer-events-none'
                }`}
              />
              <svg className="absolute inset-0 w-full h-full opacity-35 pointer-events-none" viewBox="0 0 380 280" preserveAspectRatio="none">
                <line x1="0" y1="132" x2="380" y2="132" stroke="#4cd7f6" strokeOpacity="0.45" strokeWidth="1" />
                <line x1="190" y1="132" x2="10" y2="280" stroke="#4cd7f6" strokeOpacity="0.4" strokeWidth="0.9" />
                <line x1="190" y1="132" x2="110" y2="280" stroke="#4cd7f6" strokeOpacity="0.4" strokeWidth="0.9" />
                <line x1="190" y1="132" x2="270" y2="280" stroke="#4cd7f6" strokeOpacity="0.4" strokeWidth="0.9" />
                <line x1="190" y1="132" x2="370" y2="280" stroke="#4cd7f6" strokeOpacity="0.4" strokeWidth="0.9" />
                <line x1="65" y1="170" x2="315" y2="170" stroke="#4cd7f6" strokeOpacity="0.3" strokeWidth="0.8" />
                <line x1="30" y1="212" x2="350" y2="212" stroke="#4cd7f6" strokeOpacity="0.3" strokeWidth="0.8" />
              </svg>

              <div className="relative z-10 flex flex-col items-center mt-6">
                <div className="bg-[#4cd7f6] px-2.5 py-1 rounded text-[#003640] font-stitch-headline text-[14px] font-bold shadow-lg animate-bounce flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  HITO {target.id} ({adjustedRadial.toFixed(2)}m)
                </div>
                <div className="w-1 h-24 bg-gradient-to-b from-[#4cd7f6] via-[#06b6d4] to-[#4edea3]" />
                <div className="w-24 h-9 rounded-full border-2 border-[#4edea3] bg-[#4edea3]/20 -mt-2 animate-pulse flex items-center justify-center">
                  <span className="font-stitch-mono text-[10px] text-[#4edea3] font-bold">
                    {target.stakeCutFill >= 0 ? '+' : ''}
                    {target.stakeCutFill.toFixed(2)}m H
                  </span>
                </div>
              </div>

              <div className="absolute inset-x-6 top-14 flex items-center justify-between text-[#4cd7f6] opacity-85 pointer-events-none">
                <div className="w-10 h-0.5 bg-[#4cd7f6]" />
                <span className="font-stitch-mono text-[10px] bg-[#0d1322]/80 px-2 py-0.5 rounded">
                  {cameraActive ? 'AR LIVE CAM · +1.2°' : 'AR HUD · +1.2°'}
                </span>
                <div className="w-10 h-0.5 bg-[#4cd7f6]" />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Section 4: Field Survey Stakeout Controls */}
      <section className="px-3 pt-2.5 flex flex-col gap-2">
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={handlePrev}
            className="h-11 bg-[#191f2f] hover:bg-[#242a3a] text-[#dde2f8] rounded flex items-center justify-center gap-0.5 font-stitch-headline text-[11px] font-bold shadow-sm border border-[#242a3a]"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="truncate">Anterior</span>
          </button>

          <button
            type="button"
            onClick={handleNext}
            className="h-11 bg-[#191f2f] hover:bg-[#242a3a] text-[#dde2f8] rounded flex items-center justify-center gap-0.5 font-stitch-headline text-[11px] font-bold shadow-sm border border-[#242a3a]"
          >
            <span className="truncate">Siguiente</span>
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowPointsPicker(true)}
            className="h-11 bg-[#191f2f] hover:bg-[#242a3a] text-[#4cd7f6] rounded flex items-center justify-center gap-1 font-stitch-headline text-[11px] font-bold shadow-sm border border-[#242a3a]"
          >
            <ListOrdered className="w-4 h-4" />
            <span>Puntos</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setViewMode('ar');
              onNotify(`Foto EXIF UTM guardada · ${target.id} (${parcel.code})`);
            }}
            className="h-11 bg-[#191f2f] hover:bg-[#242a3a] text-[#ffb95f] rounded flex items-center justify-center gap-1 font-stitch-headline text-[11px] font-bold shadow-sm border border-[#242a3a]"
          >
            <Camera className="w-4 h-4" />
            <span className="truncate">Foto Hito</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleCapturePoint}
          className="w-full h-14 bg-[#4edea3] hover:bg-[#6ffbbe] active:scale-[0.98] text-[#003824] rounded-xl flex items-center justify-between px-3.5 shadow-lg transition-all"
        >
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-[#003824]/15 flex items-center justify-center">
              <Save className="w-5 h-5" />
            </div>
            <div className="flex flex-col text-left">
              <span className="font-stitch-headline text-[15px] tracking-tight leading-none uppercase font-bold text-[#003824]">
                {capturing ? 'Midiendo Épocas...' : 'Capturar Punto [F1]'}
              </span>
              <span className="font-stitch-mono text-[10px] text-[#003824]/80 font-medium leading-tight mt-0.5">
                Promediar 15 épocas RTK fijas
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end bg-[#003824]/10 px-2 py-1 rounded">
            <span className="font-stitch-mono text-[9px] uppercase font-bold text-[#003824]">RMS 3D</span>
            <span className="font-stitch-mono text-[14px] font-bold text-[#003824] leading-none">
              0.014 m
            </span>
          </div>
        </button>
      </section>

      {captureBanner && (
        <div className="absolute bottom-3 inset-x-3 z-40 bg-[#4edea3] text-[#003824] p-3 rounded-xl shadow-2xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <div className="flex flex-col">
              <span className="font-stitch-headline text-[14px] leading-none font-bold">{captureBanner}</span>
              <span className="font-stitch-mono text-[10px] text-[#003824]/90 mt-0.5">
                RMS H: 0.007m | ΔE: {shiftEste.toFixed(3)}m ΔN: {shiftNorte.toFixed(3)}m
              </span>
            </div>
          </div>
          <span className="font-stitch-mono text-[10.5px] bg-[#003824]/20 px-2 py-1 rounded font-bold">
            N° {storedPointNo}
          </span>
        </div>
      )}

      {/* Calibration Shift Modal */}
      {showShiftModal && (
        <div className="absolute inset-0 z-50 bg-[#0d1322]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full bg-[#191f2f] rounded-xl p-4 shadow-2xl flex flex-col gap-3 border border-[#2f3445]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-[#4cd7f6]" />
                <h2 className="font-stitch-headline text-[16px] font-semibold">
                  Calibración de Punto Base / Shift
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowShiftModal(false)}
                className="w-8 h-8 rounded bg-[#242a3a] text-[#bcc9cd] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[12.5px] text-[#bcc9cd]">
              Ajuste los desfases de traslación horizontal con respecto al marco local ({crsMode === 'regven' ? 'REGVEN 19N' : 'PSAD56 19N'}).
            </p>
            <div className="grid grid-cols-2 gap-2 font-stitch-mono">
              <div className="bg-[#151b2b] p-2 rounded flex flex-col gap-1 border border-[#242a3a]">
                <span className="text-[#bcc9cd] text-[10px]">Shift Δ Este (X)</span>
                <div className="flex items-center justify-between gap-1">
                  <input
                    value={draftShiftE}
                    onChange={(e) => setDraftShiftE(e.target.value)}
                    className="w-full bg-[#080e1d] text-[#4cd7f6] font-bold text-[13px] px-1.5 py-1 rounded outline-none"
                  />
                  <Check className="w-4 h-4 text-[#4edea3] shrink-0" />
                </div>
              </div>
              <div className="bg-[#151b2b] p-2 rounded flex flex-col gap-1 border border-[#242a3a]">
                <span className="text-[#bcc9cd] text-[10px]">Shift Δ Norte (Y)</span>
                <div className="flex items-center justify-between gap-1">
                  <input
                    value={draftShiftN}
                    onChange={(e) => setDraftShiftN(e.target.value)}
                    className="w-full bg-[#080e1d] text-[#4cd7f6] font-bold text-[13px] px-1.5 py-1 rounded outline-none"
                  />
                  <Check className="w-4 h-4 text-[#4edea3] shrink-0" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowShiftModal(false)}
                className="flex-1 h-10 bg-[#242a3a] text-[#dde2f8] font-stitch-headline text-[12px] font-bold rounded uppercase"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveShift}
                className="flex-1 h-10 bg-[#4cd7f6] text-[#003640] font-stitch-headline text-[12px] rounded uppercase font-bold"
              >
                Aplicar Corrección
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Vertex Picker Dialog */}
      {showPointsPicker && (
        <div className="absolute inset-0 z-50 bg-[#0d1322]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full bg-[#191f2f] rounded-xl p-4 shadow-2xl flex flex-col gap-2.5 border border-[#2f3445]">
            <div className="flex items-center justify-between">
              <span className="font-stitch-headline text-[15px] font-semibold">
                Vértices · Parcela {parcel.code}
              </span>
              <button
                type="button"
                onClick={() => setShowPointsPicker(false)}
                className="w-7 h-7 rounded bg-[#242a3a] text-[#bcc9cd] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto no-scrollbar">
              {vertices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    onSelectVertex(v.id);
                    setShowPointsPicker(false);
                  }}
                  className={`p-2.5 rounded-lg flex items-center justify-between text-left transition-colors ${
                    v.id === target.id
                      ? 'bg-[#242a3a] border border-[#4cd7f6]/60'
                      : 'bg-[#080e1d] hover:bg-[#151b2b]'
                  }`}
                >
                  <div>
                    <span className="font-stitch-mono text-[12px] font-bold text-[#4cd7f6]">{v.id}</span>
                    <span className="font-stitch-mono text-[11px] text-[#ffb95f] ml-2">{v.code}</span>
                    <div className="font-stitch-mono text-[9.5px] text-[#bcc9cd]">
                      Dist. estimada: {v.stakeDist.toFixed(3)} m · Az {v.stakeAzimuthDeg}
                    </div>
                  </div>
                  <span className="font-stitch-mono text-[10px] text-[#4edea3] font-bold">
                    {v.id === target.id ? 'ACTIVO' : 'SELECCIONAR'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
