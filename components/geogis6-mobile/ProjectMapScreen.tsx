'use client';

import React, { useState } from 'react';
import {
  ArrowRight,
  Crosshair,
  FileDown,
  FolderOpen,
  Layers,
  Minus,
  Navigation,
  Plus,
  Ruler,
  Satellite,
  Share2,
} from 'lucide-react';
import {
  ADICORA_SATELLITE_TILE_CENTER,
  ADJACENT_PARCELS,
  type CrsMode,
  type FieldParcel,
  type LiveGnssFix,
  type SyncedProject,
} from './data/fieldData';

interface ProjectMapScreenProps {
  project: SyncedProject;
  parcel: FieldParcel;
  crsMode: CrsMode;
  isDemoMode: boolean;
  gnssFix: LiveGnssFix;
  onToggleCrs: () => void;
  onOpenParcel: () => void;
  onStakeVertex: (vertexId: string) => void;
  onCenterGps: () => void;
  onNotify: (msg: string) => void;
}

export default function ProjectMapScreen({
  project,
  parcel,
  crsMode,
  isDemoMode,
  gnssFix,
  onToggleCrs,
  onOpenParcel,
  onStakeVertex,
  onCenterGps,
  onNotify,
}: ProjectMapScreenProps) {
  const [satelliteOn, setSatelliteOn] = useState(true);
  const [showAdjacent, setShowAdjacent] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [selectedAdjacent, setSelectedAdjacent] = useState<string | null>(null);

  const { z, x, y } = ADICORA_SATELLITE_TILE_CENTER;
  const tileOffsets = [-1, 0, 1];

  const handleZoomIn = () => setZoomScale((zv) => Math.min(1.45, Math.round((zv + 0.15) * 100) / 100));
  const handleZoomOut = () => setZoomScale((zv) => Math.max(0.8, Math.round((zv - 0.15) * 100) / 100));
  const scaleDenom = Math.round(1000 / zoomScale);
  const scaleMeters = Math.round(50 / zoomScale);

  return (
    <div className="flex flex-col w-full h-full relative select-none bg-[#0d1322]">
      {/* Ultra-Compact Tactical Sub-Bar (40px) */}
      <div className="h-10 shrink-0 px-3.5 bg-[#151b2b] flex items-center justify-between gap-2 z-20 shadow-md border-b border-[#242a3a]">
        <div className="flex items-center gap-1.5 min-w-0">
          <FolderOpen className="w-4 h-4 text-[#4cd7f6] shrink-0" />
          <span className="font-stitch-headline text-[13px] text-[#dde2f8] font-bold truncate">
            {project.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleCrs}
            className="flex items-center gap-1 bg-[#191f2f] hover:bg-[#242a3a] px-2 py-0.5 rounded border border-[#2f3445]"
            title="Alternar Datum REGVEN 19N / PSAD56"
          >
            <span className="font-stitch-mono text-[9.5px] text-[#869397]">DATUM</span>
            <span className="font-stitch-mono text-[10px] text-[#4cd7f6] font-semibold">
              {crsMode === 'regven' ? `REGVEN ${parcel.huso}N` : `PSAD56 ${parcel.huso}N`}
            </span>
          </button>

          <div className="flex items-center gap-1 bg-[#00a572]/20 text-[#4edea3] px-2 py-0.5 rounded">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4edea3] animate-pulse" />
            <span className="font-stitch-mono text-[10px] font-semibold tracking-tight">
              {gnssFix.isLiveHardware ? `GPS ±${gnssFix.accuracy.toFixed(1)}m` : 'FIXED ±0.012m'}
            </span>
          </div>

          <span className="bg-[#242a3a] text-[#bcc9cd] font-stitch-mono text-[10px] px-1.5 py-0.5 rounded font-semibold">
            {isDemoMode ? 'DEMO' : 'OP'}
          </span>
        </div>
      </div>

      {/* Central Map Viewport Canvas Area */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-[#080e1d]">
        <div
          className="absolute inset-0 w-full h-full transition-transform duration-200 origin-center"
          style={{ transform: `scale(${zoomScale})` }}
        >
          {satelliteOn ? (
            <div className="absolute inset-0 w-full h-full overflow-hidden bg-[radial-gradient(circle_at_35%_25%,#1b3a2e_0%,#0f2331_52%,#080e1d_100%)]">
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-80 brightness-[0.76] contrast-[1.22]">
                {tileOffsets.map((dy) =>
                  tileOffsets.map((dx) => (
                    <img
                      key={`${dx}_${dy}`}
                      src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y + dy}/${x + dx}`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ))
                )}
              </div>
              <div className="absolute inset-0 bg-[#080e1d]/30" />
            </div>
          ) : (
            <div className="absolute inset-0 w-full h-full bg-[#080e1d]" />
          )}

          {/* Vector Polygons, Crosshairs, Vertices */}
          <svg
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="xMidYMid meet"
            viewBox="0 0 400 620"
          >
            <defs>
              <pattern height="40" id="prod-grid-dots" patternUnits="userSpaceOnUse" width="40">
                <circle cx="2" cy="2" fill="#869397" fillOpacity="0.22" r="1" />
              </pattern>
              <filter height="140%" id="prod-cyan-glow" width="140%" x="-20%" y="-20%">
                <feDropShadow dx="0" dy="0" floodColor="#06b6d4" floodOpacity="0.8" stdDeviation="3" />
              </filter>
            </defs>

            <rect fill="url(#prod-grid-dots)" height="100%" width="100%" />

            {showAdjacent &&
              ADJACENT_PARCELS.map((adj) => {
                const isAdjSel = selectedAdjacent === adj.code;
                return (
                  <g
                    key={adj.code}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedAdjacent(isAdjSel ? null : adj.code);
                      onNotify(`Colindante ${adj.code} · Superficie aprox. ${adj.areaM2.toFixed(1)} m²`);
                    }}
                  >
                    <polygon
                      fill="#151b2b"
                      fillOpacity={isAdjSel ? 0.65 : 0.45}
                      points={adj.points}
                      stroke={isAdjSel ? '#ffb95f' : '#869397'}
                      strokeDasharray={adj.code.includes('MAN1') ? '4 2' : '3 3'}
                      strokeWidth={isAdjSel ? 1.8 : 1.2}
                    />
                    <text
                      fill={isAdjSel ? '#ffb95f' : '#bcc9cd'}
                      fontFamily="var(--font-stitch-mono), monospace"
                      fontSize={adj.code.includes('MAN1') ? '11.5' : '11'}
                      fontWeight="600"
                      textAnchor="middle"
                      x={adj.labelX}
                      y={adj.labelY}
                    >
                      {adj.code}
                    </text>
                  </g>
                );
              })}

            {/* Active Parcel Polygon */}
            <polygon
              fill="#06b6d4"
              fillOpacity={measureMode ? 0.28 : 0.18}
              filter="url(#prod-cyan-glow)"
              points={parcel.vertices.map((v) => `${v.mapX},${v.mapY}`).join(' ')}
              stroke="#06b6d4"
              strokeWidth="2.5"
              className="cursor-pointer"
              onClick={onOpenParcel}
            />

            {measureMode && (
              <g>
                <line x1={80} y1={225} x2={355} y2={420} stroke="#ffb95f" strokeWidth="1.5" strokeDasharray="5 3" />
                <rect x="172" y="290" width="90" height="17" rx="3" fill="#0d1322" stroke="#ffb95f" strokeWidth="0.9" />
                <text
                  x="217"
                  y="302"
                  fill="#ffb95f"
                  fontFamily="var(--font-stitch-mono), monospace"
                  fontSize="9"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  DIAG: 50.42 m
                </text>
              </g>
            )}

            <text fill="#4cd7f6" fontFamily="var(--font-stitch-mono), monospace" fontSize="9.5" fontWeight="700" textAnchor="middle" x="205" y="209">
              38.45m
            </text>
            <text fill="#4cd7f6" fontFamily="var(--font-stitch-mono), monospace" fontSize="9.5" fontWeight="700" textAnchor="start" x="350" y="315">
              32.60m
            </text>
            <text fill="#4cd7f6" fontFamily="var(--font-stitch-mono), monospace" fontSize="9.5" fontWeight="700" textAnchor="middle" x="230" y="446">
              39.10m
            </text>
            <text fill="#4cd7f6" fontFamily="var(--font-stitch-mono), monospace" fontSize="9.5" fontWeight="700" textAnchor="end" x="82" y="340">
              35.05m
            </text>

            <g className="cursor-pointer" onClick={onOpenParcel}>
              <rect fill="#0d1322" fillOpacity="0.88" height="26" rx="3" stroke="#06b6d4" strokeWidth="1" width="102" x="159" y="312" />
              <text
                fill="#acedff"
                fontFamily="var(--font-stitch-headline), sans-serif"
                fontSize="13"
                fontWeight="700"
                textAnchor="middle"
                x="210"
                y="329"
              >
                {parcel.code}
              </text>
            </g>

            {parcel.vertices.map((v) => {
              const labelOffset =
                v.shortId === 'V1'
                  ? { dx: -14, dy: -6 }
                  : v.shortId === 'V2'
                    ? { dx: 10, dy: -4 }
                    : v.shortId === 'V3'
                      ? { dx: 10, dy: 10 }
                      : { dx: -14, dy: 14 };
              return (
                <g key={v.id} className="cursor-pointer" onClick={() => onStakeVertex(v.id)}>
                  <circle cx={v.mapX} cy={v.mapY} fill="#06b6d4" fillOpacity="0.22" r="10" />
                  <circle cx={v.mapX} cy={v.mapY} fill="#06b6d4" r="4.8" stroke="#0d1322" strokeWidth="1.5" />
                  <text
                    fill="#acedff"
                    fontFamily="var(--font-stitch-mono), monospace"
                    fontSize="10"
                    fontWeight="700"
                    x={v.mapX + labelOffset.dx}
                    y={v.mapY + labelOffset.dy}
                  >
                    {v.shortId}
                  </text>
                </g>
              );
            })}

            {/* Current GNSS Crosshair Reticle */}
            <g transform="translate(190, 275)">
              <circle cx="0" cy="0" fill="none" r="18" stroke="#4edea3" strokeOpacity="0.45" strokeWidth="1" />
              <circle cx="0" cy="0" fill="#4edea3" fillOpacity="0.16" r="10" stroke="#4edea3" strokeWidth="1.5" />
              <circle cx="0" cy="0" fill="#4edea3" r="2.5" />
              <line stroke="#4edea3" strokeWidth="1.5" x1="-24" x2="-6" y1="0" y2="0" />
              <line stroke="#4edea3" strokeWidth="1.5" x1="6" x2="24" y1="0" y2="0" />
              <line stroke="#4edea3" strokeWidth="1.5" x1="0" x2="0" y1="-24" y2="-6" />
              <line stroke="#4edea3" strokeWidth="1.5" x1="0" x2="0" y1="6" y2="24" />
            </g>
          </svg>
        </div>

        {/* Top-Right Compass & Scale */}
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5 z-10">
          <button
            type="button"
            onClick={() => {
              setZoomScale(1);
              onNotify('Mapa orientado al Norte Geodésico (Az 0°)');
            }}
            className="w-10 h-10 rounded-full bg-[#191f2f]/90 backdrop-blur-md flex flex-col items-center justify-center shadow-lg active:scale-95 transition-transform border border-[#2f3445]"
          >
            <span className="font-stitch-mono text-[9px] font-bold text-[#ffb4ab] leading-none">N</span>
            <Navigation className="w-4 h-4 text-[#4cd7f6]" />
          </button>

          <div className="bg-[#191f2f]/85 backdrop-blur-md px-2 py-1 rounded flex flex-col items-end shadow-md border border-[#242a3a]">
            <span className="font-stitch-mono text-[10px] text-[#bcc9cd]">
              1:{scaleDenom.toLocaleString('en-US')} · {scaleMeters}m
            </span>
            <div className="w-16 h-1 bg-[#2f3445] mt-0.5 flex">
              <div className="w-1/2 h-full bg-[#dde2f8]" />
              <div className="w-1/2 h-full bg-[#242a3a]" />
            </div>
          </div>
        </div>

        {/* Left Floating GIS Tool Rail */}
        <div className="absolute top-3 left-3 w-10 bg-[#151b2b]/92 backdrop-blur-xl rounded-xl flex flex-col items-center py-1 gap-1 z-10 shadow-xl border border-[#242a3a]">
          <button
            type="button"
            aria-label="Capas"
            onClick={() => {
              setShowAdjacent((prev) => !prev);
              onNotify(showAdjacent ? 'Capa colindantes oculta' : 'Capa catastral colindante visible');
            }}
            className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
              showAdjacent ? 'text-[#4cd7f6] bg-[#242a3a]/70' : 'text-[#bcc9cd] hover:text-[#dde2f8]'
            }`}
          >
            <Layers className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Importar"
            onClick={onOpenParcel}
            className="w-8 h-8 rounded flex items-center justify-center text-[#bcc9cd] hover:text-[#dde2f8] active:bg-[#242a3a] transition-colors"
            title="Ir a exportación / gestión de parcela"
          >
            <FileDown className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Medir"
            onClick={() => {
              setMeasureMode((prev) => !prev);
              onNotify(!measureMode ? 'Regla activada · Diagonal V1–V3: 50.42 m' : 'Regla desactivada');
            }}
            className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
              measureMode ? 'text-[#ffb95f] bg-[#242a3a]' : 'text-[#bcc9cd] hover:text-[#dde2f8]'
            }`}
          >
            <Ruler className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Centrar GPS"
            onClick={() => {
              setZoomScale(1);
              onCenterGps();
            }}
            className="w-8 h-8 rounded flex items-center justify-center text-[#4edea3] hover:text-[#6ffbbe] active:bg-[#242a3a] transition-colors"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        </div>

        {/* Right Floating Zoom & Layer Controls */}
        <div className="absolute bottom-40 right-3 flex flex-col gap-1.5 z-10">
          <button
            type="button"
            onClick={() => {
              setSatelliteOn((s) => !s);
              onNotify(satelliteOn ? 'Vista Vector CAD Oscuro activada' : 'Ortofoto Satelital activada');
            }}
            className={`w-10 h-10 rounded-xl backdrop-blur-xl flex items-center justify-center shadow-lg active:scale-95 transition-transform border border-[#242a3a] ${
              satelliteOn ? 'bg-[#151b2b]/90 text-[#4cd7f6]' : 'bg-[#242a3a] text-[#ffb95f]'
            }`}
          >
            <Satellite className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            className="w-10 h-10 rounded-xl bg-[#151b2b]/90 backdrop-blur-xl flex items-center justify-center text-[#dde2f8] hover:text-[#4cd7f6] shadow-lg active:scale-95 transition-transform border border-[#242a3a]"
          >
            <Plus className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="w-10 h-10 rounded-xl bg-[#151b2b]/90 backdrop-blur-xl flex items-center justify-center text-[#dde2f8] hover:text-[#4cd7f6] shadow-lg active:scale-95 transition-transform border border-[#242a3a]"
          >
            <Minus className="w-5 h-5" />
          </button>
        </div>

        {/* Bottom Selected Parcel Telemetry Card */}
        <div className="absolute bottom-3 inset-x-3 z-20">
          <div className="bg-[#191f2f]/95 backdrop-blur-xl rounded-xl p-3 shadow-2xl flex flex-col gap-2 border border-[#2f3445]/80">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#06b6d4] animate-pulse" />
                <span className="font-stitch-headline text-[18px] font-semibold text-[#dde2f8]">
                  {parcel.code}
                </span>
                <span className="bg-[#242a3a] text-[#4cd7f6] font-stitch-mono text-[9.5px] px-1.5 py-0.5 rounded font-bold uppercase">
                  {parcel.zoneTag}
                </span>
              </div>
              <span className="font-stitch-mono text-[10.5px] text-[#bcc9cd]">
                {gnssFix.isLiveHardware
                  ? `${gnssFix.lat.toFixed(5)}°, ${gnssFix.lng.toFixed(5)}°`
                  : parcel.geoCenterText}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 bg-[#080e1d]/85 p-2 rounded">
              <div className="flex flex-col">
                <span className="text-[9.5px] text-[#869397] uppercase tracking-wider">Superficie</span>
                <span className="font-stitch-mono text-[13.5px] text-[#dde2f8] font-semibold">
                  {parcel.areaGraficaM2.toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
                  <span className="text-[10.5px] text-[#869397]">m²</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9.5px] text-[#869397] uppercase tracking-wider">Perímetro</span>
                <span className="font-stitch-mono text-[13.5px] text-[#dde2f8] font-semibold">
                  {parcel.perimeterM.toFixed(2)} <span className="text-[10.5px] text-[#869397]">m</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9.5px] text-[#869397] uppercase tracking-wider">Linderos</span>
                <span className="font-stitch-mono text-[13.5px] text-[#4edea3] font-semibold">
                  {parcel.vertices.length} Vértices
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => onStakeVertex(parcel.vertices[0]?.id || 'V-01')}
                className="h-11 px-3 rounded bg-[#242a3a] text-[#dde2f8] hover:bg-[#33394a] flex items-center justify-center transition-colors"
                title="Ir directo a Replanteo RTK"
              >
                <Share2 className="w-4 h-4 text-[#4cd7f6]" />
              </button>
              <button
                type="button"
                onClick={onOpenParcel}
                className="flex-1 h-11 bg-[#06b6d4] hover:bg-[#4cd7f6] text-[#003640] font-stitch-headline text-[12.5px] uppercase tracking-wider rounded font-bold flex items-center justify-center gap-1.5 transition-colors shadow-md"
              >
                <span>Abrir Parcela</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
