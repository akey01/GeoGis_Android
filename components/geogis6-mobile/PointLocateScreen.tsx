'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BellOff,
  Box,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  ListOrdered,
  MapPin,
  PlusCircle,
  Radar,
  RotateCcw,
  Save,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  formatAzimuthDms,
  formatCoord,
  type CrsMode,
  type FieldParcel,
  type LiveGnssFix,
} from './data/fieldData';
import {
  computeWeightedGnssAverage,
  formatFieldDistance,
  getDirectionGuidance,
  normalizeAngle360,
  useDeviceCompass,
  type GnssSampleInput,
} from '@/lib/mobileCompass';
import StakeoutRadar, { type RadarOrientationMode } from './StakeoutRadar';

interface PointLocateScreenProps {
  parcel: FieldParcel | null;
  selectedVertexId: string;
  crsMode: CrsMode;
  gnssFix: LiveGnssFix;
  shiftEste: number;
  shiftNorte: number;
  onSelectVertex: (vertexId: string) => void;
  onApplyShift: (dE: number, dN: number) => void;
  onCaptureCurrentVertex: (averagedFix?: Partial<LiveGnssFix>) => void;
  onAddVertexFromGps?: (averagedFix?: Partial<LiveGnssFix>) => void;
  onOpenProjects: () => void;
  onNotify: (msg: string) => void;
}

const TARGET_AVG_SAMPLES = 5;

function getStakedStorageKey(parcelId: string): string {
  return `geogis6_staked_vertices_v1_${parcelId}`;
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
  onAddVertexFromGps,
  onOpenProjects,
  onNotify,
}: PointLocateScreenProps) {
  const [viewMode, setViewMode] = useState<'radar' | 'ar'>('radar');
  // Radar inicia por defecto en Norte Arriba
  const [orientationMode, setOrientationMode] = useState<RadarOrientationMode>('north_up');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showPointsPicker, setShowPointsPicker] = useState(false);
  const [sortByNearest, setSortByNearest] = useState(false);
  const [draftShiftE, setDraftShiftE] = useState(shiftEste.toFixed(3));
  const [draftShiftN, setDraftShiftN] = useState(shiftNorte.toFixed(3));
  const [vibrateEnabled, setVibrateEnabled] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const [stakedIds, setStakedIds] = useState<string[]>([]);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  // Estado para promediado real de muestras GPS
  const [isAveraging, setIsAveraging] = useState(false);
  const [avgSamples, setAvgSamples] = useState<GnssSampleInput[]>([]);
  const lastSampleTsRef = useRef<number>(0);
  const prevDistRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const compass = useDeviceCompass(gnssFix);

  // Ticker de 1 segundo para calcular la edad real de la última lectura GPS
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Cargar hitos marcados como localizados para esta parcela
  useEffect(() => {
    if (!parcel || typeof window === 'undefined') {
      setStakedIds([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(getStakedStorageKey(parcel.id));
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setStakedIds(arr.map(String));
          return;
        }
      }
    } catch {
      // ignore
    }
    setStakedIds([]);
  }, [parcel?.id]);

  const persistStakedIds = (parcelId: string, next: string[]) => {
    setStakedIds(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(getStakedStorageKey(parcelId), JSON.stringify(next));
      } catch {
        // ignore
      }
    }
  };

  // Activar cámara trasera real en modo AR
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

  const vertices = parcel?.vertices ?? [];
  const currentIdx = Math.max(
    0,
    vertices.findIndex((v) => v.id === selectedVertexId),
  );
  const target = vertices[currentIdx] || vertices[0] || null;

  // Recolectar lecturas GPS reales mientras el promediado está activo
  useEffect(() => {
    if (!isAveraging || !gnssFix.isLiveHardware) return;
    if (gnssFix.timestamp === lastSampleTsRef.current) return;
    lastSampleTsRef.current = gnssFix.timestamp;

    setAvgSamples((prev) => {
      const next = [
        ...prev,
        {
          lat: gnssFix.lat,
          lng: gnssFix.lng,
          alt: gnssFix.alt,
          accuracy: gnssFix.accuracy || 3.5,
          esteRegven: gnssFix.esteRegven,
          norteRegven: gnssFix.norteRegven,
        },
      ];
      return next.slice(0, TARGET_AVG_SAMPLES);
    });
  }, [
    isAveraging,
    gnssFix.isLiveHardware,
    gnssFix.timestamp,
    gnssFix.lat,
    gnssFix.lng,
    gnssFix.alt,
    gnssFix.accuracy,
    gnssFix.esteRegven,
    gnssFix.norteRegven,
  ]);

  // Finalizar captura automáticamente al completar TARGET_AVG_SAMPLES lecturas frescas
  useEffect(() => {
    if (!isAveraging || avgSamples.length < TARGET_AVG_SAMPLES || !target || !parcel) return;
    const averaged = computeWeightedGnssAverage(avgSamples);
    setIsAveraging(false);
    setAvgSamples([]);
    onCaptureCurrentVertex({
      lat: averaged.lat,
      lng: averaged.lng,
      alt: averaged.alt,
      accuracy: averaged.accuracy,
      esteRegven: averaged.esteRegven,
      norteRegven: averaged.norteRegven,
      isLiveHardware: true,
      timestamp: Date.now(),
    });
    if (!stakedIds.includes(target.id)) {
      persistStakedIds(parcel.id, [...stakedIds, target.id]);
    }
    onNotify(
      `¡${target.id} actualizado con ${averaged.sampleCount} lecturas (±${averaged.accuracy.toFixed(2)}m)!`,
    );
  }, [avgSamples, isAveraging, onCaptureCurrentVertex, onNotify, parcel, stakedIds, target]);

  // Cálculos reales en vivo hacia el vértice seleccionado
  const hasLiveGps = Boolean(gnssFix.isLiveHardware);
  const deltaNorthM =
    hasLiveGps && target ? target.norteRegven - gnssFix.norteRegven + shiftNorte : null;
  const deltaEastM =
    hasLiveGps && target ? target.esteRegven - gnssFix.esteRegven + shiftEste : null;
  const distanceM =
    deltaNorthM !== null && deltaEastM !== null ? Math.hypot(deltaNorthM, deltaEastM) : null;
  const targetAzimuthDeg =
    deltaNorthM !== null && deltaEastM !== null
      ? normalizeAngle360((Math.atan2(deltaEastM, deltaNorthM) * 180) / Math.PI)
      : null;
  const azInfo =
    deltaNorthM !== null && deltaEastM !== null
      ? formatAzimuthDms(deltaEastM, deltaNorthM)
      : null;
  const guidance =
    distanceM !== null && targetAzimuthDeg !== null
      ? getDirectionGuidance(distanceM, targetAzimuthDeg, compass.headingDeg, 2.0)
      : null;
  const cutFillM = hasLiveGps && target ? target.cota - gnssFix.alt : null;
  const gpsAgeSec = hasLiveGps
    ? Math.max(0, Math.round((nowTick - gnssFix.timestamp) / 1000))
    : null;

  // Vibración discreta al entrar en zona de llegada (<= 2.5 m)
  useEffect(() => {
    if (distanceM === null) {
      prevDistRef.current = null;
      return;
    }
    const prev = prevDistRef.current;
    prevDistRef.current = distanceM;
    if (vibrateEnabled && prev !== null && prev > 2.5 && distanceM <= 2.5) {
      try {
        navigator.vibrate?.([120, 60, 120]);
      } catch {
        // ignore if unsupported
      }
    }
  }, [distanceM, vibrateEnabled]);

  const sortedVertices = useMemo(() => {
    if (!sortByNearest || !hasLiveGps) return vertices;
    return [...vertices].sort((a, b) => {
      const da = Math.hypot(
        a.norteRegven - gnssFix.norteRegven + shiftNorte,
        a.esteRegven - gnssFix.esteRegven + shiftEste,
      );
      const db = Math.hypot(
        b.norteRegven - gnssFix.norteRegven + shiftNorte,
        b.esteRegven - gnssFix.esteRegven + shiftEste,
      );
      return da - db;
    });
  }, [
    gnssFix.esteRegven,
    gnssFix.norteRegven,
    hasLiveGps,
    shiftEste,
    shiftNorte,
    sortByNearest,
    vertices,
  ]);

  if (!parcel || !target) {
    return (
      <div className="flex flex-col w-full h-full items-center justify-center p-6 text-center bg-[#0d1322] text-[#dde2f8] gap-3">
        <Radar className="w-10 h-10 text-[#4cd7f6] opacity-75" />
        <h2 className="font-stitch-headline text-[16px] font-bold uppercase">
          Sin vértice para replanteo
        </h2>
        <p className="font-stitch-mono text-[11px] text-[#bcc9cd] max-w-xs leading-relaxed">
          Selecciona o crea un proyecto con al menos una parcela para iniciar la localización en campo.
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

  const isTargetStaked = stakedIds.includes(target.id);
  const hasActiveShift = Math.abs(shiftEste) > 0.0001 || Math.abs(shiftNorte) > 0.0001;

  const handleToggleStaked = (vertexId: string) => {
    const exists = stakedIds.includes(vertexId);
    const next = exists
      ? stakedIds.filter((x) => x !== vertexId)
      : [...stakedIds, vertexId];
    persistStakedIds(parcel.id, next);
    onNotify(exists ? `${vertexId} desmarcado` : `${vertexId} marcado como localizado`);
  };

  const handlePrev = () => {
    const nextIdx = (currentIdx - 1 + vertices.length) % vertices.length;
    onSelectVertex(vertices[nextIdx].id);
  };

  const handleNext = () => {
    const nextIdx = (currentIdx + 1) % vertices.length;
    onSelectVertex(vertices[nextIdx].id);
  };

  const handleStartOrFinishCapture = () => {
    if (!hasLiveGps) {
      onNotify('Esperando señal GPS real del dispositivo...');
      return;
    }

    if (isAveraging) {
      if (avgSamples.length === 0) {
        setIsAveraging(false);
        return;
      }
      const averaged = computeWeightedGnssAverage(avgSamples);
      setIsAveraging(false);
      setAvgSamples([]);
      onCaptureCurrentVertex({
        lat: averaged.lat,
        lng: averaged.lng,
        alt: averaged.alt,
        accuracy: averaged.accuracy,
        esteRegven: averaged.esteRegven,
        norteRegven: averaged.norteRegven,
        isLiveHardware: true,
        timestamp: Date.now(),
      });
      if (!stakedIds.includes(target.id)) {
        persistStakedIds(parcel.id, [...stakedIds, target.id]);
      }
      onNotify(
        `${target.id} guardado con ${averaged.sampleCount} lectura(s) (±${averaged.accuracy.toFixed(2)}m)`,
      );
      return;
    }

    // Inicia recolección de muestras frescas reales comenzando por la lectura actual
    lastSampleTsRef.current = gnssFix.timestamp;
    setAvgSamples([
      {
        lat: gnssFix.lat,
        lng: gnssFix.lng,
        alt: gnssFix.alt,
        accuracy: gnssFix.accuracy || 3.5,
        esteRegven: gnssFix.esteRegven,
        norteRegven: gnssFix.norteRegven,
      },
    ]);
    setIsAveraging(true);
    onNotify(`Capturando lecturas GPS para ${target.id} (1/${TARGET_AVG_SAMPLES})...`);
  };

  const handleCapturePhoto = () => {
    if (viewMode !== 'ar') {
      setViewMode('ar');
      onNotify('Cámara AR activada · Pulsa "Foto Hito" para capturar con coordenadas');
      return;
    }

    const video = videoRef.current;
    if (!video || video.readyState < 2 || !cameraActive) {
      onNotify('Cámara trasera no disponible en este dispositivo');
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);

    // Franja inferior con sello topográfico real
    const barH = Math.max(82, Math.round(height * 0.14));
    ctx.fillStyle = 'rgba(8, 14, 29, 0.86)';
    ctx.fillRect(0, height - barH, width, barH);

    const eCoord = crsMode === 'regven' ? target.esteRegven : target.estePsad56;
    const nCoord = crsMode === 'regven' ? target.norteRegven : target.nortePsad56;
    const crsTitle = crsMode === 'regven' ? `REGVEN ${parcel.huso}N` : `PSAD56 ${parcel.huso}N`;

    const padX = Math.round(width * 0.03);
    const fontBig = Math.max(18, Math.round(barH * 0.28));
    const fontSmall = Math.max(14, Math.round(barH * 0.21));

    ctx.fillStyle = '#4edea3';
    ctx.font = `700 ${fontBig}px monospace`;
    ctx.fillText(
      `GEOGIS6 · PARCELA ${parcel.code} · ${target.id} (${target.code})`,
      padX,
      height - barH + Math.round(barH * 0.38),
    );

    ctx.fillStyle = '#dde2f8';
    ctx.font = `600 ${fontSmall}px monospace`;
    ctx.fillText(
      `${crsTitle} | E: ${eCoord.toFixed(3)} m  N: ${nCoord.toFixed(3)} m  Z: ${target.cota.toFixed(2)} m`,
      padX,
      height - barH + Math.round(barH * 0.72),
    );

    const accStr = hasLiveGps ? `GPS ±${gnssFix.accuracy.toFixed(1)}m` : 'Objetivo Catastral';
    ctx.fillStyle = '#4cd7f6';
    ctx.fillText(
      `${accStr} · ${new Date().toLocaleString('es-VE')}`,
      padX,
      height - Math.round(barH * 0.08),
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `HITO_${parcel.code}_${target.id}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        onNotify(`Foto guardada: HITO_${parcel.code}_${target.id}.jpg`);
      },
      'image/jpeg',
      0.92,
    );
  };

  const handleSaveShift = () => {
    const eVal = Number.parseFloat(draftShiftE);
    const nVal = Number.parseFloat(draftShiftN);
    const safeE = Number.isFinite(eVal) ? eVal : 0;
    const safeN = Number.isFinite(nVal) ? nVal : 0;
    onApplyShift(safeE, safeN);
    setShowShiftModal(false);
    onNotify(
      `Shift aplicado: ΔE ${safeE >= 0 ? '+' : ''}${safeE.toFixed(3)}m · ΔN ${safeN >= 0 ? '+' : ''}${safeN.toFixed(3)}m`,
    );
  };

  const renderDirectionArrow = () => {
    if (!guidance) return <Compass className="w-4 h-4 text-[#4cd7f6]" />;
    switch (guidance.turnType) {
      case 'arrived':
        return <CheckCircle2 className="w-4 h-4 text-[#4edea3]" />;
      case 'straight':
        return <ArrowUp className="w-4 h-4 text-[#4edea3]" />;
      case 'right':
        return <ArrowRight className="w-4 h-4 text-[#ffb95f]" />;
      case 'left':
        return <ArrowLeft className="w-4 h-4 text-[#ffb95f]" />;
      case 'back':
        return <RotateCcw className="w-4 h-4 text-[#ffb4ab]" />;
      default:
        return <Compass className="w-4 h-4 text-[#4cd7f6]" />;
    }
  };

  // Posición horizontal del marcador en Cámara AR basado en giro relativo (FOV ±32°)
  const relBearing = guidance?.relativeDeg ?? null;
  const arInView = relBearing !== null && Math.abs(relBearing) <= 32;
  const arLeftPct = relBearing !== null ? 50 + (relBearing / 32) * 40 : 50;

  return (
    <div className="flex flex-col w-full h-full overflow-y-auto no-scrollbar text-[#dde2f8] bg-[#0d1322] select-none pb-3 relative">
      {/* Barra superior limpia con solo telemetría real */}
      <section className="px-3 pt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 bg-[#151b2b] px-2.5 py-1.5 rounded-lg border border-[#242a3a] min-w-0">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              hasLiveGps ? 'bg-[#4edea3] animate-pulse' : 'bg-[#ffb95f]'
            }`}
          />
          <span
            className={`font-stitch-mono text-[10px] font-bold truncate ${
              hasLiveGps ? 'text-[#4edea3]' : 'text-[#ffb95f]'
            }`}
          >
            {hasLiveGps
              ? `GPS ±${gnssFix.accuracy.toFixed(1)}m · ${gpsAgeSec}s`
              : 'Buscando GPS...'}
          </span>
          <span className="text-[#3d494c]">|</span>
          <span className="font-stitch-mono text-[9.5px] text-[#bcc9cd] truncate">
            {compass.source === 'magnetometer'
              ? 'Brújula'
              : compass.source === 'gps_course'
                ? 'Rumbo GPS'
                : 'Sin brújula'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="bg-[#151b2b] border border-[#242a3a] px-2 py-1.5 rounded-lg font-stitch-mono text-[10px] text-[#4cd7f6] font-bold">
            {stakedIds.length}/{vertices.length} hitos
          </span>

          <button
            type="button"
            onClick={() => {
              setDraftShiftE(shiftEste.toFixed(3));
              setDraftShiftN(shiftNorte.toFixed(3));
              setShowShiftModal(true);
            }}
            className={`px-2 py-1.5 rounded-lg border font-stitch-mono text-[10px] font-bold flex items-center gap-1 ${
              hasActiveShift
                ? 'bg-[#ffb95f]/20 border-[#ffb95f]/60 text-[#ffb95f]'
                : 'bg-[#151b2b] border-[#242a3a] text-[#bcc9cd]'
            }`}
            title="Ajuste Shift ΔE / ΔN"
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Shift</span>
          </button>

          <button
            type="button"
            onClick={() => setVibrateEnabled((v) => !v)}
            className={`p-1.5 rounded-lg border ${
              vibrateEnabled
                ? 'bg-[#151b2b] border-[#242a3a] text-[#4edea3]'
                : 'bg-[#151b2b] border-[#242a3a] text-[#869397]'
            }`}
            title={vibrateEnabled ? 'Vibración al llegar activa' : 'Vibración silenciada'}
          >
            {vibrateEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
          </button>
        </div>
      </section>

      {/* HUD Principal: Objetivo + Dirección en tiempo real + Distancia */}
      <section className="px-3 pt-2">
        <div className="bg-[#151b2b] rounded-xl p-2.5 shadow-md flex flex-col gap-2 border border-[#242a3a]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => handleToggleStaked(target.id)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center font-stitch-headline font-bold text-[12px] shrink-0 border transition-colors ${
                  isTargetStaked
                    ? 'bg-[#4edea3] text-[#003824] border-[#4edea3]'
                    : 'bg-[#06b6d4] text-[#003640] border-[#4cd7f6]'
                }`}
                title="Toca para marcar o desmarcar como localizado"
              >
                {isTargetStaked ? <Check className="w-4 h-4" /> : target.shortId}
              </button>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-stitch-headline text-[16px] font-semibold leading-none text-[#dde2f8]">
                    {target.id}
                  </span>
                  <span className="font-stitch-mono text-[9.5px] bg-[#242a3a] px-1.5 py-0.5 rounded text-[#bcc9cd] truncate">
                    {parcel.code}
                  </span>
                </div>
                <span className="font-stitch-mono text-[10px] text-[#869397] truncate mt-0.5">
                  {target.code} · {crsMode === 'regven' ? `REGVEN ${parcel.huso}N` : `PSAD56 ${parcel.huso}N`}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end shrink-0">
              <span
                className={`font-stitch-headline text-[23px] leading-none font-bold tracking-tight ${
                  distanceM === null
                    ? 'text-[#869397]'
                    : distanceM <= 3
                      ? 'text-[#4edea3]'
                      : distanceM <= 15
                        ? 'text-[#ffb95f]'
                        : 'text-[#4cd7f6]'
                }`}
              >
                {distanceM !== null ? formatFieldDistance(distanceM) : '-- m'}
              </span>
              <div className="flex items-center gap-1 mt-1">
                {renderDirectionArrow()}
                <span className="font-stitch-mono text-[10.5px] font-bold text-[#dde2f8]">
                  {guidance ? guidance.headline : 'Esperando señal GPS'}
                </span>
              </div>
            </div>
          </div>

          {/* 3 métricas vectoriales reales */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="bg-[#0d1322] px-2 py-1.5 rounded flex items-center justify-between border border-[#1f293d]">
              <span className="font-stitch-mono text-[9.5px] text-[#869397] font-bold">
                {deltaNorthM === null ? 'ΔN/S' : deltaNorthM >= 0 ? 'NORTE' : 'SUR'}
              </span>
              <span className="font-stitch-mono text-[12px] text-[#dde2f8] font-bold">
                {deltaNorthM !== null ? `${Math.abs(deltaNorthM).toFixed(2)}m` : '--'}
              </span>
            </div>

            <div className="bg-[#0d1322] px-2 py-1.5 rounded flex items-center justify-between border border-[#1f293d]">
              <span className="font-stitch-mono text-[9.5px] text-[#869397] font-bold">
                {deltaEastM === null ? 'ΔE/O' : deltaEastM >= 0 ? 'ESTE' : 'OESTE'}
              </span>
              <span className="font-stitch-mono text-[12px] text-[#dde2f8] font-bold">
                {deltaEastM !== null ? `${Math.abs(deltaEastM).toFixed(2)}m` : '--'}
              </span>
            </div>

            <div className="bg-[#0d1322] px-2 py-1.5 rounded flex items-center justify-between border border-[#1f293d]">
              <span className="font-stitch-mono text-[9.5px] text-[#ffb95f] font-bold">AZIMUT</span>
              <span className="font-stitch-mono text-[11px] text-[#dde2f8] font-bold truncate ml-1">
                {azInfo ? azInfo.full : '--'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Visor Central: Radar SVG Vectorial / Cámara AR */}
      <section className="px-3 pt-2 flex-1 flex flex-col min-h-[285px] relative">
        <div className="relative w-full h-full min-h-[285px] rounded-xl overflow-hidden">
          {/* Selector Radar / Cámara AR flotante en esquina superior derecha */}
          <div className="absolute top-2.5 right-2.5 z-30 flex items-center bg-[#151b2b]/95 p-0.5 rounded-full shadow-md border border-[#242a3a]">
            <button
              type="button"
              onClick={() => setViewMode('radar')}
              className={`px-2.5 py-1 rounded-full font-stitch-headline text-[10.5px] flex items-center gap-1 transition-all ${
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
              className={`px-2.5 py-1 rounded-full font-stitch-headline text-[10.5px] flex items-center gap-1 transition-all ${
                viewMode === 'ar'
                  ? 'bg-[#06b6d4] text-[#003640] font-bold'
                  : 'text-[#bcc9cd]'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              AR
            </button>
          </div>

          {viewMode === 'radar' ? (
            <StakeoutRadar
              orientationMode={orientationMode}
              onToggleOrientation={() =>
                setOrientationMode((m) => (m === 'north_up' ? 'heading_up' : 'north_up'))
              }
              hasLiveGps={hasLiveGps}
              distanceM={distanceM}
              deltaNorthM={deltaNorthM}
              deltaEastM={deltaEastM}
              targetAzimuthDeg={targetAzimuthDeg}
              deviceHeadingDeg={compass.headingDeg}
              gpsAccuracyM={gnssFix.accuracy || 3.5}
              targetLabel={target.id}
              isStaked={isTargetStaked}
            />
          ) : (
            <div className="relative w-full h-full min-h-[285px] stitch-ar-grid bg-[#080e1d] rounded-xl overflow-hidden border border-[#242a3a] flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`absolute inset-0 w-full h-full object-cover transition-opacity ${
                  cameraActive ? 'opacity-90' : 'opacity-0 pointer-events-none'
                }`}
              />

              {/* Línea de horizonte + estado cámara */}
              <div className="absolute inset-x-4 top-3 flex items-center justify-start pointer-events-none">
                <span className="font-stitch-mono text-[10px] bg-[#0d1322]/85 border border-[#242a3a] text-[#4cd7f6] px-2 py-0.5 rounded">
                  {cameraActive ? 'CÁMARA AR ACTIVA' : 'CÁMARA NO DISPONIBLE'}
                </span>
              </div>

              {hasLiveGps && distanceM !== null ? (
                arInView || relBearing === null ? (
                  <div
                    className="relative z-10 flex flex-col items-center transition-all duration-150"
                    style={{
                      position: 'absolute',
                      left: `${arLeftPct}%`,
                      top: '46%',
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <div className="bg-[#0d1322]/90 border-2 border-[#4edea3] px-2.5 py-1 rounded-lg text-[#dde2f8] font-stitch-mono text-[11px] font-bold shadow-xl flex items-center gap-1.5 whitespace-nowrap">
                      <MapPin className="w-3.5 h-3.5 text-[#4edea3]" />
                      <span>
                        {target.id} · {formatFieldDistance(distanceM)}
                      </span>
                    </div>
                    <div className="w-0.5 h-16 bg-gradient-to-b from-[#4edea3] to-transparent" />
                    <div className="w-8 h-8 rounded-full border-2 border-[#4edea3] bg-[#4edea3]/20 flex items-center justify-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#4edea3]" />
                    </div>
                  </div>
                ) : (
                  <div className="relative z-10 bg-[#0d1322]/90 border border-[#ffb95f] px-3.5 py-2 rounded-xl flex items-center gap-2 shadow-xl">
                    {relBearing < 0 ? (
                      <ArrowLeft className="w-5 h-5 text-[#ffb95f]" />
                    ) : (
                      <ArrowRight className="w-5 h-5 text-[#ffb95f]" />
                    )}
                    <div className="flex flex-col">
                      <span className="font-stitch-headline text-[12px] font-bold text-[#ffb95f]">
                        {relBearing < 0
                          ? `Gira ${Math.round(Math.abs(relBearing))}° a la izquierda`
                          : `Gira ${Math.round(relBearing)}° a la derecha`}
                      </span>
                      <span className="font-stitch-mono text-[10px] text-[#bcc9cd]">
                        {target.id} a {formatFieldDistance(distanceM)}
                      </span>
                    </div>
                  </div>
                )
              ) : (
                <div className="relative z-10 bg-[#0d1322]/85 border border-[#ffb95f]/60 px-3 py-2 rounded-lg font-stitch-mono text-[11px] text-[#ffb95f]">
                  Buscando señal GPS para posicionar el hito...
                </div>
              )}

              {cutFillM !== null && (
                <div className="absolute bottom-2.5 left-2.5 z-10 bg-[#0d1322]/85 border border-[#242a3a] px-2 py-0.5 rounded font-stitch-mono text-[10px] text-[#4edea3] flex items-center gap-1">
                  <ArrowDownToLine className="w-3 h-3" />
                  <span>
                    {cutFillM < 0 ? 'Corte' : 'Relleno'}: {cutFillM >= 0 ? '+' : ''}
                    {cutFillM.toFixed(2)}m
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Controles Reales de Campo */}
      <section className="px-3 pt-2.5 flex flex-col gap-2">
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={handlePrev}
            className="h-10 bg-[#191f2f] hover:bg-[#242a3a] text-[#dde2f8] rounded-lg flex items-center justify-center gap-0.5 font-stitch-headline text-[11px] font-bold border border-[#242a3a]"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="truncate">Anterior</span>
          </button>

          <button
            type="button"
            onClick={handleNext}
            className="h-10 bg-[#191f2f] hover:bg-[#242a3a] text-[#dde2f8] rounded-lg flex items-center justify-center gap-0.5 font-stitch-headline text-[11px] font-bold border border-[#242a3a]"
          >
            <span className="truncate">Siguiente</span>
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowPointsPicker(true)}
            className="h-10 bg-[#191f2f] hover:bg-[#242a3a] text-[#4cd7f6] rounded-lg flex items-center justify-center gap-1 font-stitch-headline text-[11px] font-bold border border-[#242a3a]"
          >
            <ListOrdered className="w-4 h-4" />
            <span>Puntos</span>
          </button>

          <button
            type="button"
            onClick={handleCapturePhoto}
            className="h-10 bg-[#191f2f] hover:bg-[#242a3a] text-[#ffb95f] rounded-lg flex items-center justify-center gap-1 font-stitch-headline text-[11px] font-bold border border-[#242a3a]"
          >
            <Camera className="w-4 h-4" />
            <span className="truncate">Foto Hito</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStartOrFinishCapture}
            disabled={!hasLiveGps}
            className={`flex-1 h-12 rounded-xl flex items-center justify-between px-3.5 shadow-lg transition-all ${
              !hasLiveGps
                ? 'bg-[#191f2f] text-[#869397] border border-[#242a3a] opacity-70'
                : isAveraging
                  ? 'bg-[#ffb95f] text-[#3a2200]'
                  : 'bg-[#4edea3] hover:bg-[#6ffbbe] active:scale-[0.98] text-[#003824]'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Save className="w-4 h-4 shrink-0" />
              <div className="flex flex-col text-left min-w-0">
                <span className="font-stitch-headline text-[13px] tracking-tight leading-none uppercase font-bold truncate">
                  {isAveraging
                    ? `Promediando (${avgSamples.length}/${TARGET_AVG_SAMPLES}) · Toca para guardar`
                    : 'Capturar Coordenada GPS'}
                </span>
                <span className="font-stitch-mono text-[9.5px] opacity-80 leading-tight mt-0.5 truncate">
                  {hasLiveGps
                    ? `E: ${gnssFix.esteRegven.toFixed(2)} · N: ${gnssFix.norteRegven.toFixed(2)}`
                    : 'Requiere señal GPS activa'}
                </span>
              </div>
            </div>
          </button>

          {onAddVertexFromGps && (
            <button
              type="button"
              disabled={!hasLiveGps}
              onClick={() => onAddVertexFromGps(gnssFix)}
              className="h-12 px-3 rounded-xl bg-[#242a3a] hover:bg-[#2f3445] border border-[#4cd7f6]/40 text-[#4cd7f6] font-stitch-headline text-[11px] font-bold uppercase flex items-center gap-1 shrink-0 disabled:opacity-45"
              title="Agregar nuevo vértice con posición GPS actual"
            >
              <PlusCircle className="w-4 h-4" />
              <span>+ Vértice</span>
            </button>
          )}
        </div>
      </section>

      {/* Modal Shift ΔE / ΔN */}
      {showShiftModal && (
        <div className="absolute inset-0 z-50 bg-[#0d1322]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full bg-[#191f2f] rounded-xl p-4 shadow-2xl flex flex-col gap-3 border border-[#2f3445]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-[#4cd7f6]" />
                <h2 className="font-stitch-headline text-[15px] font-semibold">
                  Calibración Shift ΔE / ΔN
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
            <p className="text-[12px] text-[#bcc9cd]">
              Desfase de calibración local en metros ({crsMode === 'regven' ? 'REGVEN' : 'PSAD56'}).
            </p>
            <div className="grid grid-cols-2 gap-2 font-stitch-mono">
              <div className="bg-[#151b2b] p-2 rounded flex flex-col gap-1 border border-[#242a3a]">
                <span className="text-[#bcc9cd] text-[10px]">Shift Δ Este (m)</span>
                <input
                  value={draftShiftE}
                  onChange={(e) => setDraftShiftE(e.target.value)}
                  className="w-full bg-[#080e1d] text-[#4cd7f6] font-bold text-[13px] px-2 py-1 rounded outline-none"
                />
              </div>
              <div className="bg-[#151b2b] p-2 rounded flex flex-col gap-1 border border-[#242a3a]">
                <span className="text-[#bcc9cd] text-[10px]">Shift Δ Norte (m)</span>
                <input
                  value={draftShiftN}
                  onChange={(e) => setDraftShiftN(e.target.value)}
                  className="w-full bg-[#080e1d] text-[#4cd7f6] font-bold text-[13px] px-2 py-1 rounded outline-none"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDraftShiftE('0.000');
                  setDraftShiftN('0.000');
                  onApplyShift(0, 0);
                  setShowShiftModal(false);
                }}
                className="px-3 h-10 bg-[#242a3a] text-[#bcc9cd] font-stitch-headline text-[11px] font-bold rounded uppercase"
              >
                Cero
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

      {/* Selector Inteligente de Vértices con Distancia Real en Vivo */}
      {showPointsPicker && (
        <div className="absolute inset-0 z-50 bg-[#0d1322]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full bg-[#191f2f] rounded-xl p-4 shadow-2xl flex flex-col gap-2.5 border border-[#2f3445]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-stitch-headline text-[15px] font-semibold truncate">
                Vértices · {parcel.code} ({stakedIds.length}/{vertices.length})
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {hasLiveGps && (
                  <button
                    type="button"
                    onClick={() => setSortByNearest((s) => !s)}
                    className={`px-2 py-1 rounded font-stitch-mono text-[9.5px] font-bold border ${
                      sortByNearest
                        ? 'bg-[#4cd7f6]/20 border-[#4cd7f6] text-[#4cd7f6]'
                        : 'bg-[#242a3a] border-transparent text-[#bcc9cd]'
                    }`}
                  >
                    {sortByNearest ? 'Más cercano' : 'Orden ID'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPointsPicker(false)}
                  className="w-7 h-7 rounded bg-[#242a3a] text-[#bcc9cd] flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto no-scrollbar">
              {sortedVertices.map((v) => {
                const isActive = v.id === target.id;
                const isDone = stakedIds.includes(v.id);
                const dN = hasLiveGps ? v.norteRegven - gnssFix.norteRegven + shiftNorte : null;
                const dE = hasLiveGps ? v.esteRegven - gnssFix.esteRegven + shiftEste : null;
                const vDist = dN !== null && dE !== null ? Math.hypot(dN, dE) : null;
                const vAz =
                  dN !== null && dE !== null
                    ? Math.round(normalizeAngle360((Math.atan2(dE, dN) * 180) / Math.PI))
                    : null;
                const showE = crsMode === 'regven' ? v.esteRegven : v.estePsad56;
                const showN = crsMode === 'regven' ? v.norteRegven : v.nortePsad56;

                return (
                  <div
                    key={v.id}
                    className={`p-2 rounded-lg flex items-center justify-between gap-2 border ${
                      isActive
                        ? 'bg-[#242a3a] border-[#4cd7f6]/60'
                        : 'bg-[#080e1d] border-transparent hover:bg-[#151b2b]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectVertex(v.id);
                        setShowPointsPicker(false);
                      }}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-stitch-mono text-[12px] font-bold text-[#4cd7f6]">
                          {v.id}
                        </span>
                        <span className="font-stitch-mono text-[10.5px] text-[#ffb95f] truncate">
                          {v.code}
                        </span>
                      </div>
                      <div className="font-stitch-mono text-[9.5px] text-[#bcc9cd] truncate">
                        {vDist !== null
                          ? `${formatFieldDistance(vDist)} · Az ${vAz}°`
                          : `E:${formatCoord(showE)} N:${formatCoord(showN)}`}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleStaked(v.id)}
                      className={`px-2 py-1 rounded font-stitch-mono text-[9.5px] font-bold shrink-0 ${
                        isDone
                          ? 'bg-[#4edea3]/20 text-[#4edea3] border border-[#4edea3]/50'
                          : 'bg-[#191f2f] text-[#869397] border border-[#242a3a]'
                      }`}
                    >
                      {isDone ? '✓ Listo' : 'Marcar'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
