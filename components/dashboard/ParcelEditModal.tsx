import React, { useState, useEffect } from 'react';
import { Parcel } from '@/lib/store';
import { useStore } from '@/lib/store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface ParcelEditModalProps {
  parcel: Parcel;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

export default function ParcelEditModal({ parcel, isOpen, onClose, onSave }: ParcelEditModalProps) {
  const updateParcelMetadata = useStore((state) => state.updateParcelMetadata);
  const [formData, setFormData] = useState<Partial<Parcel>>({
    nombre: parcel.nombre || '',
    estado: parcel.estado || '',
    municipio: parcel.municipio || '',
    parroquia: parcel.parroquia || '',
    propietario: parcel.propietario || '',
    rif: parcel.rif || '',
    domicilio: parcel.domicilio || '',
    ubicacionSector: parcel.ubicacionSector || '',
    profesional: parcel.profesional || '',
    civ: parcel.civ || '',
    zona: parcel.zona || '',
    seccion: parcel.seccion || '',
    cedulaCat: parcel.cedulaCat || '',
    observaciones: parcel.observaciones || '',
  });

  useEffect(() => {
    if (isOpen) {
      setFormData({
        nombre: parcel.nombre || '',
        estado: parcel.estado || '',
        municipio: parcel.municipio || '',
        parroquia: parcel.parroquia || '',
        propietario: parcel.propietario || '',
        rif: parcel.rif || '',
        domicilio: parcel.domicilio || '',
        ubicacionSector: parcel.ubicacionSector || '',
        profesional: parcel.profesional || '',
        civ: parcel.civ || '',
        zona: parcel.zona || '',
        seccion: parcel.seccion || '',
        cedulaCat: parcel.cedulaCat || '',
        observaciones: parcel.observaciones || '',
      });
    }
  }, [isOpen, parcel]);

  if (!isOpen) return null;

  const handleInputChange = (field: keyof Parcel, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    updateParcelMetadata(parcel.id, formData);
    await onSave();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-white/10 w-full max-w-2xl max-h-[90vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col">
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
          <h2 className="text-xl font-bold text-white">GeoGIS6 · Editar Datos de Mensura</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 text-slate-400 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input 
              label="Nombre de la Parcela" 
              placeholder="Ej: Parcela A-01"
              value={formData.nombre} 
              onChange={(e) => handleInputChange('nombre', e.target.value)} 
            />
            <Input 
              label="Fecha" 
              placeholder="DD/MM/AAAA"
              value={formData.fecha || parcel.fecha} 
              onChange={(e) => handleInputChange('fecha', e.target.value)} 
            />
            <Input 
              label="Estado" 
              placeholder="Sin especificar"
              value={formData.estado} 
              onChange={(e) => handleInputChange('estado', e.target.value)} 
            />
            <Input 
              label="Municipio" 
              placeholder="Sin especificar"
              value={formData.municipio} 
              onChange={(e) => handleInputChange('municipio', e.target.value)} 
            />
            <Input 
              label="Parroquia" 
              placeholder="Sin especificar"
              value={formData.parroquia} 
              onChange={(e) => handleInputChange('parroquia', e.target.value)} 
            />
            <Input 
              label="Cédula Catastral" 
              placeholder="Ej: 15-02-01-U-123"
              value={formData.cedulaCat} 
              onChange={(e) => handleInputChange('cedulaCat', e.target.value)} 
            />
            <Input 
              label="Zona" 
              placeholder="Sin especificar"
              value={formData.zona} 
              onChange={(e) => handleInputChange('zona', e.target.value)} 
            />
            <Input 
              label="Sección" 
              placeholder="Sin especificar"
              value={formData.seccion} 
              onChange={(e) => handleInputChange('seccion', e.target.value)} 
            />
          </div>

          <div className="space-y-4 pt-4 border-t border-white/10">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Información del Propietario</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input 
                label="Propietario" 
                placeholder="Sin especificar"
                value={formData.propietario} 
                onChange={(e) => handleInputChange('propietario', e.target.value)} 
              />
              <Input 
                label="RIF / C.I." 
                placeholder="Sin especificar"
                value={formData.rif} 
                onChange={(e) => handleInputChange('rif', e.target.value)} 
              />
              <div className="md:col-span-2">
                <Input 
                  label="Ubicación / Sector (para Tabla Resumen)" 
                  placeholder="Ej: Sector Norte - Acceso Principal"
                  value={formData.ubicacionSector} 
                  onChange={(e) => handleInputChange('ubicacionSector', e.target.value)} 
                />
              </div>
              <div className="md:col-span-2">
                <Input 
                  label="Domicilio Fiscal / Legal" 
                  placeholder="Sin especificar"
                  value={formData.domicilio} 
                  onChange={(e) => handleInputChange('domicilio', e.target.value)} 
                />
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-white/10">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Datos del Profesional</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input 
                label="Profesional" 
                placeholder="Sin especificar"
                value={formData.profesional} 
                onChange={(e) => handleInputChange('profesional', e.target.value)} 
              />
              <Input 
                label="C.I.V." 
                placeholder="Sin especificar"
                value={formData.civ} 
                onChange={(e) => handleInputChange('civ', e.target.value)} 
              />
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-white/10">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Observaciones</h3>
            <div className="flex flex-col space-y-1.5">
              <label className="text-sm font-medium text-slate-200 ml-1">Notas adicionales</label>
              <textarea
                placeholder="Notas u observaciones del levantamiento..."
                className="flex h-24 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white ring-offset-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 transition-all duration-200 backdrop-blur-md"
                value={formData.observaciones}
                onChange={(e) => handleInputChange('observaciones', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-white/10 bg-white/5 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} className="bg-transparent hover:bg-white/10 text-slate-300 border border-white/10">
            Cancelar
          </Button>
          <Button onClick={handleSave}>
            Guardar Cambios
          </Button>
        </div>
      </div>
    </div>
  );
}
