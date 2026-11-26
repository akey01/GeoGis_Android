'use client';

import React, { useRef, useState } from 'react';
import { X, Upload, MapPin, Layers, ChevronDown, ChevronRight, AlertCircle, Check, RefreshCw } from 'lucide-react';
import { FileService, type DXFPolygon } from '@/lib/file-service';
import { parseDWGPolygons, isDwgBinaryBuffer } from '@/lib/dwg-service';
import { useAppStore } from '@/lib/store';
import { GeoEngine, HAYFORD, GRS80 } from '@/lib/geo-engine';
import { normalizeRingClockwiseFromNorth } from '@/lib/polygon-union';

interface DxfImportModalProps {
  onClose: () => void;
}

export default function DxfImportModal({ onClose }: DxfImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [polygons, setPolygons] = useState<DXFPolygon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { routine, method, rigidCorrection, adicoraCorrection, autoResiduoMalla, direction, setDxfPreview, huso: storeHuso } = useAppStore();
  const [importMode, setImportMode] = useState<'ploteo' | 'transform'>(
    routine === 'ploteo' ? 'ploteo' : 'transform'
  );
  const [sourceDatum, setSourceDatum] = useState<'psad56' | 'regven' | 'wgs84'>('regven');
  const [importHuso, setImportHuso] = useState(storeHuso);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [transforming, setTransforming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
  const [sourceFormat, setSourceFormat] = useState<'DXF' | 'DWG'>('DXF');
  const [sourceInfo, setSourceInfo] = useState<string | null>(null);

  const layers = React.useMemo(() => {
    const map = new Map<string, DXFPolygon[]>();
    for (const p of polygons) {
      if (!map.has(p.layer)) map.set(p.layer, []);
      map.get(p.layer)!.push(p);
    }
    return Array.from(map.entries());
  }, [polygons]);

  const processSelectedFile = async (file: File) => {
    setError(null);
    setLoading(true);
    try {
      const headerBuf = await file.slice(0, 16).arrayBuffer();
      const isDwg = isDwgBinaryBuffer(headerBuf) || /\.dwg$/i.test(file.name);
      setSourceFormat(isDwg ? 'DWG' : 'DXF');

      let result: { polygons: DXFPolygon[]; huso: number };
      if (isDwg) {
        const dwgRes = await parseDWGPolygons(file);
        result = { polygons: dwgRes.polygons, huso: dwgRes.huso };
        setSourceInfo(dwgRes.versionLabel ? `${file.name} · ${dwgRes.versionLabel}` : file.name);
      } else {
        const text = await file.text();
        result = FileService.parseDXFPolygons(text);
        setSourceInfo(file.name);
      }

      if (result.polygons.length === 0) {
        setError('No se encontraron polígonos o líneas válidas en el archivo CAD.');
        setPolygons([]);
        setSelectedIds(new Set());
        return;
      }

      setPolygons(result.polygons);
      setImportHuso(result.huso);
      if (result.polygons.some((p) => p.isGeographic)) {
        setSourceDatum('wgs84');
      }
      setSelectedIds(new Set(result.polygons.map(p => p.id)));
      const firstLayer = result.polygons[0]?.layer;
      setExpandedLayers(new Set(firstLayer ? [firstLayer] : []));
    } catch (err: any) {
      setError(err?.message || 'Error al parsear el archivo CAD');
      setPolygons([]);
      setSelectedIds(new Set());
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  };

  const togglePolygon = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLayer = (layerName: string, polys: DXFPolygon[]) => {
    const allSelected = polys.every(p => selectedIds.has(p.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const p of polys) {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  };

  const toggleLayerExpanded = (layer: string) => {
    setExpandedLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  const transformPolygon = (poly: DXFPolygon): DXFPolygon => {
    const huso = importHuso;
    const sourceIsPsad56 = sourceDatum === 'psad56';
    const destIsPsad56 = importMode === 'ploteo' ? sourceIsPsad56 : direction === 'regven_canoa';
    const resultDir: 'canoa_regven' | 'regven_canoa' = destIsPsad56 ? 'regven_canoa' : 'canoa_regven';
    const resultEpsg = destIsPsad56 ? `EPSG:248${huso}` : `EPSG:220${huso - 17}`;

    const srcUtmVerts = poly.vertices.map((v) => {
      const isGeoPt =
        poly.isGeographic ||
        (sourceDatum === 'wgs84' && Math.abs(v.e) <= 180 && Math.abs(v.n) <= 90);
      if (isGeoPt) {
        const utmSrc = GeoEngine.geoToUTM(v.n, v.e, huso, sourceIsPsad56 ? HAYFORD : GRS80);
        return { e: utmSrc.este, n: utmSrc.norte, origE: v.e, origN: v.n };
      }
      return { e: v.e, n: v.n, origE: v.e, origN: v.n };
    });

    if (sourceIsPsad56 && !destIsPsad56 && method === 'rigida02') {
      const r02 = GeoEngine.transformRigida02(
        srcUtmVerts.map((v, i) => ({
          id: `P${i + 1}`,
          norte_origen: v.n,
          este_origen: v.e,
          cota_origen: 0,
        })),
        {
          deltaEste: adicoraCorrection?.de,
          deltaNorte: adicoraCorrection?.dn,
          cotaGeoidal: adicoraCorrection?.cotaGeoidal,
        }
      );
      const transformedVerts = srcUtmVerts.map((v, i) => {
        const res02 = r02.resultados[i];
        const geoD = GeoEngine.utmToGeo(res02.este_regven, res02.norte_regven, huso, false, GRS80);
        const result = {
          este: res02.este_regven,
          norte: res02.norte_regven,
          lat: geoD.lat,
          lng: geoD.lng,
          huso,
          direction: resultDir,
          dLineal: Math.hypot(res02.este_regven - v.e, res02.norte_regven - v.n),
        };
        return { e: v.e, n: v.n, lat: result.lat, lng: result.lng, result };
      });
      return { ...poly, huso, resultEpsg, vertices: transformedVerts };
    }

    const transformedVerts = srcUtmVerts.map((v) => {
      let result: any;

      if (sourceIsPsad56 === destIsPsad56) {
        // Mismo datum o Ploteo Directo sin desplazamiento geodésico
        const el = sourceIsPsad56 ? HAYFORD : GRS80;
        const geo = GeoEngine.utmToGeo(v.e, v.n, huso, false, el);
        result = {
          este: v.e,
          norte: v.n,
          lat: geo.lat,
          lng: geo.lng,
          huso,
          direction: resultDir,
          dLineal: 0,
        };
      } else if (sourceIsPsad56 && !destIsPsad56) {
        // Transformación: PSAD56 (La Canoa) -> REGVEN (SIRGAS)
        if (method === 'rigida') {
          const dnVal = autoResiduoMalla ? undefined : rigidCorrection.dn;
          const deVal = autoResiduoMalla ? undefined : rigidCorrection.de;
          result = GeoEngine.transformRigida(v.e, v.n, 0, huso, false, dnVal, deVal);
        } else if (method === 'dma_badekas' || method === 'dma_badekas_regven') {
          const dmaType = method === 'dma_badekas' ? 'dma_psad56_real' : 'dma_regven';
          result = GeoEngine.transformDma(v.e, v.n, 0, huso, dmaType);
        } else {
          const geoO = GeoEngine.utmToGeo(v.e, v.n, huso, false, HAYFORD);
          let cart = GeoEngine.geoToCart(geoO.lat, geoO.lng, 0, HAYFORD);
          cart = GeoEngine.badekas(cart.X, cart.Y, cart.Z, false);
          const geoD = GeoEngine.cartToGeo(cart.X, cart.Y, cart.Z, GRS80);
          const utmD = GeoEngine.geoToUTM(geoD.lat, geoD.lng, huso, GRS80);
          result = {
            este: utmD.este,
            norte: utmD.norte,
            lat: geoD.lat,
            lng: geoD.lng,
            dLineal: Math.hypot(utmD.este - v.e, utmD.norte - v.n),
          };
        }
      } else {
        // Transformación: REGVEN (SIRGAS) -> PSAD56 (La Canoa)
        if (method === 'rigida') {
          const dnVal = autoResiduoMalla ? undefined : rigidCorrection.dn;
          const deVal = autoResiduoMalla ? undefined : rigidCorrection.de;
          result = GeoEngine.transformRigida(v.e, v.n, 0, huso, true, dnVal, deVal);
        } else {
          const geoO = GeoEngine.utmToGeo(v.e, v.n, huso, false, GRS80);
          let cart = GeoEngine.geoToCart(geoO.lat, geoO.lng, 0, GRS80);
          cart = GeoEngine.badekas(cart.X, cart.Y, cart.Z, true);
          const geoD = GeoEngine.cartToGeo(cart.X, cart.Y, cart.Z, HAYFORD);
          const utmD = GeoEngine.geoToUTM(geoD.lat, geoD.lng, huso, HAYFORD);
          result = {
            este: utmD.este,
            norte: utmD.norte,
            lat: geoD.lat,
            lng: geoD.lng,
            dLineal: Math.hypot(utmD.este - v.e, utmD.norte - v.n),
          };
        }
      }

      result = { ...result, huso, direction: resultDir };
      return { e: v.e, n: v.n, lat: result.lat, lng: result.lng, result };
    });

    return { ...poly, huso, resultEpsg, vertices: transformedVerts };
  };

  const handleTransform = async () => {
    const selected = polygons.filter(p => selectedIds.has(p.id));
    if (selected.length === 0) return;
    setTransforming(true);
    try {
      const transformed = selected.map(transformPolygon);
      setDxfPreview(transformed);
    } catch (err: any) {
      setError(err?.message || 'Error en la transformación');
    } finally {
      setTransforming(false);
    }
  };

  const handleImport = async () => {
    const selected = polygons.filter(p => selectedIds.has(p.id));
    if (selected.length === 0) return;
    setImporting(true);
    try {
      const layerTotals = new Map<string, number>();
      for (const poly of selected) {
        const baseName = poly.layer !== '0' ? poly.layer.toUpperCase() : poly.id;
        layerTotals.set(baseName, (layerTotals.get(baseName) || 0) + 1);
      }
      const layerSeen = new Map<string, number>();
      const newParcels: any[] = [];

      for (const poly of selected) {
        const transformedPoly = transformPolygon(poly);
        const rawVerts = transformedPoly.vertices;
        const orderedVerts =
          poly.closed && rawVerts.length >= 3
            ? normalizeRingClockwiseFromNorth(
                rawVerts.map((v) => ({
                  ...v,
                  x: v.result?.este ?? v.e,
                  y: v.result?.norte ?? v.n,
                }))
              )
            : rawVerts;

        const pts = orderedVerts.map((v, i) => ({
          id: `P${i + 1}`,
          direction: v.result?.direction || direction,
          input: { este: v.e, norte: v.n, huso: importHuso },
          result: v.result || {
            este: v.e,
            norte: v.n,
            lat: v.lat ?? 0,
            lng: v.lng ?? 0,
            huso: importHuso,
            direction,
            dLineal: 0,
          },
          ok: true,
        }));

        const geoType = poly.closed && pts.length >= 3 ? 'cerrada' : pts.length >= 2 ? 'abierta' : 'puntos';

        let area = 0;
        let perim = 0;
        if (geoType === 'cerrada' && pts.length >= 3) {
          for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length;
            area += pts[i].result.este * pts[j].result.norte;
            area -= pts[j].result.este * pts[i].result.norte;
            const dx = pts[j].result.este - pts[i].result.este;
            const dy = pts[j].result.norte - pts[i].result.norte;
            perim += Math.sqrt(dx * dx + dy * dy);
          }
          area = Math.abs(area) / 2;
        } else if (geoType === 'abierta' && pts.length >= 2) {
          for (let i = 0; i < pts.length - 1; i++) {
            const dx = pts[i + 1].result.este - pts[i].result.este;
            const dy = pts[i + 1].result.norte - pts[i].result.norte;
            perim += Math.sqrt(dx * dx + dy * dy);
          }
        }

        const baseName = poly.layer !== '0' ? poly.layer.toUpperCase() : poly.id;
        const idxInLayer = (layerSeen.get(baseName) || 0) + 1;
        layerSeen.set(baseName, idxInLayer);
        const totalInLayer = layerTotals.get(baseName) || 1;
        const parcelName = totalInLayer > 1 ? `${baseName} (${idxInLayer})` : baseName;

        newParcels.push({
          id: `POL-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
          nombre: parcelName,
          fecha: new Date().toLocaleDateString('es-VE'),
          area,
          perim,
          ha: area > 0 ? area / 10000 : 0,
          puntos: pts,
          geometryType: geoType as 'cerrada' | 'abierta' | 'puntos',
          method,
          hatchColor: poly.color,
          rigidCorrection: method === 'rigida' ? rigidCorrection : undefined,
        });
      }

      const current = useAppStore.getState().savedParcels;
      useAppStore.setState({
        savedParcels: [...current, ...newParcels].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      });

      setDxfPreview(null);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Error al importar parcelas');
    } finally {
      setImporting(false);
    }
  };

  const totalVerts = polygons.reduce((s, p) => s + p.vertices.length, 0);

  const previewAudit = React.useMemo(() => {
    const firstPoly = polygons.find((p) => selectedIds.has(p.id)) || polygons[0];
    if (!firstPoly || firstPoly.vertices.length === 0) return null;
    try {
      const tr = transformPolygon(firstPoly);
      const v0 = tr.vertices[0];
      const raw0 = firstPoly.vertices[0];
      if (!v0?.result) return null;
      const destIsPsad = tr.resultEpsg?.startsWith('EPSG:248');
      const dE = v0.result.este - raw0.e;
      const dN = v0.result.norte - raw0.n;
      return {
        rawE: raw0.e,
        rawN: raw0.n,
        outE: v0.result.este,
        outN: v0.result.norte,
        targetLabel: destIsPsad ? `PSAD56 ${importHuso}N` : `REGVEN ${importHuso}N`,
        shiftM: firstPoly.isGeographic ? 0 : Math.hypot(dE, dN),
        destIsPsad,
      };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygons, selectedIds, sourceDatum, importHuso, importMode, method, direction, rigidCorrection, adicoraCorrection, autoResiduoMalla]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">GeoGIS6 · Importar DXF / DWG</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-800/50 rounded-xl text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-xl p-8 text-center cursor-pointer transition-colors group"
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-slate-500 group-hover:text-emerald-400 transition-colors" />
            <p className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">
              {loading
                ? (sourceFormat === 'DWG' ? 'Decodificando DWG...' : 'Procesando DXF...')
                : 'Arrastra o selecciona un archivo DXF o DWG'}
            </p>
            <p className="text-[10px] text-slate-600 mt-1">
              AutoCAD DXF / DWG (R13–2024) · LWPOLYLINE, POLYLINE, LINE, ARC, CIRCLE, INSERT
            </p>
            {sourceInfo && !loading && (
              <p className="text-[10px] font-mono text-emerald-400 mt-2">{sourceInfo}</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".dxf,.dwg"
              onChange={handleFile}
              className="hidden"
            />
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-4 text-slate-400 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {sourceFormat === 'DWG' ? 'Decodificando DWG (WASM)...' : 'Parseando DXF...'}
            </div>
          )}

          {polygons.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-1.5 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setImportMode('ploteo');
                    if (sourceDatum === 'psad56') setSourceDatum('regven');
                  }}
                  className={`py-2 px-2 rounded-lg text-[11px] font-bold transition-all ${
                    importMode === 'ploteo'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Ploteo Directo (Sin desplazar)
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('transform')}
                  className={`py-2 px-2 rounded-lg text-[11px] font-bold transition-all ${
                    importMode === 'transform'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Transformar Datum ({method.toUpperCase()})
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Datum Origen del {sourceFormat}</label>
                  <select
                    value={sourceDatum}
                    onChange={(e) => setSourceDatum(e.target.value as any)}
                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none cursor-pointer"
                  >
                    <option value="regven">REGVEN (SIRGAS / Foto GPS)</option>
                    <option value="psad56">PSAD56 (La Canoa)</option>
                    <option value="wgs84">WGS84</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                    Huso UTM <span className="text-emerald-400/60 font-normal">({importHuso})</span>
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {[18, 19, 20, 21].map(h => (
                      <button
                        key={h}
                        onClick={() => setImportHuso(h)}
                        className={`py-2 text-xs font-bold rounded-lg transition-all ${
                          importHuso === h
                            ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                            : 'bg-slate-800/50 text-slate-400 hover:text-slate-200 border border-slate-700'
                        }`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {sourceDatum === 'psad56' && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[10.5px] text-amber-300">
                  <span>
                    {sourceFormat} marcado como <strong>PSAD56 (La Canoa)</strong>. Si ya está en REGVEN/foto satelital, cámbialo a REGVEN para evitar ~370 m de desfase.
                  </span>
                  <button
                    type="button"
                    onClick={() => setSourceDatum('regven')}
                    className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold shrink-0"
                  >
                    Usar REGVEN
                  </button>
                </div>
              )}

              {previewAudit && (
                <div className="px-3 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-[10px] font-mono space-y-1">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Auditoría P1 → <strong className="text-emerald-400">{previewAudit.targetLabel}</strong></span>
                    <span className={previewAudit.shiftM > 1 ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                      Δ {previewAudit.shiftM.toFixed(2)} m
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>{sourceFormat}: {previewAudit.rawE.toFixed(2)}E, {previewAudit.rawN.toFixed(2)}N</span>
                    <span>Mapa: {previewAudit.outE.toFixed(2)}E, {previewAudit.outN.toFixed(2)}N</span>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                  Capas detectadas ({polygons.length} polígono{polygons.length !== 1 ? 's' : ''}, {totalVerts} vértice{totalVerts !== 1 ? 's' : ''})
                </label>
                <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl max-h-48 overflow-y-auto">
                  {layers.map(([layerName, polys]) => {
                    const allSelected = polys.every(p => selectedIds.has(p.id));
                    const someSelected = polys.some(p => selectedIds.has(p.id));
                    const expanded = expandedLayers.has(layerName);

                    return (
                      <div key={layerName}>
                        <div className="flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50 transition-colors border-b border-slate-700/30 last:border-b-0">
                          <button
                            onClick={() => toggleLayer(layerName, polys)}
                            className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                              allSelected
                                ? 'bg-emerald-500 border-emerald-500'
                                : someSelected
                                  ? 'bg-emerald-500/50 border-emerald-500/50'
                                  : 'border-slate-600 hover:border-slate-500'
                            }`}
                          >
                            {allSelected && <Check className="w-3 h-3 text-white" />}
                          </button>
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: polys[0]?.color || '#f59e0b' }}
                          />
                          <button
                            onClick={() => toggleLayerExpanded(layerName)}
                            className="flex items-center gap-1 flex-1 text-left"
                          >
                            <span className="text-xs font-medium text-slate-300">
                              {layerName === '0' ? 'Capa por defecto' : layerName}
                            </span>
                            <span className="text-[10px] text-slate-600">({polys.length})</span>
                            {expanded ? <ChevronDown className="w-3 h-3 text-slate-600 ml-auto" /> : <ChevronRight className="w-3 h-3 text-slate-600 ml-auto" />}
                          </button>
                        </div>
                        {expanded && polys.map(poly => (
                          <div key={poly.id} className="flex items-center gap-2 px-6 py-1.5 hover:bg-slate-800/30 transition-colors border-b border-slate-700/20">
                            <button
                              onClick={() => togglePolygon(poly.id)}
                              className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                                selectedIds.has(poly.id)
                                  ? 'bg-emerald-500 border-emerald-500'
                                  : 'border-slate-600 hover:border-slate-500'
                              }`}
                            >
                              {selectedIds.has(poly.id) && <Check className="w-2.5 h-2.5 text-white" />}
                            </button>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {poly.id} — {poly.entityType} — {poly.vertices.length} vért.
                            </span>
                            {poly.closed && <span className="text-[9px] text-emerald-500/60">cerrado</span>}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-800/40 border border-slate-700/50 rounded-lg text-[10px] text-slate-400">
                <span>
                  Modo activo:{' '}
                  <strong className="text-emerald-400">
                    {importMode === 'ploteo' ? 'Ploteo Directo' : `Transformación (${method.toUpperCase()})`}
                  </strong>
                </span>
                <span>
                  {polygons.some((p) => p.isGeographic) ? 'Coordenadas Geográficas' : 'Coordenadas UTM'}
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleTransform}
                  disabled={transforming || selectedIds.size === 0}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {transforming ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                  Previsualizar
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || selectedIds.size === 0}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                  Importar ({selectedIds.size})
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
