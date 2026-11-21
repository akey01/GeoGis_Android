'use client';

import React from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Compass,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  MapPin,
  Network,
  Waypoints,
} from 'lucide-react';
import {
  buildCivilCadTxt,
  buildParcelDxf,
  buildParcelKml,
  formatCoord,
  type CrsMode,
  type FieldParcel,
} from './data/fieldData';

interface ParcelDetailScreenProps {
  parcel: FieldParcel;
  crsMode: CrsMode;
  selectedVertexId: string;
  isDemoMode: boolean;
  onToggleCrs: () => void;
  onBackToMap: () => void;
  onStakeVertex: (vertexId: string) => void;
  onNotify: (msg: string) => void;
}

function triggerLocalDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export default function ParcelDetailScreen({
  parcel,
  crsMode,
  selectedVertexId,
  isDemoMode,
  onToggleCrs,
  onBackToMap,
  onStakeVertex,
  onNotify,
}: ParcelDetailScreenProps) {
  const areaDelta = parcel.areaGraficaM2 - parcel.areaDocumentalM2;
  const areaDeltaPct = parcel.areaDocumentalM2 > 0 ? (areaDelta / parcel.areaDocumentalM2) * 100 : 0;

  const handleExportCivilCad = () => {
    const txt = buildCivilCadTxt(parcel, crsMode);
    triggerLocalDownload(
      txt,
      `PARCELA_${parcel.code}_${crsMode.toUpperCase()}.txt`,
      'text/plain;charset=utf-8'
    );
    onNotify(`CivilCAD (.txt) exportado en ${crsMode === 'regven' ? 'REGVEN 19N' : 'PSAD56 19N'}`);
  };

  const handleExportDxf = () => {
    const dxf = buildParcelDxf(parcel, crsMode);
    triggerLocalDownload(
      dxf,
      `PARCELA_${parcel.code}_${crsMode.toUpperCase()}.dxf`,
      'application/dxf'
    );
    onNotify(`Polígono AutoCAD (.dxf) generado en ${crsMode === 'regven' ? 'REGVEN 19N' : 'PSAD56 19N'}`);
  };

  const handleExportKmlOrPro = () => {
    if (isDemoMode) {
      onNotify('Memoria Descriptiva (.pdf) bloqueada en Modo Demo (RBAC)');
      return;
    }
    const kml = buildParcelKml(parcel);
    triggerLocalDownload(kml, `PARCELA_${parcel.code}.kml`, 'application/vnd.google-earth.kml+xml');
    onNotify(`Parcela ${parcel.code} exportada a Google Earth (.kml)`);
  };

  return (
    <div className="flex flex-col w-full h-full justify-between overflow-y-auto no-scrollbar p-2 gap-1.5 text-[#dde2f8] bg-[#0d1322] select-none">
      {/* TOP CONTEXT BAR */}
      <div className="min-h-[42px] shrink-0 flex items-center justify-between px-2 py-1 bg-[#191f2f] rounded-lg border border-[#242a3a]">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            aria-label="Volver al mapa"
            onClick={onBackToMap}
            className="w-8 h-8 rounded flex items-center justify-center bg-[#242a3a] text-[#dde2f8] hover:text-[#4cd7f6] active:scale-95 transition-transform shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex flex-col min-w-0">
            <h2 className="font-stitch-headline text-[13px] font-semibold leading-tight tracking-tight uppercase truncate text-[#dde2f8]">
              {parcel.title}{' '}
              <span className="text-[#bcc9cd] font-normal">({parcel.location})</span>
            </h2>
            <span className="font-stitch-mono text-[9px] text-[#ffb95f] leading-none tracking-widest uppercase mt-0.5">
              {parcel.sector}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleCrs}
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#2f3445] hover:bg-[#33394a] transition-colors text-left shrink-0"
        >
          <ArrowLeftRight className="w-3.5 h-3.5 text-[#4cd7f6]" />
          <div className="flex flex-col">
            <span className="font-stitch-mono text-[10px] text-[#4cd7f6] font-bold leading-none tracking-tight">
              {crsMode === 'regven' ? `REGVEN ${parcel.huso}N` : `PSAD56 ${parcel.huso}N`}
            </span>
            <span
              className={`font-stitch-mono text-[8px] font-medium leading-none mt-0.5 ${
                crsMode === 'regven' ? 'text-[#4edea3]' : 'text-[#ffb95f]'
              }`}
            >
              {crsMode === 'regven' ? 'RIGIDA02 Activo' : 'LA CANOA AL-318'}
            </span>
          </div>
        </button>
      </div>

      {/* CABIDA & POLYGON QA/QC CARD */}
      <div className="bg-[#191f2f] rounded-xl p-2 flex flex-col gap-1.5 shrink-0 shadow-sm border border-[#242a3a]">
        <div className="grid grid-cols-12 gap-1.5 items-center">
          <div className="col-span-8 flex items-baseline justify-between bg-[#080e1d] px-2 py-1.5 rounded">
            <div>
              <span className="text-[8.5px] text-[#bcc9cd] block leading-none uppercase">ÁREA DOCUMENTAL</span>
              <span className="font-stitch-mono text-[13.5px] text-[#dde2f8] font-medium">
                {parcel.areaDocumentalM2.toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
                <span className="text-[10px] text-[#bcc9cd]">m²</span>
              </span>
            </div>
            <span className="text-[#869397] text-[10px] font-bold">vs</span>
            <div className="text-right">
              <span className="text-[8.5px] text-[#bcc9cd] block leading-none uppercase">ÁREA GRÁFICA</span>
              <span className="font-stitch-mono text-[13.5px] text-[#4cd7f6] font-bold">
                {parcel.areaGraficaM2.toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
                <span className="text-[10px] text-[#bcc9cd]">m²</span>
              </span>
            </div>
          </div>

          <div className="col-span-4 bg-[#00a572]/20 rounded py-1.5 px-1 flex flex-col items-center justify-center text-center">
            <span className="font-stitch-mono text-[9px] text-[#4edea3] font-bold leading-tight">
              Δ {areaDelta.toFixed(2)} m² ({areaDeltaPct.toFixed(2)}%)
            </span>
            <span className="font-stitch-headline text-[8px] text-[#4edea3] tracking-tighter uppercase font-semibold mt-0.5">
              TOLERANCIA ±{parcel.toleranceM2.toFixed(1)}m²
            </span>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-1.5 items-stretch">
          <div className="col-span-5 bg-[#080e1d] rounded relative overflow-hidden flex items-center justify-center min-h-[82px]">
            <svg className="w-full h-full p-1 select-none" viewBox="0 0 160 90">
              <line stroke="#1f293d" strokeDasharray="2,2" strokeWidth="0.8" x1="10" x2="150" y1="45" y2="45" />
              <line stroke="#1f293d" strokeDasharray="2,2" strokeWidth="0.8" x1="80" x2="80" y1="5" y2="85" />
              <polygon
                fill="#4cd7f6"
                fillOpacity="0.14"
                points={parcel.vertices.map((v) => `${v.miniX},${v.miniY}`).join(' ')}
                stroke="#4cd7f6"
                strokeWidth="1.6"
              />
              {parcel.vertices.map((v, idx) => {
                const isSel = v.id === selectedVertexId;
                const nextV = parcel.vertices[(idx + 1) % parcel.vertices.length];
                const midX = nextV ? (v.miniX + nextV.miniX) / 2 : v.miniX;
                const midY = nextV ? (v.miniY + nextV.miniY) / 2 : v.miniY;
                return (
                  <g key={v.id} className="cursor-pointer" onClick={() => onStakeVertex(v.id)}>
                    {parcel.vertices.length <= 8 && v.segmentLengthToNext > 0 && nextV && (
                      <text
                        fill="#4edea3"
                        fontFamily="var(--font-stitch-mono), monospace"
                        fontSize="6"
                        textAnchor="middle"
                        x={midX}
                        y={midY - 2}
                      >
                        {v.segmentLengthToNext.toFixed(1)}m
                      </text>
                    )}
                    <circle cx={v.miniX} cy={v.miniY} fill={isSel ? '#ffb95f' : '#06b6d4'} r={isSel ? 3.8 : 2.8} />
                    <text
                      fill={isSel ? '#ffb95f' : '#dde2f8'}
                      fontFamily="var(--font-stitch-mono), monospace"
                      fontSize="7.2"
                      fontWeight="700"
                      x={v.miniX + (v.miniX < 80 ? -9 : 5)}
                      y={v.miniY + (v.miniY > 45 ? 8 : -2)}
                    >
                      {v.shortId}
                    </text>
                  </g>
                );
              })}
            </svg>
            <span className="absolute bottom-1 right-1 font-stitch-mono text-[8px] text-[#bcc9cd] bg-[#0d1322]/85 px-1 rounded">
              {parcel.orientationLabel}
            </span>
          </div>

          <div className="col-span-7 flex flex-col justify-between gap-1">
            <div className="bg-[#080e1d] px-2 py-1 rounded flex justify-between items-center">
              <span className="text-[10px] text-[#bcc9cd] uppercase">Perímetro Total</span>
              <span className="font-stitch-mono text-[11px] text-[#dde2f8] font-bold">
                {parcel.perimeterM.toFixed(2)} m
              </span>
            </div>
            <div className="bg-[#080e1d] px-2 py-1 rounded flex justify-between items-center">
              <span className="text-[10px] text-[#bcc9cd] uppercase">Cierre Lineal</span>
              <div className="text-right">
                <span className="font-stitch-mono text-[11px] text-[#4edea3] font-bold">
                  {parcel.linearClosureM.toFixed(3)} m
                </span>
                <span className="font-stitch-mono text-[8.5px] text-[#4edea3]/80 block leading-none">
                  Precisión {parcel.precisionRatio}
                </span>
              </div>
            </div>
            <div className="bg-[#080e1d] px-2 py-1 rounded flex justify-between items-center">
              <span className="text-[10px] text-[#bcc9cd] uppercase">Error Angular</span>
              <span className="font-stitch-mono text-[11px] text-[#4edea3] font-bold">
                {parcel.angularError}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* COMPACT VERTEX COORDINATE TABLE */}
      <div className="bg-[#191f2f] rounded-xl p-2 flex flex-col flex-1 min-h-0 justify-between shadow-sm border border-[#242a3a]">
        <div className="flex items-center justify-between pb-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <Network className="w-4 h-4 text-[#4cd7f6]" />
            <span className="font-stitch-headline text-[11px] font-bold uppercase tracking-wider text-[#dde2f8]">
              Vértices Georreferenciados ({parcel.vertices.length})
            </span>
          </div>
          <span className="font-stitch-mono text-[9px] text-[#4edea3] bg-[#080e1d] px-1.5 py-0.5 rounded uppercase">
            {crsMode === 'regven' ? 'Elipsoide GRS80' : 'Elipsoide Hayford'}
          </span>
        </div>

        <div className="grid grid-cols-12 gap-0.5 bg-[#2f3445] px-1.5 py-1 rounded text-[9px] font-stitch-mono text-[#bcc9cd] shrink-0">
          <div className="col-span-1 font-bold text-center">ID</div>
          <div className="col-span-3 text-right">ESTE (m)</div>
          <div className="col-span-3 text-right">NORTE (m)</div>
          <div className="col-span-2 text-right">COTA</div>
          <div className="col-span-2 text-left pl-1">CÓDIGO</div>
          <div className="col-span-1 text-center">STK</div>
        </div>

        <div className="flex flex-col gap-1 overflow-y-auto no-scrollbar flex-1 pt-1">
          {parcel.vertices.map((v) => {
            const isSel = v.id === selectedVertexId;
            const este = crsMode === 'regven' ? v.esteRegven : v.estePsad56;
            const norte = crsMode === 'regven' ? v.norteRegven : v.nortePsad56;
            return (
              <div
                key={v.id}
                className={`grid grid-cols-12 gap-0.5 items-center px-1.5 py-1.5 rounded text-[10.5px] font-stitch-mono transition-colors ${
                  isSel ? 'bg-[#242a3a] ring-1 ring-[#4cd7f6]/50' : 'bg-[#080e1d]'
                }`}
              >
                <div className="col-span-1 font-bold text-[#4cd7f6] text-center">{v.shortId}</div>
                <div className="col-span-3 text-right text-[#dde2f8]">{formatCoord(este)}</div>
                <div className="col-span-3 text-right text-[#dde2f8]">{formatCoord(norte)}</div>
                <div className="col-span-2 text-right text-[#bcc9cd]">{v.cota.toFixed(2)}</div>
                <div className="col-span-2 text-left pl-1 truncate text-[#ffb95f]">{v.code}</div>
                <div className="col-span-1 flex justify-center">
                  <button
                    type="button"
                    aria-label={`Replantear ${v.shortId}`}
                    onClick={() => onStakeVertex(v.id)}
                    className={`w-6 h-6 rounded flex items-center justify-center active:scale-90 transition-transform ${
                      isSel
                        ? 'bg-[#06b6d4] text-[#003640]'
                        : 'bg-[#2f3445] text-[#dde2f8] hover:text-[#4cd7f6]'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2x2 ACTION GRID + STAKE SHORTCUT */}
      <div className="grid grid-cols-2 gap-1.5 shrink-0 pt-0.5">
        <button
          type="button"
          onClick={handleExportCivilCad}
          className="h-11 px-2.5 rounded-lg bg-[#242a3a] hover:bg-[#33394a] active:scale-[0.98] transition-all flex items-center justify-between"
        >
          <div className="flex items-center gap-1.5 text-left">
            <FileSpreadsheet className="w-4 h-4 text-[#4edea3] shrink-0" />
            <div className="flex flex-col">
              <span className="font-stitch-headline text-[11px] font-bold uppercase tracking-tight text-[#dde2f8] leading-none">
                CivilCAD
              </span>
              <span className="font-stitch-mono text-[8.5px] text-[#bcc9cd] leading-tight mt-0.5">
                Exportar (.txt)
              </span>
            </div>
          </div>
          <Download className="w-3.5 h-3.5 text-[#bcc9cd]" />
        </button>

        <button
          type="button"
          onClick={handleExportDxf}
          className="h-11 px-2.5 rounded-lg bg-[#242a3a] hover:bg-[#33394a] active:scale-[0.98] transition-all flex items-center justify-between"
        >
          <div className="flex items-center gap-1.5 text-left">
            <Waypoints className="w-4 h-4 text-[#4cd7f6] shrink-0" />
            <div className="flex flex-col">
              <span className="font-stitch-headline text-[11px] font-bold uppercase tracking-tight text-[#dde2f8] leading-none">
                AutoCAD
              </span>
              <span className="font-stitch-mono text-[8.5px] text-[#bcc9cd] leading-tight mt-0.5">
                Polígono (.dxf)
              </span>
            </div>
          </div>
          <Download className="w-3.5 h-3.5 text-[#bcc9cd]" />
        </button>

        <button
          type="button"
          onClick={handleExportKmlOrPro}
          className="h-11 px-2.5 rounded-lg bg-[#242a3a] hover:bg-[#33394a] active:scale-[0.98] transition-all flex items-center justify-between"
        >
          <div className="flex items-center gap-1.5 text-left">
            <FileText className="w-4 h-4 text-[#ffb95f] shrink-0" />
            <div className="flex flex-col">
              <div className="flex items-center gap-1">
                <span className="font-stitch-headline text-[11px] font-bold uppercase tracking-tight text-[#dde2f8] leading-none">
                  {isDemoMode ? 'Memoria' : 'KML Earth'}
                </span>
                <span className="bg-[#2f3445] text-[#dde2f8] text-[7.5px] font-stitch-mono px-1 rounded uppercase">
                  PRO
                </span>
              </div>
              <span className="font-stitch-mono text-[8.5px] text-[#bcc9cd] leading-tight mt-0.5">
                {isDemoMode ? 'Catastro (.pdf)' : 'Exportar (.kml)'}
              </span>
            </div>
          </div>
          {isDemoMode ? (
            <Lock className="w-3.5 h-3.5 text-[#bcc9cd]" />
          ) : (
            <Download className="w-3.5 h-3.5 text-[#bcc9cd]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => onStakeVertex(selectedVertexId)}
          className="h-11 px-2.5 rounded-lg bg-[#06b6d4] hover:bg-[#4cd7f6] text-[#003640] active:scale-[0.98] transition-all flex items-center justify-between shadow-md"
        >
          <div className="flex items-center gap-1.5 text-left">
            <Compass className="w-4 h-4 shrink-0" />
            <div className="flex flex-col">
              <span className="font-stitch-headline text-[11px] uppercase tracking-tight font-bold leading-none">
                Replantear
              </span>
              <span className="font-stitch-mono text-[8.5px] opacity-90 leading-tight mt-0.5">
                Navegación RTK
              </span>
            </div>
          </div>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
