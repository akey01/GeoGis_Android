'use client';

import React from 'react';
import { Compass } from 'lucide-react';
import {
  formatFieldDistance,
  normalizeAngle360,
  selectRadarScaleMeters,
} from '@/lib/mobileCompass';

export type RadarOrientationMode = 'north_up' | 'heading_up';

interface StakeoutRadarProps {
  orientationMode: RadarOrientationMode;
  onToggleOrientation: () => void;
  hasLiveGps: boolean;
  distanceM: number | null;
  deltaNorthM: number | null;
  deltaEastM: number | null;
  targetAzimuthDeg: number | null;
  deviceHeadingDeg: number | null;
  gpsAccuracyM: number;
  targetLabel: string;
  isStaked: boolean;
}

function formatRingLabel(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)}km`;
  if (m < 1) return `${m.toFixed(2)}m`;
  return `${m}m`;
}

export default function StakeoutRadar({
  orientationMode,
  onToggleOrientation,
  hasLiveGps,
  distanceM,
  deltaNorthM,
  deltaEastM,
  targetAzimuthDeg,
  deviceHeadingDeg,
  gpsAccuracyM,
  targetLabel,
  isStaked,
}: StakeoutRadarProps) {
  const CX = 160;
  const CY = 160;
  const OUTER_R = 122;

  const scale = selectRadarScaleMeters(distanceM ?? 25);
  const dialRotation =
    orientationMode === 'heading_up' && deviceHeadingDeg !== null
      ? -deviceHeadingDeg
      : 0;

  // Color táctico por proximidad
  const zoneColor =
    !hasLiveGps || distanceM === null
      ? '#4cd7f6'
      : distanceM <= 3.0
        ? '#4edea3'
        : distanceM <= 15.0
          ? '#ffb95f'
          : '#4cd7f6';

  const targetStrokeColor = isStaked ? '#4edea3' : zoneColor;

  // Posición cartesiana del punto objetivo en SVG (eje Norte arriba antes de rotar dial)
  let targetX = CX;
  let targetY = CY;
  let outOfRange = false;
  let guideAngleDeg = 0;

  if (
    hasLiveGps &&
    distanceM !== null &&
    deltaEastM !== null &&
    deltaNorthM !== null
  ) {
    const az =
      targetAzimuthDeg !== null
        ? targetAzimuthDeg
        : normalizeAngle360((Math.atan2(deltaEastM, deltaNorthM) * 180) / Math.PI);
    const displayAz = normalizeAngle360(az + dialRotation);
    guideAngleDeg = displayAz;

    const ratio = distanceM / scale.outerM;
    outOfRange = ratio > 1.0;
    const clampedRatio = Math.min(0.97, ratio);
    const rPx = clampedRatio * OUTER_R;
    const rad = (displayAz * Math.PI) / 180;
    targetX = CX + Math.sin(rad) * rPx;
    targetY = CY - Math.cos(rad) * rPx;
  }

  // Cono de visión/rumbo del teléfono
  const hasHeading = deviceHeadingDeg !== null && Number.isFinite(deviceHeadingDeg);
  const coneRotation =
    orientationMode === 'north_up' && hasHeading ? deviceHeadingDeg! : 0;

  // Radio proporcional del halo de precisión GPS
  const gpsAccuracyRadiusPx = hasLiveGps
    ? Math.max(8, Math.min(OUTER_R * 0.65, (gpsAccuracyM / scale.outerM) * OUTER_R))
    : 12;

  // Ticks del dial cada 15°
  const ticks = Array.from({ length: 24 }, (_, idx) => idx * 15);

  return (
    <div className="relative w-full h-full min-h-[275px] bg-[#080e1d] rounded-xl overflow-hidden border border-[#242a3a] flex items-center justify-center shadow-inner">
      {/* Botón compacto conmutador Norte Arriba <-> Brújula Arriba */}
      <button
        type="button"
        onClick={onToggleOrientation}
        className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 bg-[#151b2b]/95 hover:bg-[#191f2f] border border-[#2f3445] px-2.5 py-1.5 rounded-lg shadow-md active:scale-95 transition-transform"
        title="Alternar orientación del radar"
      >
        <Compass
          className={`w-3.5 h-3.5 ${
            orientationMode === 'north_up' ? 'text-[#4cd7f6]' : 'text-[#4edea3]'
          }`}
        />
        <span className="font-stitch-mono text-[10px] font-bold text-[#dde2f8]">
          {orientationMode === 'north_up' ? 'NORTE ARRIBA' : 'BRÚJULA ARRIBA'}
        </span>
      </button>

      {/* Escala activa en esquina inferior izquierda */}
      <div className="absolute bottom-2.5 left-2.5 z-20 bg-[#151b2b]/90 border border-[#242a3a] px-2 py-0.5 rounded font-stitch-mono text-[9.5px] text-[#bcc9cd]">
        Radio máx: <strong className="text-[#4cd7f6]">{formatRingLabel(scale.outerM)}</strong>
      </div>

      {/* Rumbo del equipo en esquina inferior derecha */}
      <div className="absolute bottom-2.5 right-2.5 z-20 bg-[#151b2b]/90 border border-[#242a3a] px-2 py-0.5 rounded font-stitch-mono text-[9.5px] text-[#bcc9cd]">
        {hasHeading ? (
          <>
            Equipo: <strong className="text-[#4edea3]">{Math.round(deviceHeadingDeg!)}°</strong>
          </>
        ) : (
          <span className="text-[#869397]">Sin magnetómetro</span>
        )}
      </div>

      <svg
        viewBox="0 0 320 320"
        className="w-full h-full max-w-[320px] max-h-[320px] select-none"
        aria-label="Radar topográfico de replanteo"
      >
        <defs>
          <radialGradient id="radarBgGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#122136" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#0b1424" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#080e1d" stopOpacity="1" />
          </radialGradient>
          <linearGradient id="coneGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#4edea3" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#4edea3" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Disco de fondo */}
        <circle
          cx={CX}
          cy={CY}
          r={OUTER_R + 18}
          fill="url(#radarBgGrad)"
          stroke="#1f293d"
          strokeWidth="1.2"
        />

        {/* Anillos concéntricos auto-escalados */}
        <circle
          cx={CX}
          cy={CY}
          r={OUTER_R}
          fill="none"
          stroke="#2f3b52"
          strokeWidth="1.2"
        />
        <circle
          cx={CX}
          cy={CY}
          r={OUTER_R * 0.5}
          fill="none"
          stroke="#263147"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        <circle
          cx={CX}
          cy={CY}
          r={OUTER_R * 0.25}
          fill="none"
          stroke="#263147"
          strokeDasharray="2 3"
          strokeWidth="0.9"
        />

        {/* Ejes ortogonales rotables según orientación */}
        <g transform={`rotate(${dialRotation} ${CX} ${CY})`}>
          <line
            x1={CX}
            y1={CY - OUTER_R}
            x2={CX}
            y2={CY + OUTER_R}
            stroke="#243045"
            strokeWidth="0.9"
          />
          <line
            x1={CX - OUTER_R}
            y1={CY}
            x2={CX + OUTER_R}
            y2={CY}
            stroke="#243045"
            strokeWidth="0.9"
          />

          {/* Marcas graduadas perimetrales */}
          {ticks.map((deg) => {
            const isMajor = deg % 45 === 0;
            const r1 = OUTER_R;
            const r2 = isMajor ? OUTER_R + 7 : OUTER_R + 3.5;
            const rad = (deg * Math.PI) / 180;
            return (
              <line
                key={deg}
                x1={CX + Math.sin(rad) * r1}
                y1={CY - Math.cos(rad) * r1}
                x2={CX + Math.sin(rad) * r2}
                y2={CY - Math.cos(rad) * r2}
                stroke={deg === 0 ? '#4cd7f6' : isMajor ? '#586985' : '#2a364d'}
                strokeWidth={deg === 0 ? '2' : isMajor ? '1.3' : '0.8'}
              />
            );
          })}

          {/* Etiquetas cardinales N / E / S / O */}
          <g transform={`translate(${CX}, ${CY - OUTER_R - 13}) rotate(${-dialRotation})`}>
            <circle r="9" fill="#0d1322" stroke="#4cd7f6" strokeWidth="1.2" />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="#4cd7f6"
              fontSize="10"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              N
            </text>
          </g>
          <g transform={`translate(${CX + OUTER_R + 13}, ${CY}) rotate(${-dialRotation})`}>
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="#9aa7b8"
              fontSize="10"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              E
            </text>
          </g>
          <g transform={`translate(${CX}, ${CY + OUTER_R + 13}) rotate(${-dialRotation})`}>
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="#9aa7b8"
              fontSize="10"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              S
            </text>
          </g>
          <g transform={`translate(${CX - OUTER_R - 13}, ${CY}) rotate(${-dialRotation})`}>
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill="#9aa7b8"
              fontSize="10"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              O
            </text>
          </g>
        </g>

        {/* Etiquetas discretas de escala en los anillos */}
        <text
          x={CX + 4}
          y={CY - OUTER_R * 0.5 - 3}
          fill="#6e7f96"
          fontSize="8.5"
          fontFamily="JetBrains Mono, monospace"
        >
          {formatRingLabel(scale.midM)}
        </text>
        <text
          x={CX + 4}
          y={CY - OUTER_R * 0.25 - 3}
          fill="#6e7f96"
          fontSize="8"
          fontFamily="JetBrains Mono, monospace"
        >
          {formatRingLabel(scale.innerM)}
        </text>

        {/* Cono de dirección hacia donde apunta el teléfono */}
        {hasHeading && (
          <g transform={`rotate(${coneRotation} ${CX} ${CY})`}>
            <path
              d={`M ${CX} ${CY} L ${CX - 34} ${CY - 88} A 94 94 0 0 1 ${CX + 34} ${CY - 88} Z`}
              fill="url(#coneGrad)"
            />
            <line
              x1={CX}
              y1={CY}
              x2={CX}
              y2={CY - 88}
              stroke="#4edea3"
              strokeOpacity="0.45"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
          </g>
        )}

        {/* Halo de incertidumbre GPS + operador en el centro */}
        {hasLiveGps && (
          <circle
            cx={CX}
            cy={CY}
            r={gpsAccuracyRadiusPx}
            fill="rgba(78, 222, 163, 0.08)"
            stroke="rgba(78, 222, 163, 0.35)"
            strokeWidth="1"
          />
        )}

        {/* Vector guía + flecha direccional + Diana Topográfica del punto seleccionado */}
        {hasLiveGps && distanceM !== null ? (
          <>
            {/* Línea guía luminosa centro -> punto */}
            <line
              x1={CX}
              y1={CY}
              x2={targetX}
              y2={targetY}
              stroke={targetStrokeColor}
              strokeWidth="2.2"
              strokeDasharray={distanceM <= 3 ? undefined : '6 4'}
              strokeOpacity="0.9"
            />

            {/* Flecha direccional en el punto medio del vector (si dist > 2m) */}
            {distanceM > 2 && (
              <g
                transform={`translate(${(CX + targetX) / 2}, ${(CY + targetY) / 2}) rotate(${guideAngleDeg})`}
              >
                <polygon
                  points="0,-7 5,5 0,2 -5,5"
                  fill={targetStrokeColor}
                  stroke="#080e1d"
                  strokeWidth="1"
                />
              </g>
            )}

            {/* Puntero exterior si el punto supera el radio máximo */}
            {outOfRange && (
              <g transform={`rotate(${guideAngleDeg} ${CX} ${CY})`}>
                <polygon
                  points={`${CX},${CY - OUTER_R - 7} ${CX - 6},${CY - OUTER_R + 4} ${CX + 6},${CY - OUTER_R + 4}`}
                  fill={targetStrokeColor}
                  stroke="#080e1d"
                  strokeWidth="1.2"
                />
              </g>
            )}

            {/* Nuevo ícono topográfico de precisión del punto seleccionado */}
            <g transform={`translate(${targetX}, ${targetY})`}>
              {/* Halo pulsante */}
              <circle
                r="16"
                fill={targetStrokeColor}
                fillOpacity="0.16"
                stroke={targetStrokeColor}
                strokeOpacity="0.45"
                strokeWidth="1"
              >
                <animate
                  attributeName="r"
                  values="12;18;12"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="stroke-opacity"
                  values="0.7;0.15;0.7"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
              </circle>
              {/* Retícula topográfica en cruz */}
              <circle
                r="9"
                fill="#080e1d"
                fillOpacity="0.85"
                stroke={targetStrokeColor}
                strokeWidth="2"
              />
              <line x1="-13" y1="0" x2="-5" y2="0" stroke={targetStrokeColor} strokeWidth="1.8" />
              <line x1="5" y1="0" x2="13" y2="0" stroke={targetStrokeColor} strokeWidth="1.8" />
              <line x1="0" y1="-13" x2="0" y2="-5" stroke={targetStrokeColor} strokeWidth="1.8" />
              <line x1="0" y1="5" x2="0" y2="13" stroke={targetStrokeColor} strokeWidth="1.8" />
              <circle r="3" fill={targetStrokeColor} />

              {/* Etiqueta legible junto al punto */}
              <g transform={`translate(0, ${targetY < 56 ? 21 : -20})`}>
                <rect
                  x="-24"
                  y="-8"
                  width="48"
                  height="16"
                  rx="4"
                  fill="#0d1322"
                  fillOpacity="0.95"
                  stroke={targetStrokeColor}
                  strokeWidth="1"
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#dde2f8"
                  fontSize="9"
                  fontWeight="700"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {isStaked ? `✓ ${targetLabel}` : targetLabel}
                </text>
              </g>
            </g>
          </>
        ) : (
          <g>
            <rect
              x={CX - 86}
              y={CY + 24}
              width="172"
              height="24"
              rx="6"
              fill="#151b2b"
              stroke="#ffb95f"
              strokeOpacity="0.6"
              strokeWidth="1"
            />
            <text
              x={CX}
              y={CY + 36}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#ffb95f"
              fontSize="10"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
            >
              Buscando señal GPS...
            </text>
          </g>
        )}

        {/* Operador en el centro */}
        <circle
          cx={CX}
          cy={CY}
          r="6"
          fill="#4edea3"
          stroke="#080e1d"
          strokeWidth="2"
        />
        <circle cx={CX} cy={CY} r="2" fill="#080e1d" />
      </svg>
    </div>
  );
}
