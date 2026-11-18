'use client';

import React, { useRef, useState } from 'react';
import { FileService, GeoPoint } from '@/lib/file-service';
import { useAppStore } from '@/lib/store';
import { GeoEngine, HAYFORD, GRS80 } from '@/lib/geo-engine';
import { Upload, FileSpreadsheet, Layers, RefreshCw, AlertCircle, FileText, Play } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import AdicoraRigidControls from '@/components/dashboard/AdicoraRigidControls';
import { getRoleConstraints } from '@/src/types/auth';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type CoordType = 'utm' | 'geo' | 'cart';

/**
 * Determina el tipo de coordenada REAL de los puntos parseados.
 * Si el selector dice UTM pero los valores son lat/lng (o viceversa), los cálculos
 * producen NaN o posiciones fuera de Venezuela y los puntos "no aparecen" en el mapa.
 * Convención del parser para geo: p.e = Latitud, p.n = Longitud.
 */
function resolverTipoCoordenada(points: GeoPoint[], seleccionado: CoordType): CoordType {
  if (points.length === 0) return seleccionado;
  const pareceGeo = points.every(p => Math.abs(p.e) <= 90 && Math.abs(p.n) <= 180);
  const pareceProyectado = points.every(p => Math.abs(p.e) > 1000 && Math.abs(p.n) > 1000);
  if (seleccionado !== 'geo' && pareceGeo) return 'geo';
  if (seleccionado === 'geo' && pareceProyectado) return 'utm';
  return seleccionado;
}

const esPosicionValida = (r: any) =>
  r?.result &&
  Number.isFinite(r.result.lat) && Number.isFinite(r.result.lng) &&
  Math.abs(r.result.lat) <= 90 && Math.abs(r.result.lng) <= 180 &&
  !(r.result.lat === 0 && r.result.lng === 0);

export default function BatchImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [esFormatoInverso, setEsFormatoInverso] = useState(false);
  const { 
    routine, 
    coordType: coordTypeSeleccionado, 
    direction, 
    method, 
    huso, 
    rigidCorrection, 
    setRigidCorrection, 
    adicoraCorrection,
    autoResiduoMalla, 
    setAutoResiduoMalla, 
    setResultsFromBatch,
    clearResults,
    user,
  } = useAppStore();

  const roleConstraints = getRoleConstraints(user?.rol);

  // Leer directamente del store (no useState local) para que ambos modos (simple/lotes)
  // siempre compartan el mismo valor sin reseteo al montar el componente.
  const dn = String(rigidCorrection.dn);
  const de = String(rigidCorrection.de);
  const setDn = (val: string) => setRigidCorrection({ dn: parseFloat(val) || 0, de: rigidCorrection.de });
  const setDe = (val: string) => setRigidCorrection({ dn: rigidCorrection.dn, de: parseFloat(val) || 0 });

  const processPoints = (rawPoints: GeoPoint[]) => {
    if (rawPoints.length === 0) {
      alert('No se encontraron puntos válidos para procesar.');
      return;
    }

    let points = rawPoints;
    if (
      roleConstraints.maxVerticesPerCalculation !== null &&
      rawPoints.length > roleConstraints.maxVerticesPerCalculation
    ) {
      toast.error(
        `Modo ${roleConstraints.label}: Lote truncado a los primeros ${roleConstraints.maxVerticesPerCalculation} vértices permitidos (de ${rawPoints.length}).`,
        { duration: 6000 }
      );
      points = rawPoints.slice(0, roleConstraints.maxVerticesPerCalculation);
    }

    // Limpiar resultados anteriores inmediatamente para evitar datos stale visibles
    clearResults();

    // Tipo de coordenada efectivo (sombrea al del selector dentro de esta función)
    const coordType = resolverTipoCoordenada(points, coordTypeSeleccionado);
    if (coordType !== coordTypeSeleccionado) {
      const nombres: Record<CoordType, string> = { utm: 'UTM', geo: 'Geográficas (Lat/Lon)', cart: 'Cartesianas' };
      toast(`Las coordenadas parecen ${nombres[coordType]}; se procesaron como tal (selector: ${nombres[coordTypeSeleccionado]}).`, { icon: 'ℹ️', duration: 6000 });
    }

    const dnVal = autoResiduoMalla ? undefined : rigidCorrection.dn;
    const deVal = autoResiduoMalla ? undefined : rigidCorrection.de;

    const inv = direction === 'regven_canoa';
    const elO = inv ? GRS80 : HAYFORD;
    const elD = inv ? HAYFORD : GRS80;

    // ── RIGIDA02: Procesamiento en bloque con deltas de Adícora editables ──
    if (method === 'rigida02') {
      try {
        const vertices = points.map((p, i) => ({
          id: p.id || `P${i + 1}`,
          norte_origen: p.n,
          este_origen:  p.e,
          cota_origen:  p.h ?? 0,
        }));
        const r02 = GeoEngine.transformRigida02(vertices, {
          deltaEste: adicoraCorrection?.de,
          deltaNorte: adicoraCorrection?.dn,
          cotaGeoidal: adicoraCorrection?.cotaGeoidal,
        });
        const batchResults = r02.resultados.map((v, i) => {
          const geoD = GeoEngine.utmToGeo(v.este_regven, v.norte_regven, huso, false, GRS80);
          return {
            id: v.id,
            parcel: points[i]?.parcel,
            direction: 'canoa_regven' as const,
            input: { este: v.este_canoa, norte: v.norte_canoa, huso, alt: points[i]?.h ?? 0, desc: points[i]?.desc },
            result: {
              este: v.este_regven,
              norte: v.norte_regven,
              lat: geoD.lat,
              lng: geoD.lng,
              huso,
              cota_regven: v.cota_regven,
              cotaInyectada: v.cotaInyectada,
              dLineal: Math.sqrt(
                Math.pow(v.este_regven - v.este_canoa, 2) +
                Math.pow(v.norte_regven - v.norte_canoa, 2)
              ),
              qaqcPasado: r02.qaqcPasado,
              metodo: r02.metodo,
              deltaEste: r02.deltaEste,
              deltaNorte: r02.deltaNorte,
              descripcion: v.descripcion,
            },
            ok: true,
          };
        });
        setResultsFromBatch(batchResults as any);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error RIGIDA02';
        alert(`❌ RIGIDA02 QA/QC FALLÓ:\n${msg}`);
      }
      return; // early-return: no continuar con el map() individual
    }

    const processedResults = points.map((p, index) => {

      try {
        if (routine === 'ploteo') {
          const pointId = p.id || `P${index + 1}`;
          if (coordType === 'utm') {
            const geo = GeoEngine.utmToGeo(p.e, p.n, huso, false, GRS80);
            return {
              id: pointId,
              parcel: p.parcel,
              direction: 'canoa_regven' as const,
              input: { este: p.e, norte: p.n, huso, alt: p.h, desc: p.desc },
              result: { este: p.e, norte: p.n, lat: geo.lat, lng: geo.lng, huso, dLineal: 0 },
              ok: true
            };
          } else if (coordType === 'geo') {
            const outputHuso = GeoEngine.detectHuso(p.n) || huso;
            const utm = GeoEngine.geoToUTM(p.e, p.n, outputHuso, GRS80); // e is lat, n is lng here
            return {
              id: pointId,
              parcel: p.parcel,
              direction: 'canoa_regven' as const,
              input: { lat: p.e, lng: p.n, huso: outputHuso, alt: p.h, desc: p.desc },
              result: { este: utm.este, norte: utm.norte, lat: p.e, lng: p.n, huso: outputHuso, dLineal: 0 },
              ok: true
            };
          } else {
            const geo = GeoEngine.cartToGeo(p.e, p.n, p.h, GRS80);
            const outputHuso = GeoEngine.detectHuso(geo.lng) || huso;
            const utm = GeoEngine.geoToUTM(geo.lat, geo.lng, outputHuso, GRS80);
            return {
              id: pointId,
              parcel: p.parcel,
              direction: 'canoa_regven' as const,
              input: { x: p.e, y: p.n, alt: p.h, desc: p.desc },
              result: { este: utm.este, norte: utm.norte, lat: geo.lat, lng: geo.lng, huso: outputHuso, dLineal: 0 },
              ok: true
            };
          }
        } else if (method === 'rigida') {
          let input: any;
          let este: number, norte: number;

          if (coordType === 'utm') {
            este = p.e; norte = p.n;
            input = { este: p.e, norte: p.n, huso, alt: p.h, desc: p.desc };
          } else if (coordType === 'geo') {
            const utmO = GeoEngine.geoToUTM(p.e, p.n, huso, elO);
            este = utmO.este; norte = utmO.norte;
            input = { lat: p.e, lng: p.n, huso, alt: p.h, desc: p.desc };
          } else {
            const geo = GeoEngine.cartToGeo(p.e, p.n, p.h, elO);
            const utmO = GeoEngine.geoToUTM(geo.lat, geo.lng, huso, elO);
            este = utmO.este; norte = utmO.norte;
            input = { x: p.e, y: p.n, alt: p.h, desc: p.desc };
          }

          const r = GeoEngine.transformRigida(este, norte, p.h, huso, inv, dnVal, deVal);

          return {
            id: p.id,
            parcel: p.parcel,
            direction,
            input,
            result: { ...r, huso: r.huso ?? huso },
            ok: true
          };
        } else if (method === 'dma_badekas' || method === 'dma_badekas_regven') {
          let input: any;
          let este: number, norte: number;

          if (coordType === 'utm') {
            este = p.e; norte = p.n;
            input = { este: p.e, norte: p.n, huso, alt: p.h, desc: p.desc };
          } else if (coordType === 'geo') {
            const utmO = GeoEngine.geoToUTM(p.e, p.n, huso, HAYFORD);
            este = utmO.este; norte = utmO.norte;
            input = { lat: p.e, lng: p.n, huso, alt: p.h, desc: p.desc };
          } else {
            const geo = GeoEngine.cartToGeo(p.e, p.n, p.h, HAYFORD);
            const utmO = GeoEngine.geoToUTM(geo.lat, geo.lng, huso, HAYFORD);
            este = utmO.este; norte = utmO.norte;
            input = { x: p.e, y: p.n, alt: p.h, desc: p.desc };
          }

          const dmaType = method === 'dma_badekas' ? 'dma_psad56_real' : 'dma_regven';
          const r = GeoEngine.transformDma(este, norte, p.h || 0, huso, dmaType, esFormatoInverso);

          return {
            id: p.id,
            parcel: p.parcel,
            direction: (esFormatoInverso ? 'regven_canoa' : 'canoa_regven') as 'canoa_regven' | 'regven_canoa',
            input,
            result: { ...r, huso: r.huso ?? huso },
            ok: true
          };
        } else {
          let cart;
          let input;
          let originalUtm: { este: number; norte: number } | null = null;

          if (coordType === 'utm') {
            const geoO = GeoEngine.utmToGeo(p.e, p.n, huso, false, elO);
            cart = GeoEngine.geoToCart(geoO.lat, geoO.lng, p.h, elO);
            input = { este: p.e, norte: p.n, huso, alt: p.h, desc: p.desc };
            originalUtm = { este: p.e, norte: p.n };
          } else if (coordType === 'geo') {
            cart = GeoEngine.geoToCart(p.e, p.n, p.h, elO);
            input = { lat: p.e, lng: p.n, huso, alt: p.h, desc: p.desc };
          } else {
            cart = { X: p.e, Y: p.n, Z: p.h };
            input = { x: p.e, y: p.n, alt: p.h, desc: p.desc };
          }

          const cartT = GeoEngine.badekas(cart.X, cart.Y, cart.Z, inv);
          const geoD = GeoEngine.cartToGeo(cartT.X, cartT.Y, cartT.Z, elD);
          const outputHuso = coordType === 'geo' ? GeoEngine.detectHuso(geoD.lng) : huso;
          const utmD = GeoEngine.geoToUTM(geoD.lat, geoD.lng, outputHuso, elD);

          return {
            id: p.id,
            parcel: p.parcel,
            direction,
            input,
            result: { 
              este: utmD.este, 
              norte: utmD.norte, 
              lat: geoD.lat, 
              lng: geoD.lng,
              huso: outputHuso,
              dLineal: originalUtm
                ? Math.sqrt(Math.pow(utmD.este - originalUtm.este, 2) + Math.pow(utmD.norte - originalUtm.norte, 2))
                : 0
            },
            ok: true
          };
        }
      } catch (err) {
        return { id: p.id, ok: false };
      }
    }).filter((r): r is Exclude<typeof r, null> => r !== null && r.ok);

    // Validar que los puntos tengan una posición representable en el mapa
    const validos = processedResults.filter(esPosicionValida);
    if (validos.length === 0) {
      alert(
        `⚠️ Se leyeron ${points.length} punto(s) pero ninguno produjo una posición válida.\n\n` +
        `Revise: tipo de coordenada (${coordType.toUpperCase()}), huso (${huso}), ` +
        `orden Este/Norte y que el archivo tenga columnas numéricas.`
      );
      return;
    }
    if (validos.length < points.length) {
      toast.error(`${points.length - validos.length} punto(s) se descartaron por coordenadas inválidas.`);
    }

    setResultsFromBatch(validos as any);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      let points: GeoPoint[] = [];
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'xlsx' || ext === 'xls') {
        points = await FileService.parseExcel(file, esFormatoInverso, coordTypeSeleccionado);
      } else if (ext === 'dxf') {
        points = await FileService.parseDXF(file);
      } else {
        const text = await file.text();
        points = FileService.parseText(text, esFormatoInverso, coordTypeSeleccionado);
      }

      processPoints(points);
    } catch (err) {
      console.error(err);
      alert('Error procesando el archivo.');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleTextProcess = () => {
    if (!pastedText.trim()) {
      alert('Por favor pegue o ingrese texto con coordenadas.');
      return;
    }

    setLoading(true);
    try {
      const points = FileService.parseText(pastedText, esFormatoInverso, coordTypeSeleccionado);
      processPoints(points);
    } catch (err) {
      console.error(err);
      alert('Error procesando el texto de coordenadas.');
    } finally {
      setLoading(false);
    }
  };

  const parsedPreviewCount = pastedText.trim() ? FileService.parseText(pastedText, esFormatoInverso, coordTypeSeleccionado).length : 0;

  return (
    <div className="space-y-4">
      {/* Selector de Pestañas */}
      <div className="flex border-b border-slate-800/80 bg-slate-950/40 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
            activeTab === 'upload'
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
          )}
        >
          <Upload className="w-3.5 h-3.5" />
          Subir Archivo
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('paste')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
            activeTab === 'paste'
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm"
              : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50"
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          Pegar Texto
        </button>
      </div>

      {activeTab === 'upload' ? (
        <div 
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "relative group cursor-pointer border-2 border-dashed border-slate-800 rounded-2xl p-8 transition-all hover:border-emerald-500/50 hover:bg-emerald-500/5 overflow-hidden",
            loading && "pointer-events-none opacity-50"
          )}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFile} 
            className="hidden" 
            accept=".csv,.txt,.xlsx,.xls,.dxf"
          />
          
          <div className="flex flex-col items-center justify-center space-y-3 relative z-10">
            <div className="w-12 h-12 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center group-hover:scale-110 group-hover:border-emerald-500/50 transition-all duration-500">
              {loading ? <RefreshCw className="w-6 h-6 text-emerald-500 animate-spin" /> : <Upload className="w-6 h-6 text-slate-400 group-hover:text-emerald-500" />}
            </div>
            <div className="text-center">
              <p className="text-xs font-bold text-slate-300 uppercase tracking-widest">
                {loading ? 'Procesando Lote...' : 'Cargar Archivo'}
              </p>
              <p className="text-[10px] text-slate-500 mt-1">Soporta CSV, XLSX, TXT, DXF</p>
            </div>
          </div>

          {/* Decorative corner */}
          <div className="absolute -bottom-2 -right-2 w-12 h-12 bg-emerald-500/10 blur-xl rounded-full group-hover:bg-emerald-500/20 transition-all"></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <textarea
              rows={6}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder={`Ejemplo (delimitado por coma, tabulación o espacio):\nP01, 411773.26, 1320182.53, 10.5, Lindero Norte\nP02, 411844.59, 1320191.55, 11.2, Esquina Este\nP03, 411868.44, 1320002.95\nP04, 411797.26, 1320002.95`}
              className="w-full bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono placeholder:text-slate-600 focus:border-emerald-500/50 outline-none transition-all resize-y"
            />
            {parsedPreviewCount > 0 && (
              <span className="absolute top-2 right-2 px-2 py-0.5 text-[9px] font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-md">
                {parsedPreviewCount} {parsedPreviewCount === 1 ? 'punto detectado' : 'puntos detectados'}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleTextProcess}
            disabled={loading || !pastedText.trim()}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-emerald-900/20"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            Procesar Puntos Pegados
          </button>
        </div>
      )}

      {method === 'rigida02' && routine !== 'ploteo' && (
        <AdicoraRigidControls />
      )}

      {method === 'rigida' && routine !== 'ploteo' && (
        <div className="space-y-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-amber-400 uppercase flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={autoResiduoMalla}
                onChange={(e) => setAutoResiduoMalla(e.target.checked)}
                className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
              />
              Corrección Automática (Malla IDW)
            </label>
          </div>
          {!autoResiduoMalla && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold text-amber-400 uppercase">ΔN (m) Manual</label>
                  <input 
                    type="number" step="0.001"
                    value={dn}
                    onChange={(e) => setDn(e.target.value)}
                    className="w-full bg-slate-950/50 border border-amber-500/30 rounded-lg px-3 py-2 text-sm text-amber-400 font-mono placeholder:text-slate-700 focus:border-amber-500/50 outline-none transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold text-amber-400 uppercase">ΔE (m) Manual</label>
                  <input 
                    type="number" step="0.001"
                    value={de}
                    onChange={(e) => setDe(e.target.value)}
                    className="w-full bg-slate-950/50 border border-amber-500/30 rounded-lg px-3 py-2 text-sm text-amber-400 font-mono placeholder:text-slate-700 focus:border-amber-500/50 outline-none transition-all"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-amber-500/20 text-[9px]">
                <span className="text-slate-500">Cargar preset local:</span>
                <button
                  type="button"
                  onClick={() => {
                    setRigidCorrection({ dn: -311.540, de: -204.330 });
                  }}
                  className="text-cyan-400 hover:text-cyan-300 font-bold underline"
                >
                  Adícora AL-318
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(coordTypeSeleccionado === 'utm' || method === 'dma_badekas' || method === 'dma_badekas_regven') && (
        <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl space-y-2">
          <label className="text-[10px] font-bold text-cyan-400 uppercase flex items-center gap-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={esFormatoInverso}
              onChange={(e) => setEsFormatoInverso(e.target.checked)}
              className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
            />
            Formato de Entrada: Norte (Y) primero, Este (X) segundo
          </label>
          <p className="text-[9px] text-cyan-300/80 italic leading-relaxed">
            {esFormatoInverso
              ? '↕ Entrada interpretada como: [ID], Norte (Y), Este (X), [Cota]'
              : '→ Entrada estándar: [ID], Este (X), Norte (Y), [Cota] (Auto-detecta si Norte > 1.000.000)'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button className="flex items-center justify-center gap-2 py-2.5 bg-slate-900/50 border border-slate-800 rounded-xl text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:border-slate-700 hover:text-slate-300 transition-all">
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Plantilla
        </button>
        <button className="flex items-center justify-center gap-2 py-2.5 bg-slate-900/50 border border-slate-800 rounded-xl text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:border-slate-700 hover:text-slate-300 transition-all">
          <Layers className="w-3.5 h-3.5" />
          Ejemplo DXF
        </button>
      </div>

      <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl flex gap-3">
        <AlertCircle className="w-4 h-4 text-blue-400 shrink-0" />
        <p className="text-[9px] text-slate-400 leading-relaxed italic">
          Importación flexible: Detecta automáticamente Norte/Este. Se asume Columna 1: ID (Punto), 2 y 3: Coordenadas, 4: Alt, 5: Desc.
        </p>
      </div>
    </div>
  );
}

