/* ParcelList Component - Enhanced with SVG preview, humanized data & compact actions */
'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { toast } from 'react-hot-toast';
import {
  Map as MapIcon,
  Trash2,
  Edit3,
  Layout,
  Check,
  X,
  Printer,
  FileText,
  ChevronDown,
  Layers,
  Ruler,
  Square,
  Globe,
  Table,
  FileSpreadsheet,
  Search,
  XCircle,
  Mountain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileService } from '@/lib/file-service';
import { exportParcelToDXF, exportProjectPolygonsToDXF, exportMultiParcelDXF, exportIntegratedMultiParcelDXF, exportUnifiedParcelDXF } from '@/lib/exportDxf';
import { Parcel } from '@/lib/store';
import ParcelEditModal from './ParcelEditModal';
import ParcelSummaryModal from './ParcelSummaryModal';
import { exportParcelSummaryExcel } from '@/lib/parcel-summary';
import { saveProject } from '@/app/actions/projectActions';
import { hasPermission, isDemoRole } from '@/src/types/auth';
import { useContourStore } from '@/src/components/map/contours/useContourStore';

// ── Utilidades de formato ────────────────────────────────────────────────────
function formatArea(m2: number | undefined | null): string {
  if (!m2 && m2 !== 0) return '—';
  const abs = Math.abs(m2);
  if (abs >= 10_000) {
    return `${(abs / 10_000).toLocaleString('es-VE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ha`;
  }
  return `${abs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

function formatPerim(ml: number | undefined | null): string {
  if (!ml && ml !== 0) return '—';
  return `${Math.abs(ml).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ml`;
}

// ── SVG Miniatura del Polígono ───────────────────────────────────────────────
interface MinimapProps {
  puntos: Array<{ x?: number; y?: number; este?: number; norte?: number; result?: any }>;
  color?: string;
  opacity?: number;
  size?: number;
}

function ParcelMinimap({ puntos, color = '#10b981', opacity = 0.35, size = 72 }: MinimapProps) {
  const pts = useMemo(() => {
    return puntos
      .map((p) => {
        const x = p.x ?? p.este ?? p.result?.este ?? p.result?.x ?? null;
        const y = p.y ?? p.norte ?? p.result?.norte ?? p.result?.y ?? null;
        return x !== null && y !== null ? { x: Number(x), y: Number(y) } : null;
      })
      .filter(Boolean) as { x: number; y: number }[];
  }, [puntos]);

  if (pts.length < 2) {
    return (
      <div
        className="rounded-lg bg-slate-800/60 border border-slate-700/50 flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <Square className="w-5 h-5 text-slate-600" />
      </div>
    );
  }

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const PAD = 6;
  const inner = size - PAD * 2;
  const scale = Math.min(inner / rangeX, inner / rangeY);

  const svgPts = pts.map((p) => ({
    sx: PAD + (p.x - minX) * scale,
    sy: size - PAD - (p.y - minY) * scale,
  }));

  const poly = svgPts.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ');

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="rounded-lg bg-slate-800/60 border border-slate-700/50 shrink-0"
      aria-label="Miniatura del polígono de la parcela"
    >
      <polygon
        points={poly}
        fill={color}
        fillOpacity={opacity}
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Vértices */}
      {svgPts.map((p, i) => (
        <circle key={i} cx={p.sx} cy={p.sy} r="2" fill={color} opacity="0.8" />
      ))}
    </svg>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────
export default function ParcelList() {
  const {
    savedParcels,
    deleteParcel,
    renameParcel,
    viewParcelResults,
    centerOnParcel,
    updateParcelMetadata,
    unifySelectedParcels,
    user,
    projectMeta,
    hatchColor,
    hatchOpacity,
    huso,
    direction,
    routine,
    method,
  } = useAppStore();

  const effectiveDirection =
    routine === 'ploteo' || method === 'rigida02' ? 'canoa_regven' : direction;

  const visibleContourIds = useContourStore((s) => s.visibleParcelIds);
  const loadingContourIds = useContourStore((s) => s.loadingParcelIds);
  const toggleParcelContours = useContourStore((s) => s.toggleParcelContours);
  const openPrintModalForParcel = useContourStore((s) => s.openPrintModalForParcel);
  const removeParcelContours = useContourStore((s) => s.removeParcelContours);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exportingDxf, setExportingDxf] = useState<string | null>(null);
  const [exportingKml, setExportingKml] = useState<string | null>(null);
  const [exportingTxt, setExportingTxt] = useState<string | null>(null);
  const [editingParcel, setEditingParcel] = useState<Parcel | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summaryParcels, setSummaryParcels] = useState<Parcel[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (savedParcels.length === 0) {
      setSelectedIds([]);
      setEditingId(null);
      setEditingParcel(null);
      setOpenActionsId(null);
      setSummaryModalOpen(false);
      setSummaryParcels([]);
      setSearchQuery('');
    }
  }, [savedParcels.length]);

  // ── Roles (memoizados) ────────────────────────────────────────────────────
  const isRestricted = useMemo(
    () => isDemoRole(user?.rol) || user?.rol === 'junior' || user?.rol === 'operador_campo',
    [user?.rol]
  );
  const canExportDxf = useMemo(() => hasPermission(user?.rol, 'export_dxf', user?.roleConfig?.capabilities), [user?.rol, user?.roleConfig]);
  const canExportCsv = useMemo(() => hasPermission(user?.rol, 'export_csv', user?.roleConfig?.capabilities), [user?.rol, user?.roleConfig]);
  const canExportPdf = useMemo(() => hasPermission(user?.rol, 'export_pdf', user?.roleConfig?.capabilities), [user?.rol, user?.roleConfig]);

  // ── Filtrado por búsqueda ─────────────────────────────────────────────────
  const filteredParcels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return savedParcels;
    return savedParcels.filter((p) => {
      const haystack = [
        p.nombre,
        p.propietario,
        p.municipio,
        p.parroquia,
        p.estado,
        p.ubicacionSector,
        p.cedulaCat,
        p.rif,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [savedParcels, searchQuery]);

  // ── Estadísticas del proyecto ─────────────────────────────────────────────
  const projectStats = useMemo(() => {
    const total = savedParcels.length;
    const totalArea = savedParcels.reduce((sum, p) => sum + Math.abs(p.area ?? 0), 0);
    const totalPerim = savedParcels.reduce((sum, p) => sum + Math.abs(p.perim ?? 0), 0);
    return { total, totalArea, totalPerim };
  }, [savedParcels]);

  // ── Save to DB ────────────────────────────────────────────────────────────
  const persistProject = useCallback(async () => {
    try {
      const { savedParcels, projectMeta, currentProjectId } = useAppStore.getState();
      const projectData = { meta: projectMeta, parcels: savedParcels };
      const result = await saveProject(projectMeta.nombre, JSON.stringify(projectData), currentProjectId || undefined);
      if (result.error) throw new Error(result.error);
      toast.success('Proyecto guardado exitosamente');
    } catch (err: any) {
      toast.error(`Error al guardar: ${err.message}`);
    }
  }, []);

  // ── Export DXF ────────────────────────────────────────────────────────────
  const handleExportDxf = useCallback(async (parcel: Parcel) => {
    useAppStore.getState().setExportingState(true, 'DXF', 0);
    setExportingDxf(parcel.id);
    try {
      const progressInterval = setInterval(() => {
        useAppStore.getState().setExportingState(true, 'DXF', useAppStore.getState().pdfProgress + 5);
      }, 200);
      await exportParcelToDXF(parcel);
      clearInterval(progressInterval);
      useAppStore.getState().setExportingState(true, 'DXF', 100);
    } catch (err: any) {
      toast.error(`Error al exportar DXF: ${err.message}`);
    } finally {
      setTimeout(() => {
        setExportingDxf(null);
        useAppStore.getState().setExportingState(false);
      }, 1000);
    }
  }, []);

  // ── Export KML ────────────────────────────────────────────────────────────
  const handleExportKml = useCallback(async (parcel: Parcel) => {
    useAppStore.getState().setExportingState(true, 'KML', 0);
    setExportingKml(parcel.id);
    try {
      const progressInterval = setInterval(() => {
        useAppStore.getState().setExportingState(true, 'KML', useAppStore.getState().pdfProgress + 5);
      }, 200);

      const payload = {
        parcelName: parcel.nombre || 'Parcela',
        puntos: parcel.puntos,
        metadata: { projectName: parcel.nombre || 'Parcela' },
      };

      const res = await fetch('/api/export-kml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Error del servidor: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${parcel.nombre || 'parcel'}_${Date.now()}.kmz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      clearInterval(progressInterval);
      useAppStore.getState().setExportingState(true, 'KML', 100);
      toast.success('Archivo KML (KMZ) descargado');
    } catch (err: any) {
      toast.error(`Error al exportar KML: ${err.message}`);
    } finally {
      setTimeout(() => {
        setExportingKml(null);
        useAppStore.getState().setExportingState(false);
      }, 1000);
    }
  }, []);

  // ── Edición de nombre ─────────────────────────────────────────────────────
  const startEditing = useCallback((id: string, name: string) => {
    if (isRestricted) return;
    setEditingId(id);
    setTempName(name);
  }, [isRestricted]);

  const saveName = useCallback((id: string, name: string) => {
    if (name.trim()) renameParcel(id, name);
    setEditingId(null);
  }, [renameParcel]);

  // ── Selección múltiple ────────────────────────────────────────────────────
  const toggleSelection = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);
  }, []);

  const handleExportSelectedDxf = useCallback(() => {
    if (selectedIds.length === 0) return;
    const selected = savedParcels.filter((p) => selectedIds.includes(p.id));
    const name = projectMeta.nombre || 'PROYECTO';
    exportProjectPolygonsToDXF(name, selected);
  }, [selectedIds, savedParcels, projectMeta.nombre]);

  const handleExportIntegratedMultiDxf = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const selected = savedParcels.filter((p) => selectedIds.includes(p.id));
    const name = projectMeta.nombre || 'PROYECTO_INTEGRADO';
    await exportIntegratedMultiParcelDXF(name, selected);
  }, [selectedIds, savedParcels, projectMeta.nombre]);

  const handleExportMultiDxf = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const selected = savedParcels.filter((p) => selectedIds.includes(p.id));
    const name = projectMeta.nombre || 'PROYECTO';
    await exportMultiParcelDXF(name, selected);
  }, [selectedIds, savedParcels, projectMeta.nombre]);

  const handleUnifySelected = useCallback(() => {
    if (selectedIds.length < 2) {
      toast.error('Selecciona al menos 2 parcelas para unificar.');
      return;
    }
    try {
      const name = projectMeta.nombre ? `UNIFICADA_${projectMeta.nombre}` : undefined;
      const unified = unifySelectedParcels(selectedIds, name);
      if (!unified) {
        toast.error('Se requieren al menos 2 polígonos cerrados válidos para unificar.');
        return;
      }
      setSelectedIds([]);
      toast.success(
        `Parcelas unificadas en "${unified.nombre}" (${unified.puntos.length} vértices externos, ${formatArea(unified.area)})`
      );
    } catch (err: any) {
      toast.error(err?.message || 'No se pudieron unificar las parcelas');
    }
  }, [selectedIds, projectMeta.nombre, unifySelectedParcels]);

  const handleExportUnifiedDxf = useCallback(async () => {
    if (selectedIds.length < 2) {
      toast.error('Selecciona al menos 2 parcelas para exportar unificadas.');
      return;
    }
    const selected = savedParcels.filter((p) => selectedIds.includes(p.id));
    const name = projectMeta.nombre || 'PARCELA_UNIFICADA';
    useAppStore.getState().setExportingState(true, 'DXF', 20);
    try {
      await exportUnifiedParcelDXF(name, selected);
    } finally {
      useAppStore.getState().setExportingState(false);
    }
  }, [selectedIds, savedParcels, projectMeta.nombre]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`¿Eliminar las ${selectedIds.length} parcelas seleccionadas?`)) {
      selectedIds.forEach((id) => {
        deleteParcel(id);
        removeParcelContours(id);
      });
      setSelectedIds([]);
    }
  }, [selectedIds, deleteParcel, removeParcelContours]);

  const handleExportSelectedExcel = useCallback(() => {
    if (selectedIds.length === 0) return;
    const selected = savedParcels.filter((p) => selectedIds.includes(p.id));
    const name = projectMeta.nombre || 'PROYECTO';
    try {
      exportParcelSummaryExcel(selected, name);
      toast.success(`Exportadas ${selected.length} parcelas a Excel (.xlsx)`);
    } catch (err: any) {
      toast.error(err?.message || 'Error al exportar a Excel');
    }
  }, [selectedIds, savedParcels, projectMeta.nombre]);

  // ── Abrir Modal Resumen de Control de Parcelas ────────────────────────────
  const handleOpenSummary = useCallback((selectedOnly: boolean = false) => {
    if (!canExportPdf) {
      toast.error('Su rol no tiene permiso para generar Fichas/Reportes de Resumen.');
      return;
    }
    if (selectedOnly && selectedIds.length > 0) {
      const subset = savedParcels.filter((p) => selectedIds.includes(p.id));
      setSummaryParcels(subset);
    } else {
      setSummaryParcels(savedParcels);
    }
    setSummaryModalOpen(true);
  }, [selectedIds, savedParcels, canExportPdf]);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (savedParcels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
        <Layout className="w-10 h-10 text-slate-700 mb-4" />
        <p className="text-sm font-medium text-slate-400 text-center">
          Tu historial está vacío
        </p>
        <p className="text-xs text-slate-600 mt-1">
          Las parcelas procesadas aparecerán aquí
        </p>
      </div>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* ── Header de proyecto ─────────────────────────────────────────── */}
      <div className="px-1 pb-1 border-b border-slate-800/60 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
              Parcelas en Memoria
            </h3>
            <p className="text-xs font-semibold text-slate-300 truncate max-w-[160px]" title={projectMeta.nombre || 'Sin nombre'}>
              {projectMeta.nombre || 'Proyecto sin nombre'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">
              <Layers className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] font-bold text-emerald-400">{projectStats.total}</span>
            </div>
            {projectStats.totalArea > 0 && (
              <div className="flex items-center gap-1">
                <Ruler className="w-2.5 h-2.5 text-slate-500" />
                <span className="text-[9px] font-mono text-slate-500">{formatArea(projectStats.totalArea)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Botón principal para generar el Resumen de Parcelas del Proyecto */}
        <button
          onClick={() => handleOpenSummary(false)}
          title="Generar Tabla Resumen de Control de Parcelas del Proyecto"
          className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-gradient-to-r from-emerald-500/15 via-teal-500/15 to-emerald-600/15 hover:from-emerald-500/25 hover:via-teal-500/25 hover:to-emerald-600/25 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/60 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-sm group"
        >
          <Table className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
          <span>Resumen de Parcelas</span>
        </button>
      </div>

      {/* ── Barra de búsqueda ──────────────────────────────────────────── */}
      <div className="relative group/search">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 group-focus-within/search:text-emerald-400 transition-colors pointer-events-none" />
        <input
          id="parcel-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar parcela…"
          className="w-full bg-slate-900/60 border border-slate-700/60 hover:border-slate-600 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none transition-all"
          aria-label="Buscar parcelas por nombre, propietario, municipio o parroquia"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
            title="Limpiar búsqueda"
            aria-label="Limpiar búsqueda"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ── Acciones de selección múltiple ────────────────────────────── */}
      {selectedIds.length > 0 && !isRestricted && (
        <div className="flex items-center gap-1 flex-wrap px-1">
          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mr-1">
            {selectedIds.length} sel.
          </span>
          <button
            onClick={() => handleOpenSummary(true)}
            title="Crear Tabla Resumen solo de las parcelas seleccionadas"
            className="flex items-center gap-1 px-2 py-1 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 hover:text-teal-300 rounded text-[10px] font-bold uppercase tracking-wider transition-colors border border-teal-500/20"
          >
            <Table className="w-3 h-3" />
            Resumen ({selectedIds.length})
          </button>
          <button
            onClick={handleExportSelectedExcel}
            title="Exportar tabla resumen y coordenadas de las parcelas seleccionadas a Excel (.xlsx)"
            className="flex items-center gap-1 px-2 py-1 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 rounded text-[10px] font-bold uppercase tracking-wider transition-colors border border-emerald-500/30 shadow-sm"
          >
            <FileSpreadsheet className="w-3 h-3 text-emerald-400" />
            Excel ({selectedIds.length})
          </button>
          <button
            onClick={handleExportIntegratedMultiDxf}
            title="Exportar plano DXF completo integrado con cuadros de coordenadas por parcela"
            className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 rounded text-[10px] font-bold uppercase tracking-wider transition-colors border border-emerald-500/20"
          >
            <Printer className="w-3 h-3" />
            DXF Integrado
          </button>
          {selectedIds.length >= 2 && (
            <>
              <button
                onClick={handleUnifySelected}
                title="Unificar parcelas seleccionadas conservando únicamente los puntos externos del perímetro"
                className="flex items-center gap-1 px-2 py-1 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 hover:text-cyan-200 rounded text-[10px] font-bold uppercase tracking-wider transition-colors border border-cyan-500/30"
              >
                <Layers className="w-3 h-3 text-cyan-400" />
                Unificar ({selectedIds.length})
              </button>
              <button
                onClick={handleExportUnifiedDxf}
                title="Exportar plano DXF del polígono unificado solo con puntos externos"
                className="flex items-center gap-1 px-2 py-1 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 hover:text-sky-200 rounded text-[10px] font-bold uppercase tracking-wider transition-colors border border-sky-500/30"
              >
                <Printer className="w-3 h-3 text-sky-400" />
                DXF Unificado
              </button>
            </>
          )}
          <button
            onClick={handleExportSelectedDxf}
            title="Exportar solo las líneas poligonales en DXF sin plantilla"
            className="flex items-center gap-1 px-2 py-1 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-300 rounded text-[10px] font-bold uppercase tracking-wider transition-colors border border-indigo-500/20"
          >
            <FileText className="w-3 h-3" />
            DXF Lote
          </button>
          <button
            onClick={handleExportMultiDxf}
            title="Exportar archivos DXF individuales empaquetados en ZIP"
            className="flex items-center gap-1 px-2 py-1 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 rounded text-[10px] font-bold uppercase tracking-wider transition-colors border border-amber-500/20"
          >
            <FileText className="w-3 h-3" />
            ZIP
          </button>
          <button
            onClick={handleDeleteSelected}
            className="flex items-center gap-1 px-2 py-1 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 rounded text-[10px] font-bold uppercase tracking-wider transition-colors border border-red-500/20"
          >
            <Trash2 className="w-3 h-3" />
            ({selectedIds.length})
          </button>
        </div>
      )}

      {/* ── Lista de parcelas ─────────────────────────────────────────── */}
      <div className="space-y-2.5">
        {filteredParcels.length === 0 && searchQuery.trim() !== '' ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
            <Search className="w-7 h-7 text-slate-700 mb-2" />
            <p className="text-xs font-medium text-slate-500 text-center">
              Sin resultados para &quot;<span className="text-emerald-400">{searchQuery}</span>&quot;
            </p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-[10px] text-slate-600 hover:text-emerald-400 underline transition-colors"
            >
              Limpiar búsqueda
            </button>
          </div>
        ) : null}
        {filteredParcels.map((parcel) => {
          const parcelColor = parcel.hatchColor || hatchColor || '#10b981';
          const parcelOpacity = parcel.hatchOpacity ?? hatchOpacity ?? 0.35;
          const isSelected = selectedIds.includes(parcel.id);
          const isExportingThisDxf = exportingDxf === parcel.id;
          const isExportingThisKml = exportingKml === parcel.id;
          const actionsOpen = openActionsId === parcel.id;
          const hasContoursVisible = visibleContourIds.includes(parcel.id);
          const isLoadingContours = loadingContourIds.includes(parcel.id);
          const canComputeContours = (parcel.puntos?.length ?? 0) >= 3 && (parcel.geometryType ?? 'cerrada') !== 'puntos';

          return (
            <div
              key={parcel.id}
              onClick={() => {
                viewParcelResults(parcel.id);
                centerOnParcel(parcel.id);
              }}
              className={cn(
                'group border rounded-2xl transition-all shadow-lg cursor-pointer',
                isSelected
                  ? 'bg-slate-800/80 border-emerald-500/50 shadow-emerald-900/20'
                  : 'bg-slate-900/40 border-slate-800 hover:border-emerald-500/30 hover:bg-slate-800/50'
              )}
            >
              <div className="p-3 space-y-2.5">

                {/* ── Fila superior: checkbox + minimap + nombre + acciones ── */}
                <div className="flex items-start gap-2.5">

                  {/* Checkbox */}
                  <div
                    onClick={(e) => toggleSelection(parcel.id, e)}
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 mt-0.5',
                      isSelected
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-slate-600 hover:border-emerald-500 text-transparent'
                    )}
                  >
                    <Check className="w-3 h-3" />
                  </div>

                  {/* SVG miniatura del polígono */}
                  <ParcelMinimap
                    puntos={parcel.puntos || []}
                    color={parcelColor}
                    opacity={parcelOpacity}
                    size={60}
                  />

                  {/* Nombre + metadatos */}
                  <div className="flex-1 min-w-0">
                    {editingId === parcel.id ? (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={tempName}
                          onChange={(e) => setTempName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveName(parcel.id, tempName);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="bg-slate-950 border border-emerald-500/50 rounded px-2 py-0.5 text-xs text-white w-full outline-none"
                          autoFocus
                        />
                        <button onClick={() => saveName(parcel.id, tempName)} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-1 text-red-500 hover:bg-red-500/10 rounded">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span
                        onDoubleClick={() => startEditing(parcel.id, parcel.nombre)}
                        className="block text-xs font-semibold text-slate-200 hover:text-emerald-400 select-none transition-colors truncate"
                        title={`${parcel.nombre || 'Parcela sin nombre'} — doble clic para renombrar`}
                      >
                        {parcel.nombre || 'Parcela sin nombre'}
                      </span>
                    )}

                    {/* Área y Perímetro */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-mono font-bold text-emerald-400">
                        {formatArea(parcel.area)}
                      </span>
                      {parcel.perim && (
                        <span className="text-[9px] text-slate-500 font-mono">
                          · {formatPerim(parcel.perim)}
                        </span>
                      )}
                    </div>

                    {/* Badge de vértices */}
                    {parcel.puntos?.length > 0 && (
                      <span className="inline-block mt-0.5 px-1.5 py-0.5 bg-slate-800 rounded text-[8px] font-bold text-slate-500 border border-slate-700">
                        {parcel.puntos.length} vértices
                      </span>
                    )}
                  </div>
                </div>

                {/* ── Fila de acciones ────────────────────────────────────── */}
                <div
                  className="flex items-center gap-1 justify-end flex-wrap"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Curvas de Nivel Satelitales (por parcela individual) */}
                  <button
                    onClick={async () => {
                      const wasVisible = hasContoursVisible;
                      await toggleParcelContours(parcel, huso, effectiveDirection);
                      if (!wasVisible) {
                        viewParcelResults(parcel.id);
                        centerOnParcel(parcel.id);
                      }
                    }}
                    disabled={isLoadingContours || !canComputeContours}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md transition-all border shrink-0 disabled:opacity-40 disabled:cursor-not-allowed',
                      hasContoursVisible
                        ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-sm shadow-amber-500/20'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 border-slate-700'
                    )}
                    title={
                      !canComputeContours
                        ? 'Requiere poligonal cerrada (mínimo 3 vértices)'
                        : hasContoursVisible
                          ? 'Ocultar curvas de nivel de esta parcela'
                          : 'Calcular y proyectar curvas de nivel satelitales sobre esta parcela'
                    }
                  >
                    <Mountain className={cn('w-3 h-3', isLoadingContours && 'animate-pulse text-amber-400')} />
                    <span className="text-[10px] font-extrabold uppercase tracking-wider">
                      {isLoadingContours ? 'DEM...' : 'Curvas'}
                    </span>
                  </button>

                  {/* Edit Metadata */}
                  {!isRestricted && (
                    <button
                      onClick={() => setEditingParcel(parcel)}
                      className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-400 rounded-md transition-colors border border-slate-700 shrink-0"
                      title="Editar Datos de Mensura"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span className="text-[10px] font-extrabold uppercase tracking-wider">Edit</span>
                    </button>
                  )}

                  {/* Menú compacto: exportaciones ───────────────────────── */}
                  <div className="relative">
                    <button
                      onClick={() => setOpenActionsId(actionsOpen ? null : parcel.id)}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-md transition-colors border shrink-0",
                        actionsOpen
                          ? "bg-slate-700 text-slate-100 border-slate-500"
                          : "bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 border-slate-700"
                      )}
                      title="Exportar datos de la parcela"
                    >
                      <FileText className="w-3 h-3" />
                      <span className="text-[10px] font-extrabold uppercase tracking-wider">Exportar</span>
                      <ChevronDown className={cn('w-2.5 h-2.5 transition-transform duration-200', actionsOpen && 'rotate-180')} />
                    </button>
                    {actionsOpen && (
                      <div className="absolute right-0 top-full mt-1 z-[100] bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl shadow-black/70 min-w-[210px]">
                        {/* Cabecera */}
                        <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-1.5">
                          <div className="w-1 h-1 rounded-full bg-emerald-500" />
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Formato de exportación</span>
                        </div>

                        {/* TXT Proyectado (UTM con Altitud Satelital) */}
                        <button
                          onClick={async () => {
                            setOpenActionsId(null);
                            setExportingTxt(`${parcel.id}-utm`);
                            try {
                              await FileService.exportTXT(parcel.puntos, parcel.nombre || 'Parcela');
                            } finally {
                              setExportingTxt(null);
                            }
                          }}
                          disabled={exportingTxt === `${parcel.id}-utm`}
                          className="flex items-center gap-2.5 w-full px-3 py-2.5 hover:bg-slate-800/80 transition-colors group border-b border-slate-800/50 disabled:opacity-50"
                        >
                          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-amber-500/15 border border-amber-500/30 shrink-0">
                            <FileText className={cn("w-3 h-3 text-amber-400", exportingTxt === `${parcel.id}-utm` && "animate-pulse")} />
                          </div>
                          <div className="flex flex-col text-left">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400 group-hover:text-amber-300 leading-tight">
                              {exportingTxt === `${parcel.id}-utm` ? 'Obteniendo Altitud...' : 'TXT Proyectado (Z Satelital)'}
                            </span>
                            <span className="text-[8px] text-slate-500 font-mono">Punto, Este, Norte, Z (DEM)</span>
                          </div>
                        </button>

                        {/* TXT WGS84 con Altitud Satelital */}
                        <button
                          onClick={async () => {
                            setOpenActionsId(null);
                            setExportingTxt(`${parcel.id}-wgs`);
                            try {
                              await FileService.exportTXT_WGS84(parcel.puntos, parcel.nombre || 'Parcela');
                            } finally {
                              setExportingTxt(null);
                            }
                          }}
                          disabled={exportingTxt === `${parcel.id}-wgs`}
                          className="flex items-center gap-2.5 w-full px-3 py-2.5 hover:bg-slate-800/80 transition-colors group border-b border-slate-800/50 disabled:opacity-50"
                        >
                          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-cyan-500/15 border border-cyan-500/30 shrink-0">
                            <Globe className={cn("w-3 h-3 text-cyan-400", exportingTxt === `${parcel.id}-wgs` && "animate-spin")} />
                          </div>
                          <div className="flex flex-col text-left">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-400 group-hover:text-cyan-300 leading-tight">
                              {exportingTxt === `${parcel.id}-wgs` ? 'Obteniendo Altitud...' : 'TXT WGS84 (Altitud Satelital)'}
                            </span>
                            <span className="text-[8px] text-slate-500 font-mono">Punto, Lat, Lng, Altitud</span>
                          </div>
                        </button>

                        {/* CSV */}
                        <button
                          onClick={async () => {
                            setOpenActionsId(null);
                            setExportingTxt(`${parcel.id}-csv`);
                            try {
                              await FileService.exportCSV(parcel.puntos, parcel.nombre || 'Parcela');
                            } finally {
                              setExportingTxt(null);
                            }
                          }}
                          disabled={exportingTxt === `${parcel.id}-csv`}
                          className="flex items-center gap-2.5 w-full px-3 py-2.5 hover:bg-slate-800/80 transition-colors group border-b border-slate-800/50 disabled:opacity-50"
                        >
                          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-violet-500/15 border border-violet-500/30 shrink-0">
                            <FileText className="w-3 h-3 text-violet-400" />
                          </div>
                          <div className="flex flex-col text-left">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-violet-400 group-hover:text-violet-300 leading-tight">CSV Completo</span>
                            <span className="text-[8px] text-slate-500 font-mono">UTM + Geo + Distancias + Alt</span>
                          </div>
                        </button>

                        {/* KML */}
                        <button
                          onClick={() => { handleExportKml(parcel); setOpenActionsId(null); }}
                          disabled={isExportingThisKml}
                          className="flex items-center gap-2.5 w-full px-3 py-2.5 hover:bg-slate-800/80 transition-colors group border-b border-slate-800/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-500/30 shrink-0">
                            <MapIcon className={cn('w-3 h-3 text-emerald-400', isExportingThisKml && 'animate-pulse')} />
                          </div>
                          <div className="flex flex-col text-left">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 group-hover:text-emerald-300 leading-tight">
                              {isExportingThisKml ? 'Exportando...' : 'KML Google Earth'}
                            </span>
                            <span className="text-[8px] text-slate-500 font-mono">Polígono georreferenciado</span>
                          </div>
                        </button>

                        {/* Imprimir Plano de Curvas de Nivel */}
                        <button
                          onClick={() => {
                            setOpenActionsId(null);
                            openPrintModalForParcel(parcel, huso, effectiveDirection);
                          }}
                          disabled={isLoadingContours || !canComputeContours}
                          className="flex items-center gap-2.5 w-full px-3 py-2.5 hover:bg-slate-800/80 transition-colors group disabled:opacity-45 disabled:cursor-not-allowed"
                          title={
                            !canComputeContours
                              ? 'Requiere poligonal cerrada (mínimo 3 vértices)'
                              : 'Abrir vista previa para imprimir plano de curvas de nivel satelitales'
                          }
                        >
                          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-orange-500/15 border border-orange-500/30 shrink-0">
                            <Printer className={cn('w-3 h-3 text-orange-400', isLoadingContours && 'animate-pulse')} />
                          </div>
                          <div className="flex flex-col text-left">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-orange-400 group-hover:text-orange-300 leading-tight">
                              {isLoadingContours ? 'Calculando DEM...' : 'Plano de Curvas'}
                            </span>
                            <span className="text-[8px] text-slate-500 font-mono">Imprimir Satélite/CAD + PDF</span>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* DXF — permitido incluso para rol Demo (con marca de agua en servidor) ─ */}
                  {canExportDxf && (
                    <button
                      onClick={() => handleExportDxf(parcel)}
                      disabled={isExportingThisDxf}
                      className="flex items-center gap-1 px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 rounded-md transition-all border border-blue-500/20 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Exportar plano DXF profesional"
                    >
                      <Printer className={cn('w-3 h-3', isExportingThisDxf && 'animate-spin')} />
                      <span className="text-[10px] font-extrabold uppercase tracking-wider">
                        {isExportingThisDxf ? '...' : 'DXF'}
                      </span>
                    </button>
                  )}

                  {/* Delete ─────────────────────────────────────────────── */}
                  {!isRestricted && (
                    <button
                      onClick={() => {
                        deleteParcel(parcel.id);
                        removeParcelContours(parcel.id);
                      }}
                      className="p-1.5 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors shrink-0"
                      title="Eliminar parcela"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* ── Editor de hatch (color + opacidad) ────────────────── */}
                <div
                  className="flex items-center gap-2 px-2 py-1 bg-slate-950/20 rounded-lg border border-slate-800/30 w-fit"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="color"
                    value={parcelColor}
                    onChange={(e) => updateParcelMetadata(parcel.id, { hatchColor: e.target.value })}
                    className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                    title="Color del polígono"
                  />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(parcelOpacity * 100)}
                    onChange={(e) => updateParcelMetadata(parcel.id, { hatchOpacity: Number(e.target.value) / 100 })}
                    className="w-14 h-1 accent-emerald-500"
                  />
                  <span className="text-[9px] font-mono text-slate-500 w-6 text-right">
                    {Math.round(parcelOpacity * 100)}%
                  </span>
                </div>

              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de edición */}
      {editingParcel && (
        <ParcelEditModal
          parcel={editingParcel}
          isOpen={!!editingParcel}
          onClose={() => setEditingParcel(null)}
          onSave={persistProject}
        />
      )}

      {/* Modal Resumen de Control de Parcelas */}
      {summaryModalOpen && (
        <ParcelSummaryModal
          parcels={summaryParcels}
          isOpen={summaryModalOpen}
          onClose={() => setSummaryModalOpen(false)}
          projectTitle={projectMeta.nombre || 'PROYECTO'}
        />
      )}
    </div>
  );
}
