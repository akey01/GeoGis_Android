'use client';

import React, { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { GeoEngine, HAYFORD, GRS80 } from '@/lib/geo-engine';
import { Activity, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import AdicoraRigidControls from '@/components/dashboard/AdicoraRigidControls';
import { getRoleConstraints, hasPermission } from '@/src/types/auth';
import { toast } from 'react-hot-toast';

export default function TransformationForm() {
  const {
    routine,
    direction,
    method,
    coordType,
    geometryType,
    setGeometryType,
    huso,
    rigidCorrection,
    setRigidCorrection,
    adicoraCorrection,
    autoResiduoMalla,
    setAutoResiduoMalla,
    results,
    clearResults,
    setResults,
    user,
  } = useAppStore();
  const [loading, setLoading] = useState(false);

  const [inX, setInX] = useState('');
  const [inY, setInY] = useState('');
  const [inH, setInH] = useState('0');
  const [esFormatoInverso, setEsFormatoInverso] = useState(false);

  const roleConstraints = getRoleConstraints(user?.rol);
  const canEditDatumParams = hasPermission(user?.rol, 'edit_datum_params');

  // Leer directamente del store (no useState local) para que ambos modos (simple/lotes)
  // siempre compartan el mismo valor sin reseteo al montar el componente.
  const dn = String(rigidCorrection.dn);
  const de = String(rigidCorrection.de);
  const setDn = (val: string) => {
    if (!canEditDatumParams) {
      toast.error('Su rol no permite editar parámetros manuales de datum.');
      return;
    }
    setRigidCorrection({ dn: parseFloat(val) || 0, de: rigidCorrection.de });
  };
  const setDe = (val: string) => {
    if (!canEditDatumParams) {
      toast.error('Su rol no permite editar parámetros manuales de datum.');
      return;
    }
    setRigidCorrection({ dn: rigidCorrection.dn, de: parseFloat(val) || 0 });
  };

  const handleTransform = (action: 'replace' | 'add' = 'replace') => {
    if (
      action === 'add' &&
      roleConstraints.maxVerticesPerCalculation !== null &&
      results.length >= roleConstraints.maxVerticesPerCalculation
    ) {
      toast.error(
        `Límite alcanzado: el rol ${roleConstraints.label} permite máximo ${roleConstraints.maxVerticesPerCalculation} vértices por cálculo.`
      );
      return;
    }
    setLoading(true);
    try {
      const rawX = parseFloat(inX);
      const rawY = parseFloat(inY);
      // Preservar alturas elipsoidales negativas (ej. -20 m en Falcón/Paraguaná por ondulación geoidal)
      const hRaw = parseFloat(inH);
      const h = isNaN(hRaw) ? 0 : hRaw;

      if (isNaN(rawX) || isNaN(rawY)) {
        alert('Por favor ingrese coordenadas válidas');
        return;
      }

      // Normalización inteligente según tipo de coordenada
      let x = rawX; // Este o Latitud o X
      let y = rawY; // Norte o Longitud o Y

      if (coordType === 'utm') {
        if (esFormatoInverso) {
          // El usuario marcó explícitamente que Campo 1 es Norte y Campo 2 es Este
          x = rawY; // Este
          y = rawX; // Norte
        } else if (rawX > 1000000 && rawY < 1000000) {
          // Auto-detección inteligente: en Venezuela Norte > 1.000.000m y Este < 1.000.000m
          x = rawY; // Este
          y = rawX; // Norte
        } else {
          x = rawX; // Este
          y = rawY; // Norte
        }
      } else if (coordType === 'geo') {
        // En Venezuela: Latitud está en [0.4, 13] N, Longitud está en [-74, -59] W
        let lat = rawX;
        let lng = rawY;

        if (Math.abs(rawX) > 50 && Math.abs(rawY) <= 15) {
          // Usuario ingresó Longitud en Campo 1 y Latitud en Campo 2
          lng = -Math.abs(rawX);
          lat = Math.abs(rawY);
        } else {
          lat = Math.abs(rawX);
          lng = rawY < 0 ? rawY : -Math.abs(rawY);
        }
        x = lat;
        y = lng;
      }

      const pointId = action === 'add' ? `P${results.length + 1}` : 'P1';

      let result;
      const inv = direction === 'regven_canoa';
      const elO = inv ? GRS80 : HAYFORD;
      const elD = inv ? HAYFORD : GRS80;

      if (routine === 'ploteo') {
        if (coordType === 'utm') {
          const geo = GeoEngine.utmToGeo(x, y, huso, false, GRS80);
          result = {
            id: pointId,
            input: { este: x, norte: y, huso, alt: h },
            result: { este: x, norte: y, lat: geo.lat, lng: geo.lng, huso, dLineal: 0 },
            ok: true
          };
        } else if (coordType === 'geo') {
          const utm = GeoEngine.geoToUTM(x, y, huso, GRS80);
          result = {
            id: pointId,
            input: { lat: x, lng: y, huso, alt: h },
            result: { este: utm.este, norte: utm.norte, lat: x, lng: y, huso, dLineal: 0 },
            ok: true
          };
        } else if (coordType === 'cart') {
          const geo = GeoEngine.cartToGeo(x, y, h, GRS80);
          const utm = GeoEngine.geoToUTM(geo.lat, geo.lng, huso, GRS80);
          result = {
            id: pointId,
            input: { x, y, alt: h },
            result: { este: utm.este, norte: utm.norte, lat: geo.lat, lng: geo.lng, huso, dLineal: 0 },
            ok: true
          };
        }
      } else if (method === 'rigida') {
        // Leer directamente del store (ya sincronizado)
        const dnVal = autoResiduoMalla ? undefined : rigidCorrection.dn;
        const deVal = autoResiduoMalla ? undefined : rigidCorrection.de;

        if (coordType === 'utm') {
          const r = GeoEngine.transformRigida(x, y, h, huso, inv, dnVal, deVal);
          result = {
            id: pointId,
            input: { este: x, norte: y, huso, alt: h },
            result: r,
            ok: true
          };
        } else if (coordType === 'geo') {
          const utmO = GeoEngine.geoToUTM(x, y, huso, elO);
          const r = GeoEngine.transformRigida(utmO.este, utmO.norte, h, huso, inv, dnVal, deVal);
          result = {
            id: pointId,
            input: { lat: x, lng: y, huso, alt: h },
            result: r,
            ok: true
          };
        } else {
          const geo = GeoEngine.cartToGeo(x, y, h, elO);
          const utmO = GeoEngine.geoToUTM(geo.lat, geo.lng, huso, elO);
          const r = GeoEngine.transformRigida(utmO.este, utmO.norte, h, huso, inv, dnVal, deVal);
          result = {
            id: pointId,
            input: { x, y, alt: h },
            result: r,
            ok: true
          };
        }
      } else if (method === 'rigida02') {
        // RIGIDA02: Motor local Adícora (PSAD-56 → REGVEN) con deltas editables
        let norte = y;
        let este = x;
        if (coordType === 'geo') {
          const utmTemp = GeoEngine.geoToUTM(x, y, huso, HAYFORD);
          norte = utmTemp.norte;
          este = utmTemp.este;
        } else if (coordType === 'cart') {
          const geoTemp = GeoEngine.cartToGeo(x, y, h, HAYFORD);
          const utmTemp = GeoEngine.geoToUTM(geoTemp.lat, geoTemp.lng, huso, HAYFORD);
          norte = utmTemp.norte;
          este = utmTemp.este;
        }

        const r02 = GeoEngine.transformRigida02([
          { id: pointId, norte_origen: norte, este_origen: este, cota_origen: h },
          { id: 'P02_AUX', norte_origen: norte, este_origen: este + 1.0, cota_origen: h },
        ], {
          deltaEste: adicoraCorrection?.de,
          deltaNorte: adicoraCorrection?.dn,
          cotaGeoidal: adicoraCorrection?.cotaGeoidal,
        });
        const v = r02.resultados[0];
        const geoD = GeoEngine.utmToGeo(v.este_regven, v.norte_regven, huso, false, GRS80);
        result = {
          id: pointId,
          input: { este: v.este_canoa, norte: v.norte_canoa, huso, alt: h },
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
      } else if (method === 'dma_badekas' || method === 'dma_badekas_regven') {
        const dmaType = method === 'dma_badekas' ? 'dma_psad56_real' : 'dma_regven';
        if (coordType === 'utm') {
          // x ya viene como Este e y como Norte tras la normalización inicial
          const r = GeoEngine.transformDma(x, y, h, huso, dmaType, false);
          result = { id: pointId, input: { este: x, norte: y, huso, alt: h }, result: r, ok: true };
        } else if (coordType === 'geo') {
          const utmO = GeoEngine.geoToUTM(x, y, huso, HAYFORD);
          const r = GeoEngine.transformDma(utmO.este, utmO.norte, h, huso, dmaType, false);
          result = { id: pointId, input: { lat: x, lng: y, huso, alt: h }, result: r, ok: true };
        } else {
          const geo = GeoEngine.cartToGeo(x, y, h, HAYFORD);
          const utmO = GeoEngine.geoToUTM(geo.lat, geo.lng, huso, HAYFORD);
          const r = GeoEngine.transformDma(utmO.este, utmO.norte, h, huso, dmaType, false);
          result = { id: pointId, input: { x, y, alt: h }, result: r, ok: true };
        }
      } else {
        // Badekas
        if (coordType === 'utm') {
          const geoO = GeoEngine.utmToGeo(x, y, huso, false, elO);
          const cart = GeoEngine.geoToCart(geoO.lat, geoO.lng, h, elO);
          const cartT = GeoEngine.badekas(cart.X, cart.Y, cart.Z, inv);
          const geoD = GeoEngine.cartToGeo(cartT.X, cartT.Y, cartT.Z, elD);
          const utmD = GeoEngine.geoToUTM(geoD.lat, geoD.lng, huso, elD);

          result = {
            id: pointId,
            input: { este: x, norte: y, huso, alt: h },
            result: {
              este: utmD.este,
              norte: utmD.norte,
              lat: geoD.lat,
              lng: geoD.lng,
              huso,
              dLineal: Math.sqrt(Math.pow(utmD.este - x, 2) + Math.pow(utmD.norte - y, 2))
            },
            ok: true
          };
        } else if (coordType === 'geo') {
          const cart = GeoEngine.geoToCart(x, y, h, elO);
          const cartT = GeoEngine.badekas(cart.X, cart.Y, cart.Z, inv);
          const geoD = GeoEngine.cartToGeo(cartT.X, cartT.Y, cartT.Z, elD);
          const utmD = GeoEngine.geoToUTM(geoD.lat, geoD.lng, huso, elD);

          result = {
            id: pointId,
            input: { lat: x, lng: y, huso, alt: h },
            result: {
              este: utmD.este,
              norte: utmD.norte,
              lat: geoD.lat,
              lng: geoD.lng,
              huso,
              dLineal: 0
            },
            ok: true
          };
        } else if (coordType === 'cart') {
          const cartT = GeoEngine.badekas(x, y, h, inv);
          const geoD = GeoEngine.cartToGeo(cartT.X, cartT.Y, cartT.Z, elD);
          const utmD = GeoEngine.geoToUTM(geoD.lat, geoD.lng, huso, elD);

          result = {
            id: pointId,
            input: { x, y, alt: h },
            result: {
              este: utmD.este,
              norte: utmD.norte,
              lat: geoD.lat,
              lng: geoD.lng,
              huso,
              dLineal: 0
            },
            ok: true
          };
        }
      }

      if (result) {
        result.direction = routine === 'ploteo' || method === 'rigida02' ? 'canoa_regven' : direction;
        if (result.result && result.result.huso == null) {
          result.result.huso = huso;
        }
        if (action === 'add') {
          setResults([...results, result as any]);
          setInX('');
          setInY('');
        } else {
          setResults([result as any]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl space-y-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
            {coordType === 'utm'
              ? (esFormatoInverso ? <><span className="text-cyan-400">↕</span> Campo 1 — Coordenada Norte (Y)</> : 'Campo 1 — Coordenada Este (X)')
              : coordType === 'cart' ? 'Coordenada X (m)' : 'Campo 1 — Latitud (°N)'}
          </label>
          <input
            type="number"
            value={inX}
            onChange={(e) => setInX(e.target.value)}
            placeholder={coordType === 'utm' ? (esFormatoInverso ? '1327653.220' : '409662.260') : coordType === 'cart' ? '2464351.594' : '10.4880000'}
            className={`w-full bg-slate-950/50 border rounded-lg px-3 py-2 text-sm font-mono placeholder:text-slate-700 outline-none transition-all ${esFormatoInverso
              ? 'border-cyan-500/40 text-cyan-400 focus:border-cyan-500/70'
              : 'border-slate-800 text-emerald-400 focus:border-emerald-500/50'
              }`}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
            {coordType === 'utm'
              ? (esFormatoInverso ? <><span className="text-cyan-400">↔</span> Campo 2 — Coordenada Este (X)</> : 'Campo 2 — Coordenada Norte (Y)')
              : coordType === 'cart' ? 'Coordenada Y (m)' : 'Campo 2 — Longitud (°W)'}
          </label>
          <input
            type="number"
            value={inY}
            onChange={(e) => setInY(e.target.value)}
            placeholder={coordType === 'utm' ? (esFormatoInverso ? '409662.260' : '1327653.220') : coordType === 'cart' ? '-5783466.613' : '-66.8790000'}
            className={`w-full bg-slate-950/50 border rounded-lg px-3 py-2 text-sm font-mono placeholder:text-slate-700 outline-none transition-all ${esFormatoInverso
              ? 'border-cyan-500/40 text-cyan-400 focus:border-cyan-500/70'
              : 'border-slate-800 text-emerald-400 focus:border-emerald-500/50'
              }`}
          />
        </div>
      </div>

      {(coordType === 'utm' || method === 'dma_badekas' || method === 'dma_badekas_regven') && (
        <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl space-y-1.5">
          <label className="text-[10px] font-bold text-cyan-400 uppercase flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={esFormatoInverso}
              onChange={(e) => setEsFormatoInverso(e.target.checked)}
              className="accent-cyan-500 w-3.5 h-3.5 cursor-pointer"
            />
            Formato Inverso de Entrada (Norte en Campo 1, Este en Campo 2)
          </label>
          <p className="text-[9px] text-cyan-300/80 italic">
            {esFormatoInverso
              ? '↕ Activo: Campo 1 = Norte (Y) | Campo 2 = Este (X)'
              : '→ Estándar: Campo 1 = Este (X) | Campo 2 = Norte (Y) (Auto-corrige si Norte > 1.000.000)'}
          </p>
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

      <div className="space-y-2 pt-1">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleTransform('replace')}
            disabled={loading}
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg shadow-emerald-600/20 active:scale-95 transition-all flex items-center justify-center gap-1.5"
            title="Calcular/plotear y centrar mapa en este punto"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : (
              <>
                <Activity className="w-4 h-4" />
                {routine === 'ploteo' ? 'Plotear Punto' : 'Calcular Punto'}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTransform('add')}
            disabled={loading}
            className="w-full h-12 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg shadow-cyan-600/20 active:scale-95 transition-all flex items-center justify-center gap-1.5 border border-cyan-400/30"
            title="Añadir este punto como nuevo vértice a la parcela y centrarla en el mapa"
          >
            <span className="text-base font-black leading-none">+</span>
            <span>Vértice P{results.length + 1}</span>
          </button>
        </div>

        {results.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-[10px]">
            <span className="text-slate-400 font-mono">
              <span className="text-emerald-400 font-bold">{results.length}</span> vértice{results.length > 1 ? 's' : ''} en cálculo activo
            </span>
            <button
              type="button"
              onClick={clearResults}
              className="text-red-400 hover:text-red-300 font-bold uppercase tracking-wider transition-colors"
            >
              Limpiar Vértices
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
