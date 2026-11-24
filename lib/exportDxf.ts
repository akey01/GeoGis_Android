import Drawing from 'dxf-writer';
import JSZip from 'jszip';
import toast from 'react-hot-toast';
import { Parcel } from './store';
import { DXF_SCALE_FACTOR, DXF_OFFSET_X, DXF_OFFSET_Y } from '@/lib/servicesConfig';
import { unifyParcelsToSingleParcel } from './polygon-union';
import type { ParcelContourData } from '@/src/components/map/contours/contourEngine';
import { exportParcelContoursDXF } from '@/src/components/map/contours/contourEngine';

type Point2D = {
  x: number;
  y: number;
  id: string;
};

function cleanText(value: unknown, fallback = '') {
  return String(value ?? fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^a-zA-Z0-9.,:/()#°'" -]/g, '')
    .trim();
}

function calculateGeometry(points: Point2D[]) {
  let area = 0;
  let perim = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += p1.x * p2.y - p2.x * p1.y;
    perim += Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }
  return { area: area / 2, perim, signedArea: area / 2 };
}

function drawCenteredText(d: Drawing, x: number, y: number, height: number, text: string, rotation = 0) {
  d.drawText(x, y, height, rotation, text, 'center');
}

async function downloadViaBlob(url: string, filename: string): Promise<boolean> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      console.error(`[DXF Download] Error HTTP ${res.status} al descargar: ${url}`);
      return false;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    return true;
  } catch (err) {
    console.error(`[DXF Download] Fallo descargando ${filename}:`, err);
    return false;
  }
}

export interface DxfContourOptions {
  includeContours?: boolean;
  showDemGrid?: boolean;
  showIntermediateLabels?: boolean;
}

/**
 * Serializa datos de curvas de nivel, malla IGVSB y estadísticas altimétricas en JSON compacto
 * para renderizarlas dentro de la lámina oficial A3 de render.py.
 */
export function buildContoursPayload(
  contourData: ParcelContourData,
  options?: { showDemGrid?: boolean; showIntermediateLabels?: boolean }
) {
  const showDemGrid = options?.showDemGrid ?? true;
  const showIntermediateLabels = options?.showIntermediateLabels ?? true;
  const nodes = contourData.interiorGridNodes ?? [];
  const stride = nodes.length > 1200 ? 2 : 1;

  return {
    interval: contourData.interval,
    masterInterval: contourData.masterInterval,
    gridSpacingMeters: contourData.gridSpacingMeters ?? contourData.gridSpacingE ?? 10,
    minZ: contourData.minZ,
    maxZ: contourData.maxZ,
    meanZ: contourData.meanZ,
    deltaH: contourData.deltaH,
    meanSlopePct: contourData.meanSlopePct,
    reliefClass: contourData.reliefClass,
    demSource: contourData.demSource,
    uncertaintyWarning: contourData.uncertaintyWarning,
    minPointUTM: contourData.minPointUTM,
    maxPointUTM: contourData.maxPointUTM,
    showDemGrid,
    showIntermediateLabels,
    verticesZ: (contourData.vertices ?? []).map((v) => ({
      id: v.id,
      z: Number((v.z ?? 0).toFixed(2)),
    })),
    contours: (contourData.contours ?? []).map((c) => ({
      elevation: c.elevation,
      isMaster: c.isMaster,
      coordsUTM: c.coordsUTM.map(([e, n]) => [Number(e.toFixed(2)), Number(n.toFixed(2))]),
      labels: (c.labels ?? []).map((l) => ({
        pointUTM: [Number(l.pointUTM[0].toFixed(2)), Number(l.pointUTM[1].toFixed(2))],
        angleDeg: Number(l.angleDeg.toFixed(1)),
        formattedText: l.formattedText,
      })),
    })),
    clippedGridLinesUTM: showDemGrid
      ? (contourData.clippedGridLinesUTM ?? []).map((gl) => ({
        axis: gl.axis,
        coord: gl.coord,
        coordsUTM: gl.coordsUTM.map(([e, n]) => [Number(e.toFixed(2)), Number(n.toFixed(2))]),
      }))
      : [],
    interiorGridNodes: showDemGrid
      ? nodes
        .filter((gn) => stride === 1 || (gn.col % stride === 0 && gn.row % stride === 0))
        .map((gn) => ({
          este: Number(gn.este.toFixed(2)),
          norte: Number(gn.norte.toFixed(2)),
          z: Number(gn.z.toFixed(2)),
          col: gn.col,
          row: gn.row,
        }))
      : [],
  };
}

export async function exportParcelToDXF(
  parcel: Parcel,
  contourData?: ParcelContourData | null,
  contourOptions?: DxfContourOptions
): Promise<{ success: boolean; url?: string }> {
  if (!parcel.puntos || (parcel.geometryType === 'cerrada' && parcel.puntos.length < 3) || (parcel.geometryType !== 'cerrada' && parcel.puntos.length < 2)) {
    const msg = 'La parcela no tiene suficientes puntos para la geometría seleccionada.';
    console.error('[DXF]', msg);
    return { success: false };
  }

  const rawParcelName = parcel.nombre ? String(parcel.nombre).trim() : 'Parcela';
  const sanitized = cleanText(rawParcelName, 'Parcela') || rawParcelName;
  const projectName = encodeURIComponent(sanitized);
  const includeContours = Boolean(contourData && contourData.contours?.length && contourOptions?.includeContours !== false);

  try {
    const res = await fetch('/api/cad-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        points: parcel.puntos,
        dxfScaleFactor: DXF_SCALE_FACTOR,
        dxfOffsetX: DXF_OFFSET_X,
        dxfOffsetY: DXF_OFFSET_Y,
        geometryType: parcel.geometryType,
        contoursData: includeContours && contourData ? buildContoursPayload(contourData, contourOptions) : undefined,
        metadata: {
          projectName,
          areaDoc: parcel.area,
          fecha: parcel.fecha,
          estado: (parcel as any).estado || '',
          municipio: (parcel as any).municipio || '',
          parroquia: (parcel as any).parroquia || '',
          propietario: (parcel as any).propietario || '',
          rif: (parcel as any).rif || '',
          domicilio: (parcel as any).domicilio || '',
          profesional: (parcel as any).profesional || '',
          civ: (parcel as any).civ || '',
          zona: (parcel as any).zona || '',
          seccion: (parcel as any).seccion || '',
          cedulaCat: (parcel as any).cedulaCat || '',
          observaciones: (parcel as any).observaciones || ''
        }
      }),
      signal: AbortSignal.timeout(180000)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      if (res.status === 401) {
        toast.error('Sesión requerida o expirada. Por favor inicia sesión en la app.');
      } else if (res.status === 429) {
        toast.error('Límite de solicitudes excedido. Espera un momento.');
      } else {
        const errorMsg = errorData.error || errorData.message || errorData.details || `Error del servidor (${res.status})`;
        toast.error(`Error al generar DXF: ${errorMsg}`);
      }
      return { success: false };
    }

    const data = await res.json();
    const downloadUrl = data.dxfUrl || data.download_url || data.file || data.fileUrl;
    if (data.status !== 'success' || !downloadUrl) {
      toast.error(data.message || data.error || 'Respuesta inválida del motor CAD');
      return { success: false };
    }

    const parcelName = decodeURIComponent(projectName).replace(/\s+/g, '_');
    const finalFileName = `${parcelName}${includeContours ? '_TOPO_OFICIAL' : ''}.dxf`;

    // 1. Descargar el archivo DXF directo vía Blob seguro en memoria
    const dxfOk = await downloadViaBlob(downloadUrl, finalFileName);
    if (!dxfOk) {
      toast.error('No se pudo transferir el archivo DXF al navegador');
      return { success: false };
    }

    toast.success(
      includeContours
        ? `Plano Oficial Topográfico ${finalFileName} descargado exitosamente`
        : `Plano ${finalFileName} descargado exitosamente`
    );

    return { success: true, url: downloadUrl };
  } catch (err: any) {
    console.error('[DXF Error]', err);
    if (includeContours && contourData) {
      toast('Servidor CAD sin respuesta: exportando respaldo DXF local de curvas.', { icon: '⚠️' });
      exportParcelContoursDXF(contourData);
      return { success: true };
    }
    toast.error(`Error de conexión local: ${err.message || 'Verifica que el servidor esté activo'}`);
    return { success: false };
  }
}



export async function exportResultsToDXF(
  results: any[],
  projectName = 'PROYECTO_GEO',
  geometryType: 'cerrada' | 'abierta' | 'puntos' = 'cerrada',
): Promise<{ success: boolean; url?: string }> {
  const minPoints = geometryType === 'cerrada' ? 3 : geometryType === 'abierta' ? 2 : 1;
  if (!results || results.length < minPoints) {
    console.error(`[DXF] Se requieren al menos ${minPoints} puntos para geometría ${geometryType}.`);
    return { success: false };
  }

  const validResults = results.filter(r => r.ok && r.result?.este != null && r.result?.norte != null);
  if (validResults.length < minPoints) {
    console.error(`[DXF] Solo ${validResults.length} puntos válidos de ${results.length}.`);
    return { success: false };
  }

  const pts = validResults
    .map((result, index) => ({
      x: Number(result.result?.este),
      y: Number(result.result?.norte),
      id: cleanText(result.id, String(index + 1)) || String(index + 1),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  const geometry = pts.length >= 3 ? calculateGeometry(pts) : { area: 0, perim: 0, signedArea: 0 };

  return exportParcelToDXF({
    id: 'current-results',
    nombre: projectName,
    fecha: new Date().toLocaleDateString('es-VE'),
    area: geometry.area,
    perim: geometry.perim,
    ha: geometry.area / 10000,
    puntos: validResults.map((result, index) => ({
      ...result,
      id: cleanText(result.id, String(index + 1)) || String(index + 1),
    })),
    geometryType,
  });
}

/**
 * Export multiple parcels to a single DXF with individual viewport cards and data tables.
 * Each polygon is drawn in its own "ubicacion" viewport section with a separate metadata table.
 */
export async function exportMultiParcelDXF(
  projectName: string,
  parcels: Parcel[]
) {
  if (!parcels || parcels.length === 0) {
    alert('No hay parcelas seleccionadas para exportar.');
    return;
  }

  const total = parcels.length;
  const doneMsgs: string[] = [];

  for (let i = 0; i < total; i++) {
    const parcel = parcels[i];
    if (!parcel.puntos || parcel.puntos.length < (parcel.geometryType === 'cerrada' ? 3 : 2)) {
      doneMsgs.push(`${parcel.nombre || 'Parcela'}: puntos insuficientes`);
      continue;
    }

    const rawName = parcel.nombre ? String(parcel.nombre).trim() : 'Parcela';
    const sanitized = cleanText(rawName, 'Parcela') || rawName;
    const projectEncoded = encodeURIComponent(sanitized);

    try {
      const res = await fetch('/api/cad-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          points: parcel.puntos,
          dxfScaleFactor: DXF_SCALE_FACTOR,
          dxfOffsetX: DXF_OFFSET_X,
          dxfOffsetY: DXF_OFFSET_Y,
          geometryType: parcel.geometryType,
          metadata: {
            projectName: projectEncoded,
            areaDoc: parcel.area,
            fecha: parcel.fecha,
            estado: (parcel as any).estado || '',
            municipio: (parcel as any).municipio || '',
            parroquia: (parcel as any).parroquia || '',
            propietario: (parcel as any).propietario || '',
            rif: (parcel as any).rif || '',
            domicilio: (parcel as any).domicilio || '',
            profesional: (parcel as any).profesional || '',
            civ: (parcel as any).civ || '',
            zona: (parcel as any).zona || '',
            seccion: (parcel as any).seccion || '',
            cedulaCat: (parcel as any).cedulaCat || '',
            observaciones: (parcel as any).observaciones || '',
          },
        }),
        signal: AbortSignal.timeout(180000),
      });

      if (!res.ok) {
        doneMsgs.push(`${sanitized}: error ${res.status}`);
        continue;
      }

      const data = await res.json();
      const downloadUrl = data.dxfUrl || data.download_url || data.file || data.fileUrl;
      if (data.status !== 'success' || !downloadUrl) {
        doneMsgs.push(`${sanitized}: respuesta inválida`);
        continue;
      }

      // 1. Descargar el archivo DXF directo vía Blob seguro
      await downloadViaBlob(downloadUrl, `${(projectName || 'PROYECTO_MULTIPLE').replace(/\s+/g, '_')}.dxf`);

      doneMsgs.push(`${sanitized}: OK`);
    } catch (err: any) {
      doneMsgs.push(`${sanitized}: ${err.message || 'error'}`);
    }
  }

  const okCount = doneMsgs.filter(m => m.endsWith(': OK')).length;
  const failCount = doneMsgs.filter(m => !m.endsWith(': OK')).length;
  if (failCount > 0 && okCount > 0) {
    alert(`${okCount} de ${total} planos generados. ${failCount} fallaron.`);
  } else if (failCount > 0) {
    alert(`Error al generar los ${total} planos.`);
  }
}

export async function exportProjectPolygonsToDXF(
  projectName = 'PROYECTO_POLIGONOS',
  parcels: Parcel[]
) {
  return exportIntegratedMultiParcelDXF(projectName, parcels);
}

export interface Dxf2Template {
  id: string;
  name: string;
  description: string;
  metadata_fields: string[];
  preview: string | null;
}

export interface Dxf2Result {
  success: boolean;
  url?: string;
  scales?: { vp1: number; vp2: number };
}

export async function fetchDxf2Templates(): Promise<Dxf2Template[]> {
  try {
    const res = await fetch('/api/dxf2');
    if (!res.ok) return [];
    const data = await res.json();
    return data.templates || [];
  } catch {
    return [];
  }
}

export async function exportParcelToDXF2(
  parcel: Parcel,
  templateId: string,
): Promise<Dxf2Result> {
  if (!parcel.puntos || parcel.puntos.length < 3) {
    return { success: false };
  }

  try {
    const res = await fetch('/api/dxf2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        templateId,
        points: parcel.puntos,
        geometryType: parcel.geometryType,
        metadata: {
          includeSatellite: true,
          projectName: parcel.nombre,
          estado: (parcel as any).estado || '',
          municipio: (parcel as any).municipio || '',
          parroquia: (parcel as any).parroquia || '',
          propietario: (parcel as any).propietario || '',
          rif: (parcel as any).rif || '',
          profesional: (parcel as any).profesional || '',
          civ: (parcel as any).civ || '',
          zona: (parcel as any).zona || '',
          seccion: (parcel as any).seccion || '',
        },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) return { success: false };

    const data = await res.json();
    const downloadUrl = data.file || data.fileUrl;
    if (data.status !== 'success' || !downloadUrl) {
      return { success: false };
    }

    const parcelName = (parcel.nombre || 'PARCELA').replace(/\s+/g, '_');

    // 1. Descargar DXF como blob
    try {
      const fileRes = await fetch(downloadUrl, { credentials: 'include' });
      if (fileRes.ok) {
        const blob = await fileRes.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${parcelName}_DXF2.dxf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
    } catch (dxfErr) {
      console.error('Error descargando DXF2:', dxfErr);
    }

    // 2. Descargar imagen PNG satelital con el nombre exacto esperado por DXF
    if (data.satImage) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const satRes = await fetch(data.satImage, { credentials: 'include' });
        if (satRes.ok) {
          const satBlob = await satRes.blob();
          const satFilename = data.satImage.includes('file=')
            ? decodeURIComponent(data.satImage.split('file=')[1])
            : `${parcelName}_satelital.png`;
          const a2 = document.createElement('a');
          a2.href = URL.createObjectURL(satBlob);
          a2.download = satFilename;
          document.body.appendChild(a2);
          a2.click();
          document.body.removeChild(a2);
          URL.revokeObjectURL(a2.href);
        }
      } catch (satErr) {
        console.warn('Error descargando PNG satelital DXF2:', satErr);
      }
    }

    return {
      success: true,
      url: downloadUrl,
      scales: data.scales,
    };
  } catch {
    return { success: false };
  }
}

// ── DXF3 / Hybrid ──────────────────────────────────────────────────────────

export interface DxfTemplateConfig {
  paperWidthMm: number;
  paperHeightMm: number;
  padding: number;
  marginRatio: number;
  mapRatio: number;
  middleRatio: number;
  sideRatio: number;
  showBalance: boolean;
  showPuntoApoyo: boolean;
  showRumbos: boolean;
  showCoordenadas: boolean;
  showCroquis: boolean;
  showTitleBlock: boolean;
  showProjectInfo: boolean;
  gridEnabled: boolean;
}

export interface Dxf3Result {
  success: boolean;
  url?: string;
}

export async function exportParcelToDXF3(
  parcel: Parcel,
  templateId: string,
  config: DxfTemplateConfig,
): Promise<Dxf3Result> {
  if (!parcel.puntos || parcel.puntos.length < 3) {
    return { success: false };
  }

  try {
    const res = await fetch('/api/dxf3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        templateId,
        config,
        points: parcel.puntos,
        geometryType: parcel.geometryType,
        metadata: {
          projectName: parcel.nombre,
          estado: (parcel as any).estado || '',
          municipio: (parcel as any).municipio || '',
          parroquia: (parcel as any).parroquia || '',
          propietario: (parcel as any).propietario || '',
          rif: (parcel as any).rif || '',
          profesional: (parcel as any).profesional || '',
          civ: (parcel as any).civ || '',
          zona: (parcel as any).zona || '',
          seccion: (parcel as any).seccion || '',
        },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) return { success: false };

    const data = await res.json();
    const downloadUrl = data.file || data.fileUrl;
    if (data.status !== 'success' || !downloadUrl) {
      return { success: false };
    }

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${(parcel.nombre || 'PARCELA').replace(/\s+/g, '_')}_DXF3.dxf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    return { success: true, url: downloadUrl };
  } catch {
    return { success: false };
  }
}

export async function exportParcelToDXFHybrid(
  parcel: Parcel,
  templateId: string,
  config: DxfTemplateConfig,
): Promise<Dxf3Result> {
  if (!parcel.puntos || parcel.puntos.length < 3) {
    return { success: false };
  }

  try {
    const res = await fetch('/api/dxf3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        templateId,
        config,
        hybrid: true,
        points: parcel.puntos,
        geometryType: parcel.geometryType,
        metadata: {
          projectName: parcel.nombre,
          estado: (parcel as any).estado || '',
          municipio: (parcel as any).municipio || '',
          parroquia: (parcel as any).parroquia || '',
          propietario: (parcel as any).propietario || '',
          rif: (parcel as any).rif || '',
          profesional: (parcel as any).profesional || '',
          civ: (parcel as any).civ || '',
          zona: (parcel as any).zona || '',
          seccion: (parcel as any).seccion || '',
        },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) return { success: false };

    const data = await res.json();
    const downloadUrl = data.file || data.fileUrl;
    if (data.status !== 'success' || !downloadUrl) {
      return { success: false };
    }

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${(parcel.nombre || 'PARCELA').replace(/\s+/g, '_')}_DXF_HYBRID.dxf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    return { success: true, url: downloadUrl };
  } catch {
    return { success: false };
  }
}

/**
 * Exporta un plano DXF único e integrado que contiene todas las parcelas seleccionadas
 * en el espacio de modelo y cuadros de coordenadas/rumbos separados por parcela en la plantilla layout CAD.
 */
export async function exportIntegratedMultiParcelDXF(
  projectName: string,
  parcels: Parcel[]
) {
  if (!parcels || parcels.length === 0) {
    alert('No hay parcelas seleccionadas para exportar.');
    return;
  }

  const validParcels = parcels.filter(
    (p) => p.puntos && p.puntos.length >= (p.geometryType === 'cerrada' ? 3 : 2)
  );

  if (validParcels.length === 0) {
    alert('Ninguna de las parcelas seleccionadas tiene vértices suficientes para exportar.');
    return;
  }

  const sanitizedProjectName = cleanText(projectName, 'PROYECTO_INTEGRADO') || 'PROYECTO_INTEGRADO';
  const projectEncoded = encodeURIComponent(sanitizedProjectName);
  const firstParcel = validParcels[0] as any;

  const payloadParcels = validParcels.map((p, pIdx) => ({
    nombre: cleanText(p.nombre, `PARCELA_${pIdx + 1}`),
    geometryType: p.geometryType || 'cerrada',
    area: p.area,
    points: (p.puntos || []).map((pt: any, idx: number) => ({
      x: Number(pt.x ?? pt.result?.este ?? pt.result?.x ?? pt.input?.x ?? 0),
      y: Number(pt.y ?? pt.result?.norte ?? pt.result?.y ?? pt.input?.y ?? 0),
      id: cleanText(pt.id, String(idx + 1)) || String(idx + 1),
      ...pt,
    })),
  }));

  try {
    const allPoints = payloadParcels.flatMap((p) => p.points);
    // Calcular límites del rectángulo de ubicación
    const xs = allPoints.map(pt => pt.x);
    const ys = allPoints.map(pt => pt.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const layoutBounds = { minX, minY, maxX, maxY };

    const res = await fetch('/api/cad-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        points: allPoints,
        parcels: payloadParcels,
        dxfScaleFactor: DXF_SCALE_FACTOR,
        dxfOffsetX: DXF_OFFSET_X,
        dxfOffsetY: DXF_OFFSET_Y,
        geometryType: firstParcel.geometryType || 'cerrada',
        metadata: {
          includeLocationLayout: true,
          layoutBounds: layoutBounds,
          projectName: projectEncoded,
          areaDoc: firstParcel.area,
          estado: firstParcel.estado || '',
          municipio: firstParcel.municipio || '',
          parroquia: firstParcel.parroquia || '',
          propietario: firstParcel.propietario || '',
          rif: firstParcel.rif || '',
          domicilio: firstParcel.domicilio || '',
          profesional: firstParcel.profesional || '',
          civ: firstParcel.civ || '',
          zona: firstParcel.zona || '',
          seccion: firstParcel.seccion || '',
          cedulaCat: firstParcel.cedulaCat || '',
          observaciones: firstParcel.observaciones || `PLANO INTEGRADO CATASTRAL MULTI-PARCELA (${validParcels.length} PARCELAS SELECCIONADAS).`,
        },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      alert(`Error al generar el plano DXF integrado (Status: ${res.status}).`);
      return;
    }

    const data = await res.json();
    const downloadUrl = data.dxfUrl || data.download_url || data.file || data.fileUrl;
    if (data.status !== 'success' || !downloadUrl) {
      alert('Error en la respuesta del servidor al generar el DXF integrado.');
      return;
    }

    // 1. Descargar DXF directo vía Blob seguro
    await downloadViaBlob(downloadUrl, `${(projectName || 'PROYECTO_INTEGRADO').replace(/\s+/g, '_')}.dxf`);
  } catch (err) {
    console.error('Error al exportar DXF integrado:', err);
    alert('Ocurrió un error inesperado al procesar la exportación del DXF integrado.');
  }
}

/**
 * Unifica múltiples parcelas seleccionadas conservando únicamente el perímetro exterior
 * (sin linderos internos compartidos) y exporta un plano DXF oficial del polígono unificado.
 */
export async function exportUnifiedParcelDXF(
  projectName: string,
  parcels: Parcel[]
): Promise<{ success: boolean; unifiedParcel?: Parcel }> {
  if (!parcels || parcels.length < 2) {
    toast.error('Selecciona al menos 2 parcelas para unificar y exportar.');
    return { success: false };
  }

  const validParcels = parcels.filter(
    (p) => p.puntos && p.puntos.length >= 3
  );
  if (validParcels.length < 2) {
    toast.error('Se requieren al menos 2 polígonos cerrados con 3 o más vértices.');
    return { success: false };
  }

  const baseName = cleanText(projectName, 'PARCELA_UNIFICADA') || 'PARCELA_UNIFICADA';
  const unifiedParcel = unifyParcelsToSingleParcel(validParcels, `${baseName}_UNIFICADA`);

  const unifiedPointsPayload = (unifiedParcel.puntos || []).map((pt: any, idx: number) => ({
    x: Number(pt.result?.este ?? pt.input?.este ?? 0),
    y: Number(pt.result?.norte ?? pt.input?.norte ?? 0),
    id: cleanText(pt.id, String(idx + 1)) || String(idx + 1),
    ...pt,
  }));

  const payloadParcels = validParcels.map((p, pIdx) => ({
    nombre: cleanText(p.nombre, `PARCELA_${pIdx + 1}`),
    geometryType: p.geometryType || 'cerrada',
    area: p.area,
    points: (p.puntos || []).map((pt: any, idx: number) => ({
      x: Number(pt.x ?? pt.result?.este ?? pt.result?.x ?? pt.input?.x ?? 0),
      y: Number(pt.y ?? pt.result?.norte ?? pt.result?.y ?? pt.input?.y ?? 0),
      id: cleanText(pt.id, String(idx + 1)) || String(idx + 1),
      ...pt,
    })),
  }));

  const totalAreaDoc = validParcels.reduce((acc, p) => acc + Math.abs(p.area ?? 0), 0);
  const firstParcel = unifiedParcel as any;
  const projectEncoded = encodeURIComponent(cleanText(unifiedParcel.nombre, 'PARCELA_UNIFICADA') || 'PARCELA_UNIFICADA');

  try {
    const res = await fetch('/api/cad-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        points: unifiedPointsPayload,
        parcels: payloadParcels,
        unifyParcels: true,
        dxfScaleFactor: DXF_SCALE_FACTOR,
        dxfOffsetX: DXF_OFFSET_X,
        dxfOffsetY: DXF_OFFSET_Y,
        geometryType: 'cerrada',
        metadata: {
          unifyParcels: true,
          projectName: projectEncoded,
          areaDoc: totalAreaDoc > 0 ? totalAreaDoc : unifiedParcel.area,
          fecha: unifiedParcel.fecha,
          estado: firstParcel.estado || '',
          municipio: firstParcel.municipio || '',
          parroquia: firstParcel.parroquia || '',
          propietario: firstParcel.propietario || '',
          rif: firstParcel.rif || '',
          domicilio: firstParcel.domicilio || '',
          profesional: firstParcel.profesional || '',
          civ: firstParcel.civ || '',
          zona: firstParcel.zona || '',
          seccion: firstParcel.seccion || '',
          cedulaCat: firstParcel.cedulaCat || '',
          observaciones: firstParcel.observaciones || '',
        },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      toast.error(errData.error || `Error al generar DXF unificado (${res.status})`);
      return { success: false };
    }

    const data = await res.json();
    const downloadUrl = data.dxfUrl || data.download_url || data.file || data.fileUrl;
    if (data.status !== 'success' || !downloadUrl) {
      toast.error(data.message || data.error || 'Respuesta inválida del motor CAD');
      return { success: false };
    }

    const fileStem = baseName.replace(/\s+/g, '_');
    const ok = await downloadViaBlob(downloadUrl, `${fileStem}_UNIFICADO.dxf`);
    if (!ok) {
      toast.error('No se pudo descargar el archivo DXF unificado');
      return { success: false };
    }

    toast.success(`Plano unificado ${fileStem}_UNIFICADO.dxf (${unifiedPointsPayload.length} vértices externos) descargado`);
    return { success: true, unifiedParcel };
  } catch (err: any) {
    console.error('[DXF Unificado Error]', err);
    toast.error(`Error al exportar DXF unificado: ${err?.message || 'error inesperado'}`);
    return { success: false };
  }
}

