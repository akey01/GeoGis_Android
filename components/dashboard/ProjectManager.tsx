'use client';

import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { saveProject, getUserProjects, getProjectContent, deleteProject, deleteAllUserProjects } from '@/app/actions/projectActions';
import { 
  Save, 
  Download, 
  Folder, 
  FileText, 
  Trash2, 
  RefreshCw, 
  Plus, 
  HardDrive,
  Cloud,
  Check,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { exportProjectPolygonsToDXF } from '@/lib/exportDxf';
import ParcelSummaryModal from './ParcelSummaryModal';
import { Table } from 'lucide-react';

export default function ProjectManager() {
  const { projectMeta, savedParcels, results, importProject, setProjectMeta, user, currentProjectId, setCurrentProjectId, clearProjectWorkspace } = useAppStore();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingPolygons, setExportingPolygons] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  
  const isViewer = user?.rol === 'viewer';
  const isJunior = user?.rol === 'junior';
  const isRestricted = isViewer || isJunior;
  const [projectName, setProjectName] = useState(projectMeta.nombre);
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    const res = await getUserProjects();
    if (res.projects) {
      setProjects(res.projects);
      const activeId = useAppStore.getState().currentProjectId;
      if (res.projects.length === 0 && activeId !== null) {
        clearProjectWorkspace();
        setProjectName("Nuevo Proyecto");
      } else if (activeId && !res.projects.some((p: any) => p.id === activeId)) {
        clearProjectWorkspace();
        setProjectName("Nuevo Proyecto");
      }
    }
    setLoading(false);
  };

  const handleSaveToCloud = async () => {
    setSaving(true);
    setStatus(null);
    
    const projectData = {
      meta: { ...projectMeta, nombre: projectName },
      parcels: savedParcels
    };

    // Force update if we have a currentProjectId to avoid duplicates
    const targetId = currentProjectId || null;
    const res = await saveProject(projectName, JSON.stringify(projectData), targetId || undefined);
    
    if (res.success) {
      setStatus({ type: 'success', msg: currentProjectId ? 'Proyecto actualizado' : 'Proyecto guardado' });
      setProjectMeta({ ...projectMeta, nombre: projectName });
      if (res.projectId) setCurrentProjectId(res.projectId);
      fetchProjects();
    } else {
      setStatus({ type: 'error', msg: res.error || 'Error al guardar' });
    }
    setSaving(false);
  };

  const handleSaveToDevice = () => {
    const projectData = {
      meta: { ...projectMeta, nombre: projectName },
      parcels: savedParcels,
      version: "4.0",
      exportDate: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projectName.replace(/\s+/g, '_')}_geotrans.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    setStatus({ type: 'success', msg: 'Archivo descargado' });
  };

  const handleLoadProject = async (id: string) => {
    setLoading(true);
    const res = await getProjectContent(id);
    if (res.content) {
      try {
        const data = JSON.parse(res.content);
        if (data && typeof data === 'object') {
          importProject(data);
          if (data.meta && data.meta.nombre) {
            setProjectName(data.meta.nombre);
          }
          setCurrentProjectId(id);
          setStatus({ type: 'success', msg: 'Proyecto cargado' });
        } else {
          throw new Error('Formato de proyecto inválido');
        }
      } catch (e) {
        console.error('Error loading project:', e);
        setStatus({ type: 'error', msg: 'Error al procesar datos del proyecto' });
      }
    }
    setLoading(false);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('¿Eliminar este proyecto permanentemente?')) return;
    
    const res = await deleteProject(id);
    if (res.success) {
      const remaining = projects.filter(p => p.id !== id);
      if (currentProjectId === id || remaining.length === 0 || res.remainingCount === 0) {
        clearProjectWorkspace();
        setProjectName("Nuevo Proyecto");
        if (typeof window !== 'undefined') {
          localStorage.removeItem('transforven_project');
        }
        setStatus({
          type: 'success',
          msg: remaining.length === 0
            ? 'Todos los proyectos eliminados y parcelas vaciadas'
            : 'Proyecto eliminado y parcelas vaciadas'
        });
      }
      fetchProjects();
    }
  };

  const handleDeleteAllProjects = async () => {
    if (!window.confirm('¿Eliminar TODOS tus proyectos y vaciar todos los elementos de parcelas?')) return;
    setLoading(true);
    const res = await deleteAllUserProjects();
    if (res.success) {
      clearProjectWorkspace();
      setProjects([]);
      setProjectName("Nuevo Proyecto");
      if (typeof window !== 'undefined') {
        localStorage.removeItem('transforven_project');
      }
      setStatus({ type: 'success', msg: 'Todos los proyectos y elementos de parcelas fueron vaciados' });
    } else {
      setStatus({ type: 'error', msg: res.error || 'Error al eliminar proyectos' });
    }
    setLoading(false);
  };

  const handleExportPolygonsDXF = async () => {
    setExportingPolygons(true);
    try {
      const { geometryType } = useAppStore.getState();
      const validResults = results.filter(r => r.ok && r.result?.este != null && r.result?.norte != null);
      const minPoints = geometryType === 'cerrada' ? 3 : geometryType === 'abierta' ? 2 : 1;
      const activeParcel = validResults.length >= minPoints ? {
        id: 'active-canvas',
        nombre: projectName || 'Lienzo',
        fecha: new Date().toLocaleDateString('es-VE'),
        puntos: validResults,
        geometryType: geometryType
      } : null;
  
      const allParcels = [...savedParcels];
      if (activeParcel) {
        allParcels.push(activeParcel);
      }
  
      await exportProjectPolygonsToDXF(projectName || 'PROYECTO_POLIGONOS', allParcels);
    } catch (error) {
      console.error('Error exporting polygons:', error);
    } finally {
      setExportingPolygons(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Save Section */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Save className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">Guardar Proyecto</h3>
          </div>
          {(currentProjectId || savedParcels.length > 0) && (
            <button 
              onClick={() => { clearProjectWorkspace(); setProjectName("Nuevo Proyecto"); }}
              className="text-[9px] font-bold text-emerald-500 hover:text-emerald-400 uppercase tracking-tighter"
            >
              Nuevo +
            </button>
          )}
        </div>

        <div className="space-y-3">
          <div className="relative">
            <input 
              type="text" 
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Nombre del proyecto..."
              className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500/50 outline-none pr-10"
            />
            {currentProjectId && <Cloud className="absolute right-3 top-2.5 w-4 h-4 text-emerald-500/50" />}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={handleSaveToCloud}
              disabled={saving || isRestricted}
              className={cn(
                "flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-bold uppercase transition-all border disabled:opacity-30 disabled:cursor-not-allowed",
                currentProjectId 
                  ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/30"
                  : "bg-slate-800/50 hover:bg-slate-800 text-slate-300 border-slate-700"
              )}
            >
              {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />}
              {currentProjectId ? 'Actualizar' : 'Guardar Nube'}
            </button>
            <button 
              onClick={handleSaveToDevice}
              disabled={isViewer}
              className="flex items-center justify-center gap-2 py-2.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/20 rounded-xl text-[10px] font-bold uppercase transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <HardDrive className="w-3 h-3" />
              Dispositivo
            </button>
          </div>
          
           {currentProjectId && (
             <div className="w-full py-1.5 text-[9px] font-bold text-slate-500 text-center uppercase tracking-widest transition-colors">
               Proyecto vinculado a la nube
             </div>
           )}
        </div>

        {status && (
          <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-medium animate-in fade-in slide-in-from-top-1",
            status.type === 'success' ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
          )}>
            {status.type === 'success' ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {status.msg}
          </div>
        )}

        <div className="pt-2 border-t border-slate-800 space-y-2">
          <label className={cn(
            "flex items-center justify-center gap-2 w-full py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all border border-dashed",
            isViewer 
              ? "bg-slate-900/30 text-slate-700 border-slate-800 cursor-not-allowed opacity-50" 
              : "bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-700 cursor-pointer"
          )}>
            <Download className="w-3 h-3 rotate-180" />
            Cargar desde archivo (.json)
            {!isViewer && (
              <input 
                type="file" 
                accept=".json" 
                className="hidden" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const data = JSON.parse(event.target?.result as string);
                        importProject(data);
                        if (data.meta?.nombre) setProjectName(data.meta.nombre);
                        setStatus({ type: 'success', msg: 'Archivo cargado con éxito' });
                      } catch (err) {
                        setStatus({ type: 'error', msg: 'Formato de archivo inválido' });
                      }
                    };
                    reader.readAsText(file);
                  }
                }}
              />
            )}
          </label>

           <button 
             onClick={handleExportPolygonsDXF}
             disabled={exportingPolygons || (savedParcels.length === 0 && results.length < 3)}
             className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
           >
             <Folder className={cn("w-3.5 h-3.5 text-emerald-400", exportingPolygons && "animate-spin")} />
             {exportingPolygons ? 'Exportando...' : 'Exportar Polígonos (DXF Puro)'}
           </button>

           <button 
             onClick={() => setSummaryModalOpen(true)}
             disabled={savedParcels.length === 0}
             className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all bg-teal-500/15 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shadow-sm"
             title="Crear Tabla Resumen de Control de Parcelas del Proyecto"
           >
             <Table className="w-3.5 h-3.5 text-teal-400" />
             Tabla Resumen de Parcelas ({savedParcels.length})
           </button>
        </div>
      </div>

      {/* Cloud Projects List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-slate-400" />
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Mis Proyectos (Nube)</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {projects.length > 0 && !isRestricted && (
              <button
                onClick={handleDeleteAllProjects}
                title="Eliminar todos los proyectos y vaciar parcelas"
                className="px-2 py-1 text-[9px] font-bold uppercase tracking-tighter text-red-400 hover:bg-red-500/15 border border-red-500/20 rounded-md transition-colors"
              >
                Vaciar Todo
              </button>
            )}
            <button onClick={fetchProjects} className="p-1 hover:bg-slate-800 rounded transition-colors">
              <RefreshCw className={cn("w-3 h-3 text-slate-500", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {projects.length === 0 && !loading ? (
            <div className="text-center py-8 border-2 border-dashed border-slate-800/50 rounded-2xl">
              <Plus className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              <p className="text-[10px] text-slate-600 uppercase font-bold">No hay proyectos guardados</p>
            </div>
          ) : (
            projects.map((project) => (
              <div 
                key={project.id}
                onClick={() => handleLoadProject(project.id)}
                className="group flex items-center justify-between p-3 bg-slate-900/30 hover:bg-emerald-500/10 border border-slate-800 hover:border-emerald-500/30 rounded-xl cursor-pointer transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-800 group-hover:bg-emerald-500/20 rounded-lg flex items-center justify-center transition-colors">
                    <FileText className="w-4 h-4 text-slate-400 group-hover:text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200 group-hover:text-white truncate max-w-[120px]">
                      {project.nombre}
                    </h4>
                    <p className="text-[8px] text-slate-500 uppercase mt-0.5">
                      {new Date(project.actualizado).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isRestricted) handleDelete(project.id, e);
                  }}
                  disabled={isRestricted}
                  className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-lg transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal Resumen de Control de Parcelas */}
      {summaryModalOpen && (
        <ParcelSummaryModal
          parcels={savedParcels}
          isOpen={summaryModalOpen}
          onClose={() => setSummaryModalOpen(false)}
          projectTitle={projectName || projectMeta.nombre || 'PROYECTO'}
        />
      )}
    </div>
  );
}
