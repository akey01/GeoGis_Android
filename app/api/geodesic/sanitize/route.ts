import { NextResponse } from 'next/server';
import { GeoEngine } from '@/lib/geo-engine';
import { requireSession } from '@/lib/rbac';

export interface SanitizeInput {
  id: string;
  norte_origen: number;
  este_origen: number;
  cota_origen?: number;
}

export interface SanitizeOutput {
  id: string;
  este_regven: number;
  norte_regven: number;
  cota_regven: number;
  cotaInyectada: boolean;
  descripcion: string;
  // Coordenadas de origen normalizadas (post-auditoría de transposición)
  este_canoa: number;
  norte_canoa: number;
}

export interface SanitizeResponse {
  ok: boolean;
  metodo: 'RIGIDA02_ADICORA_REGVEN';
  qaqcPasado: boolean;
  deltaEste: number;
  deltaNorte: number;
  cotaGeoidalDefecto: number;
  totalVertices: number;
  resultados: SanitizeOutput[];
}

/**
 * POST /api/geodesic/sanitize
 *
 * Motor RIGIDA02 — GEO-ADÍCORA REGVEN Engine v1.0.0
 * Sector: Municipio Falcón, Estado Falcón, Venezuela
 * Transforma lotes de vértices desde La Canoa (PSAD-56) → REGVEN (SIRGAS/WGS84 - EPSG:2203)
 * mediante traslación rígida pura con QA/QC de invarianza de forma.
 *
 * Body: JSON array de vértices
 * [{ "id": "P1", "norte_origen": 1327653.220, "este_origen": 409662.260, "cota_origen": 0 }]
 *
 * Respuesta: SanitizeResponse con resultados y certificación QA/QC.
 *
 * Errores:
 *   400 — Payload inválido o menos de 2 vértices
 *   401 — No autenticado
 *   422 — QA/QC fallido (deformación topológica detectada)
 *   500 — Error interno del motor
 */
export async function POST(request: Request) {
  // ── Autenticación ───────────────────────────────────────────────────────────
  const auth = await requireSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // ── Parseo y validación del body ────────────────────────────────────────────
  let rawBody: any;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'JSON inválido. Se esperaba un array de vértices o un objeto con { vertices: [...] }.' },
      { status: 400 }
    );
  }

  const isObjectPayload = !Array.isArray(rawBody) && rawBody && Array.isArray(rawBody.vertices);
  const body: SanitizeInput[] = isObjectPayload ? rawBody.vertices : rawBody;
  const customDeltas = isObjectPayload ? {
    deltaEste: typeof rawBody.deltaEste === 'number' ? rawBody.deltaEste : undefined,
    deltaNorte: typeof rawBody.deltaNorte === 'number' ? rawBody.deltaNorte : undefined,
    cotaGeoidal: typeof rawBody.cotaGeoidal === 'number' ? rawBody.cotaGeoidal : undefined,
  } : undefined;

  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json(
      { error: 'El payload debe ser un array JSON no vacío de vértices o contener una propiedad "vertices".' },
      { status: 400 }
    );
  }

  if (body.length < 2) {
    return NextResponse.json(
      { error: 'RIGIDA02 requiere mínimo 2 vértices para validar la invarianza de forma.' },
      { status: 400 }
    );
  }

  // Validar campos mínimos de cada vértice
  for (const v of body) {
    if (!v.id || typeof v.norte_origen !== 'number' || typeof v.este_origen !== 'number') {
      return NextResponse.json(
        {
          error: `Vértice inválido: se requieren 'id' (string), 'norte_origen' (number), 'este_origen' (number). Recibido: ${JSON.stringify(v)}`,
        },
        { status: 400 }
      );
    }
  }

  // ── Ejecución del motor RIGIDA02 ────────────────────────────────────────────
  try {
    const output = GeoEngine.transformRigida02(
      body.map(v => ({
        id: v.id,
        norte_origen: v.norte_origen,
        este_origen: v.este_origen,
        cota_origen: v.cota_origen ?? 0,
      })),
      customDeltas
    );

    const response: SanitizeResponse = {
      ok: true,
      metodo: output.metodo,
      qaqcPasado: output.qaqcPasado,
      deltaEste: output.deltaEste,
      deltaNorte: output.deltaNorte,
      cotaGeoidalDefecto: output.cotaGeoidalDefecto,
      totalVertices: output.resultados.length,
      resultados: output.resultados.map(r => ({
        id: r.id,
        este_regven: r.este_regven,
        norte_regven: r.norte_regven,
        cota_regven: r.cota_regven,
        cotaInyectada: r.cotaInyectada,
        descripcion: r.descripcion,
        este_canoa: r.este_canoa,
        norte_canoa: r.norte_canoa,
      })),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno del motor RIGIDA02';

    // QA/QC failure → HTTP 422 (igual que el FastAPI original)
    if (message.startsWith('RIGIDA02 QA/QC FAIL')) {
      return NextResponse.json(
        {
          error: message,
          code: 'QAQC_RIGIDEZ_EXCEDIDA',
        },
        { status: 422 }
      );
    }

    console.error('[API /geodesic/sanitize] Error RIGIDA02:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/geodesic/sanitize
 * Información del endpoint para integración y pruebas.
 */
export async function GET() {
  return NextResponse.json({
    motor: 'RIGIDA02 — GEO-ADÍCORA REGVEN Engine',
    version: '1.0.0',
    sector: 'Municipio Falcón, Estado Falcón, Venezuela',
    origen: 'La Canoa / PSAD-56',
    destino: 'REGVEN (SIRGAS / WGS84 — EPSG:2203)',
    constantes: {
      delta_este: GeoEngine.RIGIDA02_DELTA_ESTE,
      delta_norte: GeoEngine.RIGIDA02_DELTA_NORTE,
      cota_geoidal_defecto: GeoEngine.RIGIDA02_COTA_GEOIDAL,
    },
    uso: 'POST /api/geodesic/sanitize con body: [{ id, norte_origen, este_origen, cota_origen? }]',
    fases: [
      '1. AUDITORÍA: Transposición automática Norte/Este por análisis de magnitudes',
      '2. TRASLACIÓN RÍGIDA PURA: E_REGVEN = E_Canoa + ΔE | N_REGVEN = N_Canoa + ΔN',
      '3. ALTIMETRÍA: Inyección cota geoidal si Z=0, preservación si Z≠0',
      '4. QA/QC: Invarianza de forma — tolerancia cero al milímetro (0.001 m)',
    ],
  });
}
