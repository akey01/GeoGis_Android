'use client';

import React, { useState, useMemo } from 'react';
import { Parcel } from '@/lib/store';
import {
  processParcelForSummary,
  generateParcelSummaryText,
  generateParcelSummaryCSV,
  exportParcelSummaryExcel,
  formatDecimals
} from '@/lib/parcel-summary';
import {
  X,
  Copy,
  Check,
  Download,
  FileText,
  Table as TableIcon,
  Layers,
  Ruler,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Info
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface ParcelSummaryModalProps {
  parcels: Parcel[];
  isOpen: boolean;
  onClose: () => void;
  projectTitle?: string;
}

export default function ParcelSummaryModal({
  parcels,
  isOpen,
  onClose,
  projectTitle = 'PROYECTO',
}: ParcelSummaryModalProps) {
  const [viewMode, setViewMode] = useState<'table' | 'text'>('table');
  const [copied, setCopied] = useState(false);

  // Procesamiento de datos de parcelas
  const processedData = useMemo(() => {
    return parcels.map((p, idx) => processParcelForSummary(p, idx));
  }, [parcels]);

  // Cálculos acumulados
  const stats = useMemo(() => {
    const totalArea = processedData.reduce((acc, p) => acc + p.area, 0);
    const totalPerim = processedData.reduce((acc, p) => acc + p.perimetro, 0);
    const totalHa = totalArea / 10000;
    return {
      count: processedData.length,
      totalArea,
      totalPerim,
      totalHa,
    };
  }, [processedData]);

  // Texto ASCII según formato solicitado
  const asciiText = useMemo(() => {
    return generateParcelSummaryText(parcels, projectTitle);
  }, [parcels, projectTitle]);

  if (!isOpen) return null;

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(asciiText);
      setCopied(true);
      toast.success('¡Tabla copiada al portapapeles!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('No se pudo copiar al portapapeles');
    }
  };

  const handleDownloadTxt = () => {
    try {
      const blob = new Blob([asciiText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `TABLA_RESUMEN_PARCELAS_${projectTitle.replace(/\s+/g, '_').toUpperCase()}_${Date.now()}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Archivo de texto (.txt) descargado');
    } catch (err) {
      toast.error('Error al descargar archivo de texto');
    }
  };

  const handleDownloadCsv = () => {
    try {
      const csv = generateParcelSummaryCSV(parcels);
      const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `CONTROL_PARCELAS_${projectTitle.replace(/\s+/g, '_').toUpperCase()}_${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Archivo CSV (Excel) descargado');
    } catch (err) {
      toast.error('Error al descargar CSV');
    }
  };

  const handleDownloadExcel = async () => {
    try {
      await exportParcelSummaryExcel(parcels, projectTitle);
      toast.success('Libro de Excel (.xlsx) generado y descargado');
    } catch (err: any) {
      console.error('Error al exportar Excel:', err);
      toast.error(err?.message || 'Error al exportar a Excel');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 md:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 w-full max-w-6xl max-h-[92vh] rounded-3xl overflow-hidden shadow-2xl shadow-black/80 flex flex-col">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="p-4 md:p-5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0 text-emerald-400">
              <TableIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  GeoGIS6 · Control Catastral
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {projectTitle}
                </span>
              </div>
              <h2 className="text-base md:text-lg font-bold text-white tracking-wide truncate">
                TABLA RESUMEN DE CONTROL DE PARCELAS
              </h2>
            </div>
          </div>

          {/* Toggle de vistas */}
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-950/60 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${viewMode === 'table'
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Tabla Gráfica</span>
              </button>
              <button
                onClick={() => setViewMode('text')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${viewMode === 'text'
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Formato Texto (ASCII)</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors border border-slate-700/50"
              title="Cerrar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Tarjetas de métricas acumuladas ─────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 md:px-6 bg-slate-950/40 border-b border-slate-800/80">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Total Parcelas</div>
              <div className="text-sm font-bold text-white font-mono">{stats.count}</div>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
              <Ruler className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Área Total</div>
              <div className="text-sm font-bold text-emerald-400 font-mono">
                {formatDecimals(stats.totalArea)} <span className="text-[10px] text-slate-400 font-sans">m²</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Info className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Superficie (ha)</div>
              <div className="text-sm font-bold text-indigo-300 font-mono">
                {stats.totalHa.toFixed(4)} <span className="text-[10px] text-slate-400 font-sans">ha</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Perímetro Total</div>
              <div className="text-sm font-bold text-amber-300 font-mono">
                {formatDecimals(stats.totalPerim)} <span className="text-[10px] text-slate-400 font-sans">m</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Contenido Principal ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {viewMode === 'table' ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-inner">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900/90 border-b border-slate-800 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                      <th className="py-3 px-4 border-r border-slate-800/60">ID Parcela</th>
                      <th className="py-3 px-4 border-r border-slate-800/60">Propietario / Titular</th>
                      <th className="py-3 px-4 border-r border-slate-800/60">Ubicación / Sector</th>
                      <th className="py-3 px-4 text-right border-r border-slate-800/60">Área (m²)</th>
                      <th className="py-3 px-4 text-right border-r border-slate-800/60">Perímetro (m)</th>
                      <th className="py-3 px-4">Observaciones / Acciones Pendientes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {processedData.map((item, idx) => (
                      <tr
                        key={idx}
                        className="hover:bg-slate-800/40 transition-colors group"
                      >
                        <td className="py-3 px-4 font-mono font-bold text-emerald-400 border-r border-slate-800/60 whitespace-nowrap">
                          {item.id}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-200 border-r border-slate-800/60 min-w-[200px]">
                          {item.propietario}
                        </td>
                        <td className="py-3 px-4 text-slate-300 border-r border-slate-800/60 min-w-[200px]">
                          {item.ubicacion}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-300 border-r border-slate-800/60 whitespace-nowrap">
                          {formatDecimals(item.area)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-300 border-r border-slate-800/60 whitespace-nowrap">
                          {formatDecimals(item.perimetro)}
                        </td>
                        <td className="py-3 px-4 text-slate-400 min-w-[280px]">
                          <span className={item.observaciones.toLowerCase().includes('requiere') || item.observaciones.toLowerCase().includes('discrepancia') || item.observaciones.toLowerCase().includes('pendiente') ? 'text-amber-300/90 font-medium' : 'text-slate-400'}>
                            {item.observaciones}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-900/95 border-t-2 border-slate-700 font-semibold text-xs text-white">
                      <td colSpan={3} className="py-3 px-4 text-right uppercase tracking-wider text-slate-400">
                        Totales del Proyecto:
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {formatDecimals(stats.totalArea)} m²
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-300">
                        {formatDecimals(stats.totalPerim)} m
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                        {stats.count} parcelas registradas
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono">Salida de texto exacto (139 columnas)</span>
                <span className="text-[11px] text-emerald-400 font-mono">Compatible con memorias descriptivas y reportes ASCII</span>
              </div>
              <div className="relative">
                <pre className="p-4 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-[11px] leading-relaxed text-emerald-300/90 overflow-x-auto selection:bg-emerald-500/30 whitespace-pre">
                  {asciiText}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer de Acciones ─────────────────────────────────────────── */}
        <div className="p-4 md:px-6 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyText}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-bold transition-all shadow-sm"
              title="Copiar formato de texto de la tabla al portapapeles"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? '¡Copiado!' : 'Copiar Formato Texto'}
            </button>

            <button
              onClick={handleDownloadTxt}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-xl text-xs font-bold transition-all shadow-sm"
              title="Descargar archivo .txt con la tabla de control"
            >
              <Download className="w-4 h-4" />
              Descargar TXT
            </button>

            <button
              onClick={handleDownloadExcel}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 hover:text-emerald-200 border border-emerald-500/40 rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950/40"
              title="Descargar libro de Microsoft Excel (.xlsx) con resumen y desglose de vértices"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              Descargar Excel (.xlsx)
            </button>

            <button
              onClick={handleDownloadCsv}
              className="flex items-center gap-1.5 px-3 py-2 bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 hover:text-violet-300 border border-violet-500/30 rounded-xl text-xs font-bold transition-all shadow-sm"
              title="Descargar como archivo CSV compatible"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Descargar CSV
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-xl text-xs font-semibold transition-colors"
              title="Imprimir tabla de control"
            >
              <Printer className="w-4 h-4" />
              Imprimir
            </button>

            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors border border-slate-700"
            >
              Cerrar
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
