import type { Parcel, TransformationResult } from './store';

export interface Point2DUnion {
  x: number;
  y: number;
  id: string;
  raw?: TransformationResult;
}

const DEFAULT_SNAP_TOL = 0.05; // 5 cm de tolerancia de soldadura topográfica

function signedArea2D(pts: Array<{ x: number; y: number }>): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum * 0.5;
}

function polygonPerimeter2D(pts: Array<{ x: number; y: number }>): number {
  if (pts.length < 2) return 0;
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    perim += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return perim;
}

function distPtToSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { dist: number; t: number; qx: number; qy: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) {
    return { dist: Math.hypot(px - ax, py - ay), t: 0, qx: ax, qy: ay };
  }
  const rawT = ((px - ax) * dx + (py - ay) * dy) / len2;
  const t = Math.max(0, Math.min(1, rawT));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return { dist: Math.hypot(px - qx, py - qy), t, qx, qy };
}

function pointInPolygonStrict(px: number, py: number, poly: Array<{ x: number; y: number }>, boundaryEps = 1e-5): boolean {
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (distPtToSeg(px, py, a.x, a.y, b.x, b.y).dist <= boundaryEps) {
      return false;
    }
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-30) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentIntersectionParams(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number }
): { t: number; u: number; x: number; y: number } | null {
  const rX = b.x - a.x;
  const rY = b.y - a.y;
  const sX = d.x - c.x;
  const sY = d.y - c.y;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) <= 1e-10) return null;

  const qpx = c.x - a.x;
  const qpy = c.y - a.y;
  const t = (qpx * sY - qpy * sX) / denom;
  const u = (qpx * rY - qpy * rX) / denom;

  if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
    return { t, u, x: a.x + t * rX, y: a.y + t * rY };
  }
  return null;
}

function dedupeConsecutive<T extends { x: number; y: number }>(pts: T[], tol = 1e-5): T[] {
  const out: T[] = [];
  for (const p of pts) {
    if (out.length === 0 || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) > tol) {
      out.push(p);
    }
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= tol) {
    out.pop();
  }
  return out;
}

function removeCollinear<T extends { x: number; y: number }>(pts: T[], distTol = 0.01): T[] {
  let curr = dedupeConsecutive(pts, 1e-4);
  if (curr.length <= 3) return curr;
  let changed = true;
  while (changed && curr.length > 3) {
    changed = false;
    const next: T[] = [];
    const n = curr.length;
    for (let i = 0; i < n; i++) {
      const prev = curr[(i - 1 + n) % n];
      const p = curr[i];
      const nxt = curr[(i + 1) % n];
      const dx1 = p.x - prev.x;
      const dy1 = p.y - prev.y;
      const dx2 = nxt.x - p.x;
      const dy2 = nxt.y - p.y;
      const len1 = Math.hypot(dx1, dy1);
      const len2 = Math.hypot(dx2, dy2);
      if (len1 < 1e-6 || len2 < 1e-6) {
        changed = true;
        continue;
      }
      const dot = dx1 * dx2 + dy1 * dy2;
      const perpDist = distPtToSeg(p.x, p.y, prev.x, prev.y, nxt.x, nxt.y).dist;
      if (dot > 0 && perpDist <= distTol) {
        changed = true;
        continue;
      }
      next.push(p);
    }
    curr = next;
  }
  return curr;
}

function convexHullCCW<T extends { x: number; y: number }>(points: T[]): T[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (o: T, a: T, b: T) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: T[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: T[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * Extrae las coordenadas UTM (este/norte) de una parcela del store.
 */
export function extractParcelPoints2D(parcel: Parcel): Point2DUnion[] {
  const pts: Point2DUnion[] = [];
  const rawPts = parcel.puntos || [];
  for (let i = 0; i < rawPts.length; i++) {
    const pt: any = rawPts[i];
    const x = Number(pt?.result?.este ?? pt?.result?.x ?? pt?.input?.este ?? pt?.x ?? NaN);
    const y = Number(pt?.result?.norte ?? pt?.result?.y ?? pt?.input?.norte ?? pt?.y ?? NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      pts.push({
        x,
        y,
        id: String(pt?.id || i + 1),
        raw: pt,
      });
    }
  }
  return pts;
}

function quantKey(x: number, y: number): string {
  return `${Math.round(x * 1000)}:${Math.round(y * 1000)}`;
}

/**
 * Unifica múltiples polígonos cerrados conservando ÚNICAMENTE los vértices del contorno exterior.
 * Elimina linderos internos compartidos, vértices interiores y puntos colineales redundantes.
 */
export function unifyPolygonsExterior(
  polygons: Array<Array<{ x: number; y: number; id?: string; raw?: TransformationResult }>>,
  snapTol = DEFAULT_SNAP_TOL
): Point2DUnion[] {
  const cleanPolys: Point2DUnion[][] = [];
  for (const poly of polygons) {
    let norm = dedupeConsecutive(
      poly.map((p, idx) => ({ x: p.x, y: p.y, id: String(p.id || idx + 1), raw: p.raw })),
      1e-4
    );
    if (norm.length < 3) continue;
    if (signedArea2D(norm) < 0) {
      norm = [...norm].reverse();
    }
    cleanPolys.push(norm);
  }

  if (cleanPolys.length === 0) return [];
  if (cleanPolys.length === 1) {
    const cleaned = removeCollinear(cleanPolys[0], 0.01);
    return cleaned.map((p, i) => ({ ...p, id: `P${i + 1}` }));
  }

  // 1. Soldadura (snapping) de vértices cercanos entre parcelas
  const anchors: Point2DUnion[] = [];
  const snappedPolys: Point2DUnion[][] = cleanPolys.map((poly) =>
    poly.map((v) => {
      for (const a of anchors) {
        if (Math.hypot(v.x - a.x, v.y - a.y) <= snapTol) {
          return { x: a.x, y: a.y, id: v.id, raw: v.raw ?? a.raw };
        }
      }
      anchors.push(v);
      return { ...v };
    })
  );

  // 2. Proyectar vértices que tocan aristas de otro polígono (uniones en T) e intersecciones
  const subdividedPolys: Point2DUnion[][] = snappedPolys.map((polyA, idxA) => {
    const nextPoly: Point2DUnion[] = [];
    const nA = polyA.length;

    for (let i = 0; i < nA; i++) {
      const a = polyA[i];
      const b = polyA[(i + 1) % nA];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const splits: Array<{ t: number; pt: Point2DUnion }> = [];

      for (let idxB = 0; idxB < snappedPolys.length; idxB++) {
        if (idxB === idxA) continue;
        const polyB = snappedPolys[idxB];
        const nB = polyB.length;

        // Vértices de polyB sobre segmento a->b
        for (let k = 0; k < nB; k++) {
          const vb = polyB[k];
          const proj = distPtToSeg(vb.x, vb.y, a.x, a.y, b.x, b.y);
          if (proj.dist <= snapTol && proj.t > 1e-4 && proj.t < 1 - 1e-4) {
            // Ajustar exactamente a la coordenada proyectada o al vértice soldado
            splits.push({
              t: proj.t,
              pt: { x: vb.x, y: vb.y, id: vb.id, raw: vb.raw },
            });
          }
        }

        // Cruces propios entre segmentos
        for (let k = 0; k < nB; k++) {
          const c = polyB[k];
          const d = polyB[(k + 1) % nB];
          const hit = segmentIntersectionParams(a, b, c, d);
          if (hit) {
            splits.push({
              t: hit.t,
              pt: { x: hit.x, y: hit.y, id: 'INT' },
            });
          }
        }
      }

      nextPoly.push(a);
      splits.sort((s1, s2) => s1.t - s2.t);
      let lastT = 0;
      for (const sp of splits) {
        if (sp.t - lastT > 1e-5 && (1 - sp.t) > 1e-5 && segLen * (sp.t - lastT) > 1e-4) {
          nextPoly.push(sp.pt);
          lastT = sp.t;
        }
      }
    }

    return dedupeConsecutive(nextPoly, 1e-4);
  });

  // 3. Extraer todas las semi-aristas dirigidas y cancelar pares opuestos / interiores
  interface HalfEdge {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    aKey: string;
    bKey: string;
    aRaw?: TransformationResult;
    bRaw?: TransformationResult;
    polyIdx: number;
    used?: boolean;
  }

  const allEdges: HalfEdge[] = [];
  for (let pIdx = 0; pIdx < subdividedPolys.length; pIdx++) {
    const poly = subdividedPolys[pIdx];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-4) continue;
      const aKey = quantKey(a.x, a.y);
      const bKey = quantKey(b.x, b.y);
      if (aKey === bKey) continue;
      allEdges.push({
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        aKey,
        bKey,
        aRaw: a.raw,
        bRaw: b.raw,
        polyIdx: pIdx,
      });
    }
  }

  // Cancelación 1 a 1 de aristas opuestas compartidas (A->B vs B->A)
  const cancelled = new Array<boolean>(allEdges.length).fill(false);
  for (let i = 0; i < allEdges.length; i++) {
    if (cancelled[i]) continue;
    const ei = allEdges[i];
    for (let j = i + 1; j < allEdges.length; j++) {
      if (cancelled[j]) continue;
      const ej = allEdges[j];
      if (ei.polyIdx !== ej.polyIdx && ei.aKey === ej.bKey && ei.bKey === ej.aKey) {
        cancelled[i] = true;
        cancelled[j] = true;
        break;
      }
    }
  }

  // Descartar también cualquier arista cuyo punto medio o lado exterior caiga estrictamente dentro de otro polígono
  const outerEdges: HalfEdge[] = [];
  const seenDirected = new Set<string>();

  for (let i = 0; i < allEdges.length; i++) {
    if (cancelled[i]) continue;
    const e = allEdges[i];
    const dirSig = `${e.aKey}->${e.bKey}`;
    if (seenDirected.has(dirSig)) continue;

    const dx = e.bx - e.ax;
    const dy = e.by - e.ay;
    const len = Math.hypot(dx, dy);
    const mx = (e.ax + e.bx) * 0.5;
    const my = (e.ay + e.by) * 0.5;
    const eps = Math.min(Math.max(snapTol * 0.3, 1e-3), len * 0.15);
    // Para polígono CCW, el exterior inmediato está a la derecha (+dy, -dx)
    const outX = mx + (dy / len) * eps;
    const outY = my - (dx / len) * eps;

    let insideOther = false;
    for (let pIdx = 0; pIdx < subdividedPolys.length; pIdx++) {
      if (pIdx === e.polyIdx) continue;
      const other = subdividedPolys[pIdx];
      if (pointInPolygonStrict(mx, my, other, 1e-4) || pointInPolygonStrict(outX, outY, other, 1e-4)) {
        insideOther = true;
        break;
      }
    }

    if (!insideOther) {
      seenDirected.add(dirSig);
      outerEdges.push(e);
    }
  }

  if (outerEdges.length < 3) {
    // Fallback de seguridad: envolvente exterior de todos los puntos
    const allPts = cleanPolys.flat();
    const hull = removeCollinear(convexHullCCW(allPts), 0.01);
    return hull.map((p, i) => ({ ...p, id: `P${i + 1}` }));
  }

  // 4. Encadenamiento de ciclos exteriores (Outer Ring Walk)
  const outMap = new Map<string, HalfEdge[]>();
  for (const e of outerEdges) {
    const list = outMap.get(e.aKey) || [];
    list.push(e);
    outMap.set(e.aKey, list);
  }

  const rings: Point2DUnion[][] = [];
  for (;;) {
    // Empezar siempre por la arista no usada cuyo origen sea más extremo (min X, min Y)
    const unused = outerEdges.filter((e) => !e.used);
    if (unused.length === 0) break;

    unused.sort((e1, e2) => (e1.ax !== e2.ax ? e1.ax - e2.ax : e1.ay - e2.ay));
    let current = unused[0];
    const startKey = current.aKey;
    const ring: Point2DUnion[] = [];
    let guard = 0;

    while (current && !current.used && guard < outerEdges.length + 5) {
      guard++;
      current.used = true;
      ring.push({ x: current.ax, y: current.ay, id: String(ring.length + 1), raw: current.aRaw });

      if (current.bKey === startKey) {
        break;
      }

      const candidates = (outMap.get(current.bKey) || []).filter((e) => !e.used);
      if (candidates.length === 0) break;

      if (candidates.length === 1) {
        current = candidates[0];
      } else {
        // Elegir el giro más hacia el exterior (menor ángulo antihorario respecto a la dirección inversa)
        const prevAngle = Math.atan2(current.ay - current.by, current.ax - current.bx);
        candidates.sort((c1, c2) => {
          const a1 = (Math.atan2(c1.by - c1.ay, c1.bx - c1.ax) - prevAngle + 2 * Math.PI) % (2 * Math.PI);
          const a2 = (Math.atan2(c2.by - c2.ay, c2.bx - c2.ax) - prevAngle + 2 * Math.PI) % (2 * Math.PI);
          return a1 - a2;
        });
        current = candidates[0];
      }
    }

    const cleanRing = removeCollinear(ring, 0.01);
    if (cleanRing.length >= 3 && signedArea2D(cleanRing) > 0) {
      rings.push(cleanRing);
    }
  }

  if (rings.length === 0) {
    const hull = removeCollinear(convexHullCCW(cleanPolys.flat()), 0.01);
    return hull.map((p, i) => ({ ...p, id: `P${i + 1}` }));
  }

  // Si hay 1 solo ciclo exterior CCW (caso normal de parcelas colindantes), retornarlo directamente
  if (rings.length === 1) {
    return rings[0].map((p, i) => ({ ...p, id: `P${i + 1}` }));
  }

  // Si existen múltiples componentes desconectadas (parcelas que no se tocan), devolver el contorno envolvente exterior único sin puntos interiores
  const hull = removeCollinear(convexHullCCW(rings.flat()), 0.01);
  return hull.map((p, i) => ({ ...p, id: `P${i + 1}` }));
}

function approxLatLngFromNeighbors(
  pt: { x: number; y: number },
  sourcePts: Point2DUnion[]
): { lat?: number; lng?: number; huso?: number } {
  let best: Point2DUnion | null = null;
  let bestDist = Infinity;
  for (const s of sourcePts) {
    const d = Math.hypot(s.x - pt.x, s.y - pt.y);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  const refRaw: any = best?.raw;
  const lat = Number(refRaw?.result?.lat ?? refRaw?.input?.lat);
  const lng = Number(refRaw?.result?.lng ?? refRaw?.input?.lng);
  const huso = Number(refRaw?.result?.huso ?? refRaw?.input?.huso);
  return {
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    huso: Number.isFinite(huso) ? huso : undefined,
  };
}

/**
 * Fusiona 2 o más objetos Parcel en una única Parcel con solo los vértices externos.
 */
export function unifyParcelsToSingleParcel(parcels: Parcel[], customName?: string): Parcel {
  const validParcels = parcels.filter((p) => (p.puntos?.length ?? 0) >= 3);
  if (validParcels.length === 0) {
    throw new Error('Se requieren parcelas válidas con al menos 3 vértices para unificar.');
  }

  const extracted = validParcels.map((p) => extractParcelPoints2D(p)).filter((pts) => pts.length >= 3);
  const allSourcePts = extracted.flat();
  const exteriorPts = unifyPolygonsExterior(extracted, DEFAULT_SNAP_TOL);

  const area = Math.abs(signedArea2D(exteriorPts));
  const perim = polygonPerimeter2D(exteriorPts);
  const ha = area / 10000;

  const puntos: TransformationResult[] = exteriorPts.map((pt, idx) => {
    const id = `P${idx + 1}`;
    const baseRaw = pt.raw;
    if (baseRaw && Math.hypot(
      Number(baseRaw.result?.este ?? baseRaw.input?.este ?? pt.x) - pt.x,
      Number(baseRaw.result?.norte ?? baseRaw.input?.norte ?? pt.y) - pt.y
    ) <= 0.05) {
      return {
        ...baseRaw,
        id,
        ok: true,
        input: {
          ...(baseRaw.input || { id }),
          id,
          este: pt.x,
          norte: pt.y,
        },
        result: {
          ...(baseRaw.result || {}),
          este: pt.x,
          norte: pt.y,
        },
      };
    }

    const approx = approxLatLngFromNeighbors(pt, allSourcePts);
    return {
      id,
      ok: true,
      direction: validParcels[0]?.puntos?.[0]?.direction || 'canoa_regven',
      input: {
        id,
        este: pt.x,
        norte: pt.y,
        lat: approx.lat,
        lng: approx.lng,
        huso: approx.huso,
      },
      result: {
        este: pt.x,
        norte: pt.y,
        lat: approx.lat,
        lng: approx.lng,
        huso: approx.huso,
      },
    };
  });

  const pickMeta = (key: keyof Parcel): string | undefined => {
    for (const p of validParcels) {
      const val = p[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return undefined;
  };

  const first = validParcels[0];
  const defaultName =
    customName?.trim() ||
    `UNIFICADA_${validParcels.map((p) => p.nombre).slice(0, 2).join('_')}`.slice(0, 40);

  return {
    id: `UNI-${Date.now().toString(36)}`,
    nombre: defaultName,
    fecha: new Date().toLocaleDateString('es-VE'),
    area,
    perim,
    ha,
    actualizado: new Date().toISOString(),
    puntos,
    geometryType: 'cerrada',
    method: first.method,
    rigidCorrection: first.rigidCorrection,
    adicoraCorrection: first.adicoraCorrection,
    hatchColor: first.hatchColor,
    hatchOpacity: first.hatchOpacity,
    estado: pickMeta('estado'),
    municipio: pickMeta('municipio'),
    parroquia: pickMeta('parroquia'),
    propietario: pickMeta('propietario'),
    rif: pickMeta('rif'),
    domicilio: pickMeta('domicilio'),
    ubicacionSector: pickMeta('ubicacionSector'),
    profesional: pickMeta('profesional'),
    civ: pickMeta('civ'),
    zona: pickMeta('zona'),
    seccion: pickMeta('seccion'),
    cedulaCat: pickMeta('cedulaCat'),
    observaciones:
      pickMeta('observaciones') ||
      `PARCELA UNIFICADA (${validParcels.map((p) => p.nombre).join(' + ')}). PERIMETRO EXTERIOR CON ${puntos.length} VERTICES.`,
  };
}
