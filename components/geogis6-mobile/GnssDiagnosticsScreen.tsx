'use client';

import React, { useState } from 'react';
import {
  BluetoothConnected,
  Crosshair,
  Pencil,
  Radio,
  RefreshCw,
  Satellite,
  Sliders,
  Smartphone,
  Timer,
  X,
} from 'lucide-react';
import {
  CONSTELLATION_SUMMARIES,
  GNSS_SATELLITES,
  type GnssReceiverMode,
  type SatellitePoint,
} from './data/fieldData';

interface GnssDiagnosticsScreenProps {
  receiverMode: GnssReceiverMode;
  antennaHeightM: number;
  rtkReconverging: boolean;
  onChangeReceiver: (mode: GnssReceiverMode) => void;
  onChangeAntennaHeight: (meters: number) => void;
  onRestartRtk: () => void;
  onNotify: (msg: string) => void;
}

export default function GnssDiagnosticsScreen({
  receiverMode,
  antennaHeightM,
  rtkReconverging,
  onChangeReceiver,
  onChangeAntennaHeight,
  onRestartRtk,
  onNotify,
}: GnssDiagnosticsScreenProps) {
  const [skyMode, setSkyMode] = useState<'polar' | 'bars'>('polar');
  const [maskAngleDeg, setMaskAngleDeg] = useState<10 | 15 | 20>(15);
  const [selectedSat, setSelectedSat] = useState<SatellitePoint | null>(GNSS_SATELLITES[3]);
  const [showAntennaModal, setShowAntennaModal] = useState(false);
  const [draftHeight, setDraftHeight] = useState(antennaHeightM.toFixed(3));

  const isExternal = receiverMode === 'external_rtk';
  const usedCount = isExternal
    ? maskAngleDeg === 10
      ? 34
      : maskAngleDeg === 15
        ? 32
        : 27
    : 19;
  const visibleCount = isExternal ? 46 : 28;
  const dopMetrics = isExternal
    ? { pdop: '1.1', hdop: '0.7', vdop: '0.9', tdop: '0.8' }
    : { pdop: '1.9', hdop: '1.2', vdop: '1.5', tdop: '1.3' };

  const handleCycleMask = () => {
    const next: 10 | 15 | 20 = maskAngleDeg === 15 ? 20 : maskAngleDeg === 20 ? 10 : 15;
    setMaskAngleDeg(next);
    onNotify(`Máscara de elevación GNSS ajustada a ${next}°`);
  };

  const handleSaveAntenna = () => {
    const parsed = Number.parseFloat(draftHeight);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 10) {
      onChangeAntennaHeight(parsed);
      setShowAntennaModal(false);
      onNotify(`Altura de jalón actualizada a ${parsed.toFixed(3)} m`);
    }
  };

  return (
    <div className="flex flex-col w-full h-full overflow-y-auto no-scrollbar px-3 py-2 space-y-2.5 text-[#dde2f8] bg-[#0d1322] select-none relative">
      {/* Solution & DOP Precision Strip */}
      <section className="w-full bg-[#151b2b] rounded-xl p-2 shadow-md flex flex-col gap-1.5 border border-[#242a3a]">
        <div className="flex items-center justify-between gap-1">
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${
              rtkReconverging
                ? 'bg-[#e79400]/25 text-[#ffb95f]'
                : isExternal
                  ? 'bg-[#00a572]/20 text-[#4edea3]'
                  : 'bg-[#06b6d4]/20 text-[#4cd7f6]'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full animate-ping ${
                rtkReconverging ? 'bg-[#ffb95f]' : isExternal ? 'bg-[#4edea3]' : 'bg-[#4cd7f6]'
              }`}
            />
            <span className="font-stitch-headline text-[11px] tracking-wider font-bold">
              {rtkReconverging ? 'RTK FLOAT' : isExternal ? 'RTK FIXED' : 'DGNSS L1/L5'}
            </span>
          </div>

          <div className="flex items-center gap-1 bg-[#2f3445] px-2 py-0.5 rounded text-[#dde2f8]">
            <Satellite className="w-3.5 h-3.5 text-[#4cd7f6]" />
            <span className="font-stitch-mono text-[10.5px] tracking-tight">
              <span className="text-[#4edea3] font-bold">{usedCount}</span>/{visibleCount} USADOS
            </span>
          </div>

          <div className="flex items-center gap-1 bg-[#242a3a] px-2 py-0.5 rounded">
            <Timer className="w-3 h-3 text-[#ffb95f]" />
            <span className="font-stitch-mono text-[10.5px] text-[#dde2f8] font-semibold">
              {isExternal ? '1.0s LAT' : '0.4s INT'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1 pt-0.5">
          {[
            { k: 'PDOP', v: dopMetrics.pdop, col: 'text-[#4edea3]' },
            { k: 'HDOP', v: dopMetrics.hdop, col: 'text-[#4edea3]' },
            { k: 'VDOP', v: dopMetrics.vdop, col: 'text-[#4edea3]' },
            { k: 'TDOP', v: dopMetrics.tdop, col: 'text-[#4cd7f6]' },
          ].map((m) => (
            <div key={m.k} className="bg-[#191f2f] px-1.5 py-1 rounded text-center">
              <span className="block text-[9.5px] text-[#bcc9cd] leading-none uppercase">{m.k}</span>
              <span className={`font-stitch-mono text-[13.5px] font-bold ${m.col}`}>{m.v}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Polar Skyplot Interactive Viewport */}
      <section className="w-full bg-[#151b2b] rounded-xl p-2 shadow-md flex flex-col items-center relative overflow-hidden border border-[#242a3a]">
        <div className="w-full flex items-center justify-between pb-1">
          <div className="flex items-center gap-1.5">
            <Crosshair className="w-4 h-4 text-[#4cd7f6]" />
            <span className="font-stitch-headline text-[11.5px] font-bold uppercase text-[#dde2f8] tracking-wider">
              Skyplot 360° / IMU Level
            </span>
          </div>
          <div className="flex items-center bg-[#191f2f] rounded p-0.5 font-stitch-mono text-[10px]">
            <button
              type="button"
              onClick={() => setSkyMode('polar')}
              className={`px-2 py-0.5 rounded transition-colors ${
                skyMode === 'polar' ? 'bg-[#4cd7f6] text-[#003640] font-bold shadow-sm' : 'text-[#bcc9cd]'
              }`}
            >
              POLAR
            </button>
            <button
              type="button"
              onClick={() => setSkyMode('bars')}
              className={`px-2 py-0.5 rounded transition-colors ${
                skyMode === 'bars' ? 'bg-[#4cd7f6] text-[#003640] font-bold shadow-sm' : 'text-[#bcc9cd]'
              }`}
            >
              BARRAS
            </button>
          </div>
        </div>

        {skyMode === 'polar' ? (
          <>
            <div className="relative w-[218px] h-[218px] my-1 flex items-center justify-center">
              <svg className="absolute inset-0 w-full h-full text-[#3d494c]" viewBox="0 0 240 240">
                <circle cx="120" cy="120" fill="#151b2b" r="114" stroke="#3d494c" strokeDasharray="3 3" strokeWidth="1.5" />
                <circle cx="120" cy="120" fill="#191f2f" r="98" stroke="#4cd7f6" strokeOpacity="0.3" strokeWidth="1.2" />
                <circle cx="120" cy="120" fill="none" r="66" stroke="#3d494c" strokeWidth="1" />
                <circle cx="120" cy="120" fill="none" r="34" stroke="#3d494c" strokeWidth="1" />
                <circle cx="120" cy="120" fill="#4cd7f6" fillOpacity="0.6" r="4" />
                <line stroke="#3d494c" strokeWidth="1" x1="120" x2="120" y1="6" y2="234" />
                <line stroke="#3d494c" strokeWidth="1" x1="6" x2="234" y1="120" y2="120" />
                <line stroke="#3d494c" strokeDasharray="2 4" strokeWidth="0.75" x1="39" x2="201" y1="39" y2="201" />
                <line stroke="#3d494c" strokeDasharray="2 4" strokeWidth="0.75" x1="201" x2="39" y1="39" y2="201" />
                <text fill="#869397" fontFamily="var(--font-stitch-mono), monospace" fontSize="8" x="122" y="103">
                  60°
                </text>
                <text fill="#869397" fontFamily="var(--font-stitch-mono), monospace" fontSize="8" x="122" y="70">
                  30°
                </text>
                <text fill="#869397" fontFamily="var(--font-stitch-mono), monospace" fontSize="8" x="122" y="27">
                  {maskAngleDeg}°
                </text>
                <text fill="#4cd7f6" fontFamily="var(--font-stitch-headline), sans-serif" fontSize="11" fontWeight="bold" textAnchor="middle" x="120" y="15">
                  N
                </text>
                <text fill="#869397" fontFamily="var(--font-stitch-headline), sans-serif" fontSize="10" fontWeight="bold" textAnchor="middle" x="228" y="124">
                  E
                </text>
                <text fill="#869397" fontFamily="var(--font-stitch-headline), sans-serif" fontSize="10" fontWeight="bold" textAnchor="middle" x="120" y="233">
                  S
                </text>
                <text fill="#869397" fontFamily="var(--font-stitch-headline), sans-serif" fontSize="10" fontWeight="bold" textAnchor="middle" x="12" y="124">
                  W
                </text>
              </svg>

              {GNSS_SATELLITES.map((sat) => {
                const isFiltered = sat.elevationDeg < maskAngleDeg;
                const isSel = selectedSat?.prn === sat.prn;
                const pillClass = isFiltered
                  ? 'bg-[#2f3445] text-[#869397]'
                  : sat.status === 'tracked'
                    ? 'bg-[#e79400] text-[#563400]'
                    : 'bg-[#4edea3] text-[#003824]';
                return (
                  <button
                    key={sat.prn}
                    type="button"
                    onClick={() => setSelectedSat(sat)}
                    className="absolute flex flex-col items-center cursor-pointer transition-transform hover:scale-110"
                    style={{ top: `${sat.topPx}px`, left: `${sat.leftPx}px` }}
                  >
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center font-stitch-mono text-[8.5px] font-bold shadow-sm ${pillClass} ${
                        isSel ? 'ring-2 ring-[#4cd7f6] scale-110' : ''
                      }`}
                    >
                      {sat.prn}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedSat && (
              <div className="w-full bg-[#191f2f] px-2.5 py-1 rounded flex items-center justify-between font-stitch-mono text-[10px] mb-1">
                <span className="text-[#4cd7f6] font-bold">
                  {selectedSat.prn} · {selectedSat.constellation}
                </span>
                <span className="text-[#bcc9cd]">
                  El {selectedSat.elevationDeg}° · Az {selectedSat.azimuthDeg}°
                </span>
                <span className="text-[#4edea3] font-bold">{selectedSat.snrDbHz} dB-Hz</span>
              </div>
            )}

            <div className="w-full flex items-center justify-around pt-0.5 font-stitch-mono text-[10px]">
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#4edea3] inline-block" />
                <span className="text-[#dde2f8] font-medium">Fijo ({usedCount})</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#e79400] inline-block" />
                <span className="text-[#dde2f8] font-medium">Rastreo (14)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2f3445] inline-block" />
                <span className="text-[#869397] font-medium">&lt;{maskAngleDeg}° Filtro</span>
              </div>
            </div>
          </>
        ) : (
          <div className="w-full py-2 px-1 space-y-1.5">
            {GNSS_SATELLITES.slice(0, 10).map((sat) => {
              const isFiltered = sat.elevationDeg < maskAngleDeg;
              const barColor = isFiltered
                ? '#3d494c'
                : sat.constellation === 'GPS'
                  ? '#4cd7f6'
                  : sat.constellation === 'GLONASS'
                    ? '#ffb95f'
                    : sat.constellation === 'GALILEO'
                      ? '#4edea3'
                      : '#06b6d4';
              return (
                <div key={sat.prn} className="flex items-center gap-2 font-stitch-mono text-[10px]">
                  <span className="w-8 font-bold text-[#dde2f8]">{sat.prn}</span>
                  <span className="w-10 text-[#869397] text-[9px]">{sat.elevationDeg}° EL</span>
                  <div className="flex-1 h-2.5 bg-[#080e1d] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.round((sat.snrDbHz / 52) * 100))}%`,
                        backgroundColor: barColor,
                      }}
                    />
                  </div>
                  <span className="w-12 text-right font-semibold text-[#4cd7f6]">{sat.snrDbHz} dB</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Constellations SNR Monitor */}
      <section className="w-full grid grid-cols-2 gap-2">
        {CONSTELLATION_SUMMARIES.map((c) => {
          const effectiveUsed = isExternal ? c.used : Math.max(3, Math.round(c.used * 0.6));
          const effectiveSnr = isExternal ? c.avgSnr : c.avgSnr - 5;
          return (
            <div key={c.id} className="bg-[#151b2b] rounded-lg p-2 flex flex-col gap-1 shadow-sm border border-[#242a3a]">
              <div className="flex items-center justify-between">
                <span className="font-stitch-headline text-[10.5px] font-bold" style={{ color: c.accentHex }}>
                  {c.label}
                </span>
                <span className="font-stitch-mono text-[10.5px] text-[#4edea3] font-bold">
                  {effectiveUsed}/{c.visible}
                </span>
              </div>
              <div className="w-full bg-[#2f3445] h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${isExternal ? c.percent : c.percent - 20}%`, backgroundColor: c.barHex }}
                />
              </div>
              <div className="flex items-center justify-between font-stitch-mono text-[9.5px] text-[#bcc9cd] pt-0.5">
                <span>{c.bands}</span>
                <span className="text-[#dde2f8] font-semibold">{effectiveSnr} dB-Hz</span>
              </div>
            </div>
          );
        })}
      </section>

      {/* GNSS Hardware Source & Antenna Configuration */}
      <section className="w-full bg-[#151b2b] rounded-xl p-2 shadow-md flex flex-col gap-2 border border-[#242a3a]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <BluetoothConnected className="w-4 h-4 text-[#4cd7f6]" />
            <span className="font-stitch-headline text-[11.5px] font-bold uppercase text-[#dde2f8]">
              Receptor GNSS Activo
            </span>
          </div>
          <span className="font-stitch-mono text-[10px] bg-[#00a572]/20 text-[#4edea3] px-1.5 py-0.5 rounded font-semibold">
            {isExternal ? 'SOUTH INNO7' : 'ANDROID GNSS'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1 bg-[#191f2f] p-1 rounded-lg">
          <button
            type="button"
            onClick={() => onChangeReceiver('external_rtk')}
            className={`font-stitch-mono text-[10px] py-1.5 px-1.5 rounded flex items-center justify-center gap-1 transition-colors ${
              isExternal
                ? 'bg-[#2f3445] text-[#4cd7f6] font-bold shadow-sm'
                : 'text-[#bcc9cd] hover:text-[#dde2f8]'
            }`}
          >
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">BT Ext (RTK 1408ch)</span>
          </button>
          <button
            type="button"
            onClick={() => onChangeReceiver('internal_l1l5')}
            className={`font-stitch-mono text-[10px] py-1.5 px-1.5 rounded flex items-center justify-center gap-1 transition-colors ${
              !isExternal
                ? 'bg-[#2f3445] text-[#4cd7f6] font-bold shadow-sm'
                : 'text-[#bcc9cd] hover:text-[#dde2f8]'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Android L1+L5 Interno</span>
          </button>
        </div>

        <div className="grid grid-cols-5 gap-1.5 pt-0.5">
          <div className="col-span-3 bg-[#191f2f] p-2 rounded flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="font-stitch-mono text-[9.5px] text-[#bcc9cd] uppercase">NTRIP CORS</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#4edea3]" />
            </div>
            <div className="truncate font-stitch-mono text-[11px] text-[#dde2f8] font-semibold">
              SIRGAS-RTCM 3.2
            </div>
            <div className="flex items-center justify-between font-stitch-mono text-[9.5px] text-[#bcc9cd]">
              <span>MSM5 · 100% OK</span>
              <span className="text-[#4edea3] font-bold">4.2 KB/s</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setDraftHeight(antennaHeightM.toFixed(3));
              setShowAntennaModal(true);
            }}
            className="col-span-2 bg-[#191f2f] hover:bg-[#242a3a] p-2 rounded flex flex-col justify-between text-left transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="font-stitch-mono text-[9.5px] text-[#bcc9cd] uppercase">Alt. Jalón</span>
              <Pencil className="w-3 h-3 text-[#4cd7f6]" />
            </div>
            <div className="font-stitch-mono text-[16px] text-[#dde2f8] font-bold tracking-tight">
              {antennaHeightM.toFixed(3)}{' '}
              <span className="text-[10px] text-[#bcc9cd] font-normal">m</span>
            </div>
            <span className="text-[9.5px] text-[#bcc9cd] truncate">Medido a base antena</span>
          </button>
        </div>
      </section>

      {/* Quick Actions */}
      <div className="w-full grid grid-cols-2 gap-2 pt-0.5 pb-1">
        <button
          type="button"
          onClick={handleCycleMask}
          className="h-10 bg-[#242a3a] hover:bg-[#33394a] active:scale-95 transition text-[#dde2f8] rounded font-stitch-headline text-[11.5px] font-bold uppercase flex items-center justify-center gap-1.5 shadow-sm"
        >
          <Sliders className="w-4 h-4 text-[#ffb95f]" />
          <span>Mask {maskAngleDeg}° NMEA</span>
        </button>
        <button
          type="button"
          onClick={onRestartRtk}
          className="h-10 bg-[#4cd7f6] hover:bg-[#acedff] active:scale-95 transition text-[#003640] rounded font-stitch-headline text-[11.5px] font-bold uppercase flex items-center justify-center gap-1.5 shadow-md"
        >
          <RefreshCw className={`w-4 h-4 ${rtkReconverging ? 'animate-spin' : ''}`} />
          <span>{rtkReconverging ? 'Fijando...' : 'Reiniciar RTK'}</span>
        </button>
      </div>

      {showAntennaModal && (
        <div className="absolute inset-0 z-50 bg-[#0d1322]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full bg-[#191f2f] rounded-xl p-4 shadow-2xl flex flex-col gap-3 border border-[#2f3445]">
            <div className="flex items-center justify-between">
              <h3 className="font-stitch-headline text-[15px] font-semibold">Altura de Antena / Jalón (m)</h3>
              <button
                type="button"
                onClick={() => setShowAntennaModal(false)}
                className="w-7 h-7 rounded bg-[#242a3a] text-[#bcc9cd] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {[1.8, 2.0, 2.2].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDraftHeight(preset.toFixed(3))}
                  className="flex-1 py-1.5 rounded bg-[#242a3a] hover:bg-[#33394a] font-stitch-mono text-[11px] text-[#4cd7f6] font-bold"
                >
                  {preset.toFixed(2)} m
                </button>
              ))}
            </div>
            <input
              type="number"
              step="0.005"
              value={draftHeight}
              onChange={(e) => setDraftHeight(e.target.value)}
              className="w-full bg-[#080e1d] border border-[#2f3445] rounded-lg px-3 py-2 font-stitch-mono text-[15px] font-bold text-[#dde2f8]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAntennaModal(false)}
                className="flex-1 h-10 rounded bg-[#242a3a] font-stitch-headline text-[12px] font-bold uppercase"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveAntenna}
                className="flex-1 h-10 rounded bg-[#4cd7f6] text-[#003640] font-stitch-headline text-[12px] font-bold uppercase"
              >
                Guardar Altura
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
