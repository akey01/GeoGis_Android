import { Parcel } from './store';
import { FileService } from './file-service';
import ExcelJS from 'exceljs';

export interface ProcessedParcelSummary {
  id: string;
  propietario: string;
  ubicacion: string;
  area: number;
  perimetro: number;
  observaciones: string;
}

/**
 * Obtiene los puntos UTM (Este, Norte) de una parcela para calcular geometría si es necesario
 */
export function extractParcelUtmPoints(parcel: Parcel): { e: number; n: number }[] {
  if (!parcel.puntos || parcel.puntos.length === 0) return [];
  return parcel.puntos
    .map((p: any) => {
      const e = p.result?.este ?? p.este ?? p.e ?? p.x ?? p.result?.x ?? p.input?.este ?? p.input?.x;
      const n = p.result?.norte ?? p.norte ?? p.n ?? p.y ?? p.result?.y ?? p.input?.norte ?? p.input?.y;
      if (e !== undefined && n !== undefined && Number.isFinite(Number(e)) && Number.isFinite(Number(n))) {
        return { e: Number(e), n: Number(n) };
      }
      return null;
    })
    .filter(Boolean) as { e: number; n: number }[];
}

/**
 * Normaliza y procesa los datos de una parcela para la tabla de control
 */
export function processParcelForSummary(parcel: Parcel, index?: number): ProcessedParcelSummary {
  let area = parcel.area != null ? Math.abs(parcel.area) : 0;
  let perimetro = parcel.perim != null ? Math.abs(parcel.perim) : 0;

  // Si no tiene área o perímetro precargados, calcularlos al vuelo con Shoelace UTM
  if ((!area || !perimetro) && parcel.puntos && parcel.puntos.length >= 3) {
    const pts = extractParcelUtmPoints(parcel);
    if (pts.length >= 3) {
      const calc = FileService.calculateGeometry(pts);
      if (!area) area = calc.area;
      if (!perimetro) perimetro = calc.perim;
    }
  }

  // Nombre o ID de la parcela
  const id = parcel.nombre?.trim() || parcel.id || `PARC-${String((index ?? 0) + 1).padStart(2, '0')}`;

  // Titular o Propietario
  const propietario = parcel.propietario?.trim() || '';

  // Ubicación / Sector
  let ubicacion = parcel.ubicacionSector?.trim();
  if (!ubicacion && parcel.domicilio && parcel.domicilio !== 'S/D') {
    ubicacion = parcel.domicilio.trim();
  }
  if (!ubicacion) {
    const partes: string[] = [];
    if (parcel.zona) partes.push(`Zona ${parcel.zona}`);
    if (parcel.seccion) partes.push(`Sec. ${parcel.seccion}`);
    if (partes.length === 0) {
      if (parcel.parroquia && parcel.parroquia !== 'S/D') partes.push(parcel.parroquia);
      if (parcel.municipio && parcel.municipio !== 'S/D') partes.push(parcel.municipio);
    }
    ubicacion = partes.length > 0 ? partes.join(' - ') : '';
  }

  // Observaciones / Acciones pendientes
  const observaciones = parcel.observaciones?.trim() || '';

  return {
    id,
    propietario,
    ubicacion,
    area,
    perimetro,
    observaciones,
  };
}

/**
 * Formatea número al estilo "2,450.00"
 */
export function formatDecimals(val: number): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Genera la tabla de resumen en formato ASCII exacto al estándar solicitado
 */
export function generateParcelSummaryText(parcels: Parcel[], projectTitle?: string): string {
  const processed = parcels.map((p, idx) => processParcelForSummary(p, idx));

  const LINE_WIDTH = 139;
  const lineEqual = '='.repeat(LINE_WIDTH);
  const lineDash = '-'.repeat(LINE_WIDTH);

  // Anchos fijos de columnas para alinear exactamente con el formato requerido
  // ID PARCELA (10) | PROPIETARIO / TITULAR (30) | UBICACIÓN / SECTOR (32) | ÁREA (m²) (12) | PERÍMETRO (m) (14) | OBSERVACIONES
  const colIdWidth = 10;
  const colPropWidth = 30;
  const colUbicWidth = 32;
  const colAreaWidth = 12;
  const colPerimWidth = 14;

  const title = "TABLA RESUMEN DE CONTROL DE PARCELAS";
  const titlePadding = Math.max(0, Math.floor((LINE_WIDTH - title.length) / 2));
  const centeredTitle = ' '.repeat(titlePadding) + title;

  const header = `${"ID PARCELA".padEnd(colIdWidth)}| ${"PROPIETARIO / TITULAR".padEnd(colPropWidth)}| ${"UBICACIÓN / SECTOR".padEnd(colUbicWidth)}| ${"ÁREA (m²)".padEnd(colAreaWidth)}| ${"PERÍMETRO (m)".padEnd(colPerimWidth)}| OBSERVACIONES / ACCIONES PENDIENTES`;

  let totalArea = 0;
  let totalPerim = 0;

  const rows = processed.map((item) => {
    totalArea += item.area;
    totalPerim += item.perimetro;

    const idStr = item.id.padEnd(colIdWidth);
    const propStr = (item.propietario.length > colPropWidth ? item.propietario.slice(0, colPropWidth - 3) + '...' : item.propietario).padEnd(colPropWidth);
    const ubicStr = (item.ubicacion.length > colUbicWidth ? item.ubicacion.slice(0, colUbicWidth - 3) + '...' : item.ubicacion).padEnd(colUbicWidth);
    const areaStr = formatDecimals(item.area).padEnd(colAreaWidth);
    const perimStr = formatDecimals(item.perimetro).padEnd(colPerimWidth);
    const obsStr = item.observaciones;

    return `${idStr}| ${propStr}| ${ubicStr}| ${areaStr}| ${perimStr}| ${obsStr}`;
  });

  const totalHa = totalArea / 10000;
  const summaryLine = `TOTAL PARCELAS: ${processed.length} | ÁREA TOTAL: ${formatDecimals(totalArea)} m² (${totalHa.toFixed(4)} ha) | PERÍMETRO TOTAL: ${formatDecimals(totalPerim)} m`;

  return [
    lineEqual,
    centeredTitle,
    projectTitle ? ` PROYECTO: ${projectTitle.toUpperCase()}` : '',
    lineEqual,
    header,
    lineDash,
    ...rows,
    lineDash,
    summaryLine,
    lineEqual,
  ].filter(Boolean).join('\n');
}

/**
 * Genera contenido CSV con los datos de las parcelas
 */
export function generateParcelSummaryCSV(parcels: Parcel[]): string {
  const processed = parcels.map((p, idx) => processParcelForSummary(p, idx));

  const escapeCSV = (str: string) => {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = ['ID PARCELA', 'PROPIETARIO / TITULAR', 'UBICACIÓN / SECTOR', 'ÁREA (m²)', 'PERÍMETRO (m)', 'OBSERVACIONES / ACCIONES PENDIENTES'];
  const rows = processed.map((p) => [
    escapeCSV(p.id),
    escapeCSV(p.propietario),
    escapeCSV(p.ubicacion),
    p.area.toFixed(2),
    p.perimetro.toFixed(2),
    escapeCSV(p.observaciones),
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Genera y descarga un libro de Excel (.xlsx) estructurado profesionalmente
 * con hoja de resumen ejecutivo y hoja de desglose de vértices/coordenadas
 */
export async function exportParcelSummaryExcel(parcels: Parcel[], projectTitle?: string): Promise<void> {
  if (!parcels || parcels.length === 0) {
    throw new Error('No hay parcelas para exportar');
  }

  const processed = parcels.map((p, idx) => processParcelForSummary(p, idx));
  const cleanTitle = (projectTitle || 'PROYECTO').trim();

  let totalArea = 0;
  let totalPerim = 0;
  processed.forEach((item) => {
    totalArea += item.area;
    totalPerim += item.perimetro;
  });
  const totalHa = totalArea / 10000;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema GeoGIS6';
  wb.created = new Date();

  // ── HOJA 1: RESUMEN DE CONTROL DE PARCELAS ──
  const wsSummary = wb.addWorksheet('Resumen de Parcelas');

  // Configurar anchos de columna para visualización ejecutiva
  wsSummary.columns = [
    { key: 'col1', width: 6 },  // N°
    { key: 'col2', width: 18 }, // ID Parcela
    { key: 'col3', width: 34 }, // Propietario / Titular
    { key: 'col4', width: 34 }, // Ubicación / Sector
    { key: 'col5', width: 16 }, // Área (m²)
    { key: 'col6', width: 16 }, // Superficie (ha)
    { key: 'col7', width: 16 }, // Perímetro (m)
    { key: 'col8', width: 14 }, // Cant. Vértices
    { key: 'col9', width: 20 }, // Datum
    { key: 'col10', width: 45 }, // Observaciones
  ];

  wsSummary.addRow(['SISTEMA GEOGIS6 - CONTROL CATASTRAL Y GEODÉSICO DE VENEZUELA']);
  wsSummary.addRow(['TABLA RESUMEN DE CONTROL DE PARCELAS']);
  wsSummary.addRow([]);
  wsSummary.addRow(['PROYECTO:', cleanTitle.toUpperCase()]);
  wsSummary.addRow(['FECHA DE EMISIÓN:', new Date().toLocaleDateString('es-VE') + ' ' + new Date().toLocaleTimeString('es-VE')]);
  wsSummary.addRow(['TOTAL PARCELAS:', processed.length]);
  wsSummary.addRow(['ÁREA TOTAL DEL PROYECTO (m²):', Number(totalArea.toFixed(2))]);
  wsSummary.addRow(['SUPERFICIE TOTAL (ha):', Number(totalHa.toFixed(4))]);
  wsSummary.addRow(['PERÍMETRO TOTAL (m):', Number(totalPerim.toFixed(2))]);
  wsSummary.addRow([]);

  const summaryHeader = wsSummary.addRow([
    'N°',
    'ID PARCELA',
    'PROPIETARIO / TITULAR',
    'UBICACIÓN / SECTOR',
    'ÁREA (m²)',
    'SUPERFICIE (ha)',
    'PERÍMETRO (m)',
    'CANT. VÉRTICES',
    'MÉTODO / DATUM',
    'OBSERVACIONES / ACCIONES PENDIENTES'
  ]);
  summaryHeader.font = { bold: true };

  processed.forEach((item, index) => {
    const origParcel = parcels[index];
    const verticesCount = origParcel?.puntos ? origParcel.puntos.length : 0;
    const ha = item.area / 10000;
    const datum = origParcel?.method ? origParcel.method.toUpperCase() : 'REGVEN / UTM';

    wsSummary.addRow([
      index + 1,
      item.id,
      item.propietario,
      item.ubicacion,
      Number(item.area.toFixed(2)),
      Number(ha.toFixed(4)),
      Number(item.perimetro.toFixed(2)),
      verticesCount,
      datum,
      item.observaciones
    ]);
  });

  // Fila de totales
  const totalRow = wsSummary.addRow([
    '',
    'TOTALES DEL PROYECTO',
    '',
    '',
    Number(totalArea.toFixed(2)),
    Number(totalHa.toFixed(4)),
    Number(totalPerim.toFixed(2)),
    '',
    '',
    `Total de ${processed.length} parcelas registradas`
  ]);
  totalRow.font = { bold: true };

  // ── HOJA 2: REGISTRO DETALLADO DE VÉRTICES (si existen puntos) ──
  const wsVertices = wb.addWorksheet('Detalle de Vértices');
  wsVertices.columns = [
    { key: 'col1', width: 18 }, // ID Parcela
    { key: 'col2', width: 30 }, // Propietario
    { key: 'col3', width: 16 }, // Vértice
    { key: 'col4', width: 16 }, // Este
    { key: 'col5', width: 16 }, // Norte
    { key: 'col6', width: 10 }, // Huso
    { key: 'col7', width: 15 }, // Latitud
    { key: 'col8', width: 15 }, // Longitud
    { key: 'col9', width: 18 }, // Cota
    { key: 'col10', width: 30 }, // Descripción
  ];

  wsVertices.addRow(['SISTEMA GEOGIS6 - DESGLOSE DE VÉRTICES POR PARCELA']);
  wsVertices.addRow(['PROYECTO:', cleanTitle.toUpperCase()]);
  wsVertices.addRow(['FECHA:', new Date().toLocaleDateString('es-VE')]);
  wsVertices.addRow([]);

  const vHeader = wsVertices.addRow([
    'ID PARCELA',
    'PROPIETARIO',
    'VÉRTICE / PUNTO',
    'ESTE (m)',
    'NORTE (m)',
    'HUSO',
    'LATITUD (°)',
    'LONGITUD (°)',
    'ELEVACIÓN / COTA (m)',
    'DESCRIPCIÓN'
  ]);
  vHeader.font = { bold: true };

  parcels.forEach((parcel, pIdx) => {
    const summaryItem = processed[pIdx];
    if (parcel.puntos && Array.isArray(parcel.puntos)) {
      parcel.puntos.forEach((p: any, vIdx: number) => {
        const pId = p.id || p.input?.id || `V-${vIdx + 1}`;
        const este = p.result?.este ?? p.este ?? p.e ?? p.x ?? p.result?.x ?? p.input?.este ?? p.input?.x ?? '';
        const norte = p.result?.norte ?? p.norte ?? p.n ?? p.y ?? p.result?.y ?? p.input?.norte ?? p.input?.y ?? '';
        const huso = p.result?.huso ?? p.input?.huso ?? p.huso ?? '19N';
        const lat = p.result?.lat ?? p.input?.lat ?? p.lat ?? '';
        const lng = p.result?.lng ?? p.input?.lng ?? p.lng ?? '';
        const elev = p.result?.h ?? p.input?.alt ?? p.h ?? p.z ?? '';
        const desc = p.input?.desc || p.desc || '';

        wsVertices.addRow([
          summaryItem.id,
          summaryItem.propietario,
          pId,
          typeof este === 'number' ? Number(este.toFixed(3)) : este,
          typeof norte === 'number' ? Number(norte.toFixed(3)) : norte,
          huso,
          typeof lat === 'number' ? Number(lat.toFixed(7)) : lat,
          typeof lng === 'number' ? Number(lng.toFixed(7)) : lng,
          typeof elev === 'number' ? Number(elev.toFixed(3)) : elev,
          desc
        ]);
      });
    }
  });

  // ── DESCARGA DEL ARCHIVO .XLSX ──
  const safeFileName = `TABLA_RESUMEN_PARCELAS_${cleanTitle.replace(/[^a-zA-Z0-9_\-]/g, '_').toUpperCase()}_${Date.now()}.xlsx`;

  try {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error al generar archivo Excel:', err);
    throw err;
  }
}

