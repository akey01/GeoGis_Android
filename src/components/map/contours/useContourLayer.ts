/**
 * useContourLayer.ts — Capa Vectorial OpenLayers para Curvas de Nivel Satelitales por Parcela
 * GeoGIS6
 *
 * Autocontenida: crea su propia VectorLayer/VectorSource sin alterar las capas existentes de MapViewer.
 */

'use client';

import { useEffect, useRef } from 'react';
import type OLMap from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import { LineString, Point } from 'ol/geom';
import { transform } from 'ol/proj';
import { Style, Stroke, Fill, Text, Circle as CircleStyle } from 'ol/style';
import { useAppStore } from '@/lib/store';
import { useContourStore } from './useContourStore';
import { isCanoaOutputDirection, normalizeHuso } from './contourEngine';

const styleCache = new Map<string, Style[]>();

function contourFeatureStyle(feature: FeatureLike, resolution: number): Style[] | undefined {
  const kind = feature.get('cKind') as 'line' | 'extreme' | 'gridLine' | 'gridNode' | undefined;

  if (kind === 'gridLine') {
    const spacingLabel = (feature.get('spacingLabel') as string) || '';
    const showLabel = Boolean(spacingLabel) && resolution < 2.2;
    const key = `gl-${showLabel ? spacingLabel : 'nolabel'}`;
    const cached = styleCache.get(key);
    if (cached) return cached;

    const styles: Style[] = [
      new Style({
        zIndex: 1,
        stroke: new Stroke({
          color: 'rgba(15, 23, 42, 0.72)',
          width: 2.2,
          lineDash: [4, 4],
        }),
      }),
      new Style({
        zIndex: 1,
        stroke: new Stroke({
          color: 'rgba(167, 243, 208, 0.85)',
          width: 1.1,
          lineDash: [4, 4],
        }),
        text: showLabel
          ? new Text({
              text: spacingLabel,
              placement: 'line',
              font: '600 9px ui-monospace, SFMono-Regular, monospace',
              fill: new Fill({ color: '#a7f3d0' }),
              stroke: new Stroke({ color: '#0f172a', width: 3 }),
              overflow: true,
              maxAngle: Math.PI / 4,
            })
          : undefined,
      }),
    ];
    if (styleCache.size > 400) styleCache.clear();
    styleCache.set(key, styles);
    return styles;
  }

  if (kind === 'gridNode') {
    const zLabel = (feature.get('zLabel') as string) || '';
    const showZ = resolution < 2.8;
    const key = `gn-${showZ ? zLabel : 'dot'}`;
    const cached = styleCache.get(key);
    if (cached) return cached;

    const styles: Style[] = [
      new Style({
        zIndex: 2,
        image: new CircleStyle({
          radius: 2.5,
          fill: new Fill({ color: '#34d399' }),
          stroke: new Stroke({ color: '#0f172a', width: 1.4 }),
        }),
        text: showZ
          ? new Text({
              text: zLabel,
              font: '600 9px ui-monospace, SFMono-Regular, monospace',
              fill: new Fill({ color: '#d1fae5' }),
              stroke: new Stroke({ color: '#0f172a', width: 2.8 }),
              offsetY: -8,
              overflow: true,
            })
          : undefined,
      }),
    ];
    if (styleCache.size > 400) styleCache.clear();
    styleCache.set(key, styles);
    return styles;
  }

  if (kind === 'extreme') {
    const extType = feature.get('extType') as 'min' | 'max';
    const label = (feature.get('cLabel') as string) || '';
    const key = `ext-${extType}-${label}-${resolution < 6 ? '1' : '0'}`;
    const cached = styleCache.get(key);
    if (cached) return cached;

    const fillColor = extType === 'max' ? '#10b981' : '#38bdf8';
    const textColor = extType === 'max' ? '#6ee7b7' : '#7dd3fc';
    const styles = [
      new Style({
        zIndex: 6,
        image: new CircleStyle({
          radius: 4.5,
          fill: new Fill({ color: fillColor }),
          stroke: new Stroke({ color: '#0f172a', width: 2 }),
        }),
        text:
          resolution < 8
            ? new Text({
                text: label,
                font: 'bold 10px ui-monospace, SFMono-Regular, monospace',
                fill: new Fill({ color: textColor }),
                stroke: new Stroke({ color: '#0f172a', width: 3 }),
                offsetY: extType === 'max' ? -13 : 13,
                overflow: true,
              })
            : undefined,
      }),
    ];
    if (styleCache.size > 400) styleCache.clear();
    styleCache.set(key, styles);
    return styles;
  }

  const isMaster = feature.get('isMaster') === true;
  const elevText = (feature.get('elevText') as string) || '';
  const showLabel = isMaster ? resolution < 6.5 : resolution < 0.75;
  const key = `${isMaster ? 'M' : 'I'}-${showLabel ? elevText : 'nolabel'}`;

  const cached = styleCache.get(key);
  if (cached) return cached;

  const styles: Style[] = isMaster
    ? [
        new Style({
          zIndex: 4,
          stroke: new Stroke({ color: 'rgba(15, 23, 42, 0.85)', width: 4.2, lineCap: 'round', lineJoin: 'round' }),
        }),
        new Style({
          zIndex: 4,
          stroke: new Stroke({ color: '#f59e0b', width: 2.3, lineCap: 'round', lineJoin: 'round' }),
          text: showLabel
            ? new Text({
                text: `${elevText} m`,
                placement: 'line',
                font: 'bold 10px ui-monospace, SFMono-Regular, monospace',
                fill: new Fill({ color: '#fef3c7' }),
                stroke: new Stroke({ color: '#0f172a', width: 3.5 }),
                overflow: false,
                maxAngle: Math.PI / 4,
              })
            : undefined,
        }),
      ]
    : [
        new Style({
          zIndex: 3,
          stroke: new Stroke({ color: 'rgba(15, 23, 42, 0.55)', width: 2.3, lineCap: 'round', lineJoin: 'round' }),
        }),
        new Style({
          zIndex: 3,
          stroke: new Stroke({ color: '#38bdf8', width: 1.25, lineCap: 'round', lineJoin: 'round' }),
          text: showLabel
            ? new Text({
                text: `${elevText}`,
                placement: 'line',
                font: '600 9px ui-monospace, SFMono-Regular, monospace',
                fill: new Fill({ color: '#e0f2fe' }),
                stroke: new Stroke({ color: '#0f172a', width: 3 }),
                overflow: false,
                maxAngle: Math.PI / 4,
              })
            : undefined,
        }),
      ];

  if (styleCache.size > 400) styleCache.clear();
  styleCache.set(key, styles);
  return styles;
}

export function useContourLayer(mapRef: { readonly current: OLMap | null }): void {
  const contoursByParcelId = useContourStore((s) => s.contoursByParcelId);
  const visibleParcelIds = useContourStore((s) => s.visibleParcelIds);
  const showMapGrid = useContourStore((s) => s.showMapGrid);
  const showMapGridNodes = useContourStore((s) => s.showMapGridNodes);
  const clearAllContours = useContourStore((s) => s.clearAllContours);
  const savedParcels = useAppStore((s) => s.savedParcels);
  const resultsLen = useAppStore((s) => s.results.length);

  const sourceRef = useRef<VectorSource | null>(null);
  if (!sourceRef.current) sourceRef.current = new VectorSource();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  // Limpiar caché cuando el proyecto queda sin parcelas ni resultados activos
  useEffect(() => {
    if (savedParcels.length === 0 && resultsLen === 0 && visibleParcelIds.length > 0) {
      clearAllContours();
    }
  }, [savedParcels.length, resultsLen, visibleParcelIds.length, clearAllContours]);

  // Montar capa propia en OpenLayers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layer = new VectorLayer({
      source: sourceRef.current!,
      zIndex: 10,
      updateWhileInteracting: false,
      updateWhileAnimating: false,
      style: contourFeatureStyle,
    });
    map.addLayer(layer);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [mapRef]);

  // Reconstruir features al cambiar parcelas visibles o equidistancia
  useEffect(() => {
    const map = mapRef.current;
    const source = sourceRef.current;
    if (!source) return;

    if (map && !layerRef.current) {
      const layer = new VectorLayer({
        source,
        zIndex: 10,
        updateWhileInteracting: false,
        updateWhileAnimating: false,
        style: contourFeatureStyle,
      });
      map.addLayer(layer);
      layerRef.current = layer;
    }

    source.clear(true);

    const features: Feature[] = [];

    for (const pid of visibleParcelIds) {
      const data = contoursByParcelId[pid];
      if (!data) continue;

      const h = normalizeHuso(data.huso, 19);
      const sourceEpsg = isCanoaOutputDirection(data.direction)
        ? `EPSG:248${h}`
        : `EPSG:220${h - 17}`;

      // Cuadrícula interna de muestreo DEM (ΔE × ΔN) sobre la capa satelital
      if (showMapGrid) {
        const gridLines = data.clippedGridLinesUTM ?? [];
        const spacingE =
          data.gridSpacingE ??
          Number(((data.rawGrid.maxE - data.rawGrid.minE) / Math.max(1, data.gridCols - 1)).toFixed(2));
        const spacingN =
          data.gridSpacingN ??
          Number(((data.rawGrid.maxN - data.rawGrid.minN) / Math.max(1, data.gridRows - 1)).toFixed(2));

        let longestEIdx = -1;
        let longestELen = 0;
        let longestNIdx = -1;
        let longestNLen = 0;
        gridLines.forEach((gl, idx) => {
          if (gl.coordsUTM.length < 2) return;
          let len = 0;
          for (let k = 0; k < gl.coordsUTM.length - 1; k++) {
            len += Math.hypot(
              gl.coordsUTM[k + 1][0] - gl.coordsUTM[k][0],
              gl.coordsUTM[k + 1][1] - gl.coordsUTM[k][1]
            );
          }
          if (gl.axis === 'E' && len > longestELen) {
            longestELen = len;
            longestEIdx = idx;
          } else if (gl.axis === 'N' && len > longestNLen) {
            longestNLen = len;
            longestNIdx = idx;
          }
        });

        gridLines.forEach((gl, idx) => {
          if (gl.coordsUTM.length < 2) return;
          const coords3857 = gl.coordsUTM.map(([e, n]) =>
            transform([e, n], sourceEpsg, 'EPSG:3857')
          );
          const feat = new Feature({
            geometry: new LineString(coords3857),
          });
          feat.set('cKind', 'gridLine', true);
          feat.set('parcelId', pid, true);
          if (idx === longestEIdx) {
            feat.set('spacingLabel', `ΔE ${spacingE}m`, true);
          } else if (idx === longestNIdx) {
            feat.set('spacingLabel', `ΔN ${spacingN}m`, true);
          }
          features.push(feat);
        });
      }

      // Nodos internos con cota Z sobre la capa satelital
      if (showMapGridNodes) {
        for (const gn of data.interiorGridNodes ?? []) {
          try {
            const pt3857 = transform([gn.este, gn.norte], sourceEpsg, 'EPSG:3857');
            const nodeFeat = new Feature({ geometry: new Point(pt3857) });
            nodeFeat.set('cKind', 'gridNode', true);
            nodeFeat.set('parcelId', pid, true);
            nodeFeat.set('zLabel', `${gn.z.toFixed(1)}`, true);
            features.push(nodeFeat);
          } catch {
            // Ignorar si falla proyección puntual
          }
        }
      }

      for (const c of data.contours) {
        if (c.coordsUTM.length < 2) continue;
        const coords3857 = c.coordsUTM.map(([e, n]) =>
          transform([e, n], sourceEpsg, 'EPSG:3857')
        );
        const feat = new Feature({
          geometry: new LineString(coords3857),
        });
        feat.set('cKind', 'line', true);
        feat.set('parcelId', pid, true);
        feat.set('isMaster', c.isMaster, true);
        feat.set(
          'elevText',
          c.elevation % 1 === 0 ? c.elevation.toFixed(0) : c.elevation.toFixed(1),
          true
        );
        features.push(feat);
      }

      // Marcadores de cotas extremas (Mínima y Máxima dentro del predio)
      try {
        const min3857 = transform(
          [data.minPointUTM.este, data.minPointUTM.norte],
          sourceEpsg,
          'EPSG:3857'
        );
        const minFeat = new Feature({ geometry: new Point(min3857) });
        minFeat.set('cKind', 'extreme', true);
        minFeat.set('extType', 'min', true);
        minFeat.set('parcelId', pid, true);
        minFeat.set('cLabel', `▼ Mín ${data.minZ.toFixed(1)}m`, true);
        features.push(minFeat);

        const max3857 = transform(
          [data.maxPointUTM.este, data.maxPointUTM.norte],
          sourceEpsg,
          'EPSG:3857'
        );
        const maxFeat = new Feature({ geometry: new Point(max3857) });
        maxFeat.set('cKind', 'extreme', true);
        maxFeat.set('extType', 'max', true);
        maxFeat.set('parcelId', pid, true);
        maxFeat.set('cLabel', `▲ Máx ${data.maxZ.toFixed(1)}m`, true);
        features.push(maxFeat);
      } catch {
        // Ignorar si falla proyección puntual
      }
    }

    if (features.length > 0) {
      source.addFeatures(features);
    }
    source.changed();
    layerRef.current?.changed();
    mapRef.current?.render();
  }, [contoursByParcelId, visibleParcelIds, showMapGrid, showMapGridNodes, mapRef]);
}
