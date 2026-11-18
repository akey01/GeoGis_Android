/**
 * useMeasureTool.ts — Interacción de medición sobre el mapa OpenLayers.
 *
 * Autocontenido: crea su propia VectorLayer/VectorSource y su propia Draw interaction.
 * No toca las capas ni las fuentes de MapViewer. Mientras hay una herramienta activa:
 *   - suspende Translate y DoubleClickZoom (se restauran al salir),
 *   - desactiva la Draw de "Nuevo Predio" (MapViewer sincroniza su propio estado),
 *   - MapViewer ignora el 'singleclick' de selección de parcelas.
 * Las medidas son temporales: viven solo en esta capa y se pierden al limpiar o recargar.
 */

import { useEffect, useRef } from 'react';
import type OLMap from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Draw from 'ol/interaction/Draw';
import type { DrawEvent } from 'ol/interaction/Draw';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import Translate from 'ol/interaction/Translate';
import { unByKey } from 'ol/Observable';
import type { EventsKey } from 'ol/events';
import type Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import type { Geometry, SimpleGeometry } from 'ol/geom';
import { Polygon, LineString, MultiPoint, Point } from 'ol/geom';
import { Style, Fill, Stroke, Text, Circle as CircleStyle } from 'ol/style';
import {
  buildGroundCircle,
  computeReading,
  mapLabel,
  type Coord,
  type MeasureKind,
  type MeasureReading,
  type MeasureUnits,
} from './measureUtils';
import { useMeasureStore } from './useMeasureStore';

const COLOR = '#facc15';
const OUTLINE = 'rgba(15, 23, 42, 0.85)';

// ── Lectura desde una geometría OL ───────────────────────────────────────────
function readingFromGeometry(kind: MeasureKind, geom: Geometry): MeasureReading | null {
  switch (kind) {
    case 'distance':
    case 'bearing': {
      const c = (geom as LineString).getCoordinates();
      return c.length >= 2 ? computeReading(kind, c as Coord[]) : null;
    }
    case 'area': {
      const ring = (geom as Polygon).getCoordinates()[0] as Coord[] | undefined;
      return ring && ring.length >= 3 ? computeReading('area', ring) : null;
    }
    case 'circle': {
      const center = geom.get('mCenter') as Coord | undefined;
      const edge = geom.get('mEdge') as Coord | undefined;
      return center && edge ? computeReading('circle', [center, edge]) : null;
    }
    case 'point': {
      const c = (geom as Point).getCoordinates() as Coord;
      return computeReading('point', [c]);
    }
  }
}

// ── Estilos ──────────────────────────────────────────────────────────────────
const dotStyleImage = new CircleStyle({
  radius: 4,
  fill: new Fill({ color: '#ffffff' }),
  stroke: new Stroke({ color: COLOR, width: 2 }),
});

function labelText(text: string, align: 'left' | 'center') {
  return new Text({
    text,
    font: '600 12px ui-monospace, SFMono-Regular, Menlo, monospace',
    fill: new Fill({ color: '#0f172a' }),
    backgroundFill: new Fill({ color: 'rgba(250, 204, 21, 0.95)' }),
    backgroundStroke: new Stroke({ color: OUTLINE, width: 1 }),
    padding: [3, 5, 3, 5],
    textAlign: align,
    offsetX: align === 'left' ? 10 : 0,
    offsetY: align === 'left' ? -14 : 0,
    overflow: true,
  });
}

function vertexCoords(geom: Geometry): Coord[] {
  switch (geom.getType()) {
    case 'LineString':
      return (geom as LineString).getCoordinates() as Coord[];
    case 'Polygon':
      return (geom as Polygon).getCoordinates()[0] as Coord[];
    case 'Point':
      return [(geom as Point).getCoordinates() as Coord];
    default:
      return [];
  }
}

function finishedStyles(feature: FeatureLike, units: MeasureUnits): Style[] {
  const geom = (feature as Feature).getGeometry();
  const kind = feature.get('mKind') as MeasureKind | undefined;
  if (!geom || !kind) return [];

  // Etiqueta cacheada por revisión de geometría + unidades (evita recalcular en cada frame)
  const key = `${geom.getRevision()}|${units.distance}|${units.area}`;
  let label = feature.get('mLabel') as string | undefined;
  if (feature.get('mLabelKey') !== key) {
    const reading = readingFromGeometry(kind, geom);
    label = reading ? mapLabel(reading, units) : '';
    (feature as Feature).set('mLabel', label, true);
    (feature as Feature).set('mLabelKey', key, true);
  }

  const styles: Style[] = [];
  if (kind === 'point') {
    const c = (geom as Point).getCoordinates();
    styles.push(
      new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: COLOR }),
          stroke: new Stroke({ color: OUTLINE, width: 2 }),
        }),
        text: label ? labelText(label, 'left') : undefined,
        geometry: new Point(c),
      })
    );
    return styles;
  }

  if (kind === 'area' || kind === 'circle') {
    styles.push(
      new Style({
        fill: new Fill({ color: 'rgba(250, 204, 21, 0.18)' }),
        stroke: new Stroke({ color: OUTLINE, width: 6 }),
      }),
      new Style({ stroke: new Stroke({ color: COLOR, width: 3 }) })
    );
    if (kind === 'area') {
      styles.push(
        new Style({ image: dotStyleImage, geometry: new MultiPoint(vertexCoords(geom).slice(0, -1)) })
      );
    }
    if (label) {
      const ip = (geom as Polygon).getInteriorPoint().getCoordinates();
      styles.push(new Style({ geometry: new Point([ip[0], ip[1]]), text: labelText(label, 'center') }));
    }
    return styles;
  }

  // distance | bearing
  const coords = vertexCoords(geom);
  styles.push(
    new Style({ stroke: new Stroke({ color: OUTLINE, width: 6 }) }),
    new Style({ stroke: new Stroke({ color: COLOR, width: 3 }) }),
    new Style({ image: dotStyleImage, geometry: new MultiPoint(coords) })
  );
  if (label && coords.length) {
    styles.push(new Style({ geometry: new Point(coords[coords.length - 1]), text: labelText(label, 'left') }));
  }
  return styles;
}

const sketchPointer = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: 'rgba(255,255,255,0.9)' }),
    stroke: new Stroke({ color: COLOR, width: 2 }),
  }),
});

function sketchStyle(feature: FeatureLike): Style[] {
  const geom = (feature as Feature).getGeometry();
  if (!geom) return [];
  if (geom.getType() === 'Point') return [sketchPointer];
  const styles: Style[] = [
    new Style({
      fill: new Fill({ color: 'rgba(250, 204, 21, 0.12)' }),
      stroke: new Stroke({ color: COLOR, width: 2.5, lineDash: [8, 5] }),
    }),
  ];
  const coords = vertexCoords(geom);
  if (coords.length) styles.push(new Style({ image: dotStyleImage, geometry: new MultiPoint(coords) }));
  return styles;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useMeasureTool(mapRef: { readonly current: OLMap | null }): void {
  const mode = useMeasureStore((s) => s.mode);
  const distanceUnit = useMeasureStore((s) => s.distanceUnit);
  const areaUnit = useMeasureStore((s) => s.areaUnit);
  const clearVersion = useMeasureStore((s) => s.clearVersion);

  const sourceRef = useRef<VectorSource | null>(null);
  if (!sourceRef.current) sourceRef.current = new VectorSource();
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const unitsRef = useRef<MeasureUnits>({ distance: distanceUnit, area: areaUnit });
  unitsRef.current = { distance: distanceUnit, area: areaUnit };
  const lastClearRef = useRef(clearVersion);

  // 1) Capa propia de medidas (se monta una vez que el mapa existe)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = new VectorLayer({
      source: sourceRef.current!,
      zIndex: 1000,
      updateWhileInteracting: true,
      updateWhileAnimating: true,
      style: (f) => finishedStyles(f, unitsRef.current),
    });
    map.addLayer(layer);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [mapRef]);

  // 2) Repintar etiquetas al cambiar unidades
  useEffect(() => {
    layerRef.current?.changed();
  }, [distanceUnit, areaUnit]);

  // 3) Borrar todas las medidas
  useEffect(() => {
    if (clearVersion === lastClearRef.current) return;
    lastClearRef.current = clearVersion;
    sourceRef.current?.clear();
  }, [clearVersion]);

  // 4) Interacción de dibujo según la herramienta activa
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mode === 'off') return;
    const kind: MeasureKind = mode;
    const source = sourceRef.current!;
    const store = useMeasureStore;

    // Suspender interacciones que entran en conflicto
    const toRestore: Array<{ i: Translate | DoubleClickZoom; wasActive: boolean }> = [];
    map.getInteractions().forEach((i) => {
      if (i instanceof Translate || i instanceof DoubleClickZoom) {
        toRestore.push({ i, wasActive: i.getActive() });
        i.setActive(false);
      } else if (i instanceof Draw) {
        // Draw de "Nuevo Predio": MapViewer sincroniza su flag isDrawing al activarse la medición
        i.setActive(false);
      }
    });

    const draw = new Draw({
      source,
      style: sketchStyle,
      type: kind === 'area' ? 'Polygon' : kind === 'circle' ? 'Circle' : kind === 'point' ? 'Point' : 'LineString',
      ...(kind === 'bearing' ? { maxPoints: 2, minPoints: 2 } : {}),
      ...(kind === 'circle'
        ? {
            geometryFunction: (coords: any, geometry?: SimpleGeometry) => {
              const center = coords[0] as Coord;
              const edge = coords[1] as Coord;
              const ring = buildGroundCircle(center, edge);
              const poly = (geometry as Polygon) ?? new Polygon([]);
              poly.setCoordinates([ring]);
              poly.set('mCenter', center, true);
              poly.set('mEdge', edge, true);
              return poly;
            },
          }
        : {}),
    });
    map.addInteraction(draw);

    const viewport = map.getViewport() as HTMLElement;
    const prevCursor = viewport.style.cursor;
    viewport.style.cursor = 'crosshair';

    let sketching = false;
    let raf = 0;
    let changeKey: EventsKey | null = null;

    const pushLive = (geom: Geometry) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = readingFromGeometry(kind, geom);
        if (r) store.getState().setReading(r, true);
      });
    };

    draw.on('drawstart', (evt: DrawEvent) => {
      sketching = true;
      const geom = evt.feature.getGeometry();
      if (geom) {
        changeKey = geom.on('change', () => pushLive(geom));
        pushLive(geom);
      }
    });
    draw.on('drawend', (evt: DrawEvent) => {
      sketching = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (changeKey) { unByKey(changeKey); changeKey = null; }
      evt.feature.set('mKind', kind);
      const geom = evt.feature.getGeometry();
      const r = geom ? readingFromGeometry(kind, geom) : null;
      store.getState().setReading(r, false);
    });
    draw.on('drawabort', () => {
      sketching = false;
      store.getState().setReading(null, false);
    });

    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape') {
        if (sketching) draw.abortDrawing();
        else store.getState().setMode('off');
      } else if (sketching && (e.key === 'Backspace' || (e.ctrlKey && e.key.toLowerCase() === 'z'))) {
        draw.removeLastPoint();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (raf) cancelAnimationFrame(raf);
      try { draw.abortDrawing(); } catch { /* noop */ }
      map.removeInteraction(draw);
      viewport.style.cursor = prevCursor;
      toRestore.forEach(({ i, wasActive }) => i.setActive(wasActive));
    };
  }, [mapRef, mode]);
}
