import { NextResponse } from 'next/server';
import path from 'path';
import { runPythonScript } from '@/src/lib/python-bridge';
import {
  buildTransformCacheKey,
  cacheGet,
  cacheSet,
  CACHE_TTL,
  type TransformCacheInput,
} from '@/lib/cache';
import { requireSession } from '@/lib/rbac';

const DIRECTION_CRS: Record<TransformCacheInput['direction'], { source: string; target: string }> = {
  canoa_regven: { source: 'EPSG:24819', target: 'EPSG:2202' },
  regven_canoa: { source: 'EPSG:2202', target: 'EPSG:24819' },
};

function parseTransformInput(searchParams: URLSearchParams): TransformCacheInput | { error: string } {
  const direction = searchParams.get('direction') as TransformCacheInput['direction'] | null;
  const method = searchParams.get('method') as TransformCacheInput['method'] | null;
  const pointsRaw = searchParams.get('points');

  if (!direction || !['canoa_regven', 'regven_canoa'].includes(direction)) {
    return { error: 'Parámetro direction inválido (canoa_regven | regven_canoa)' };
  }

  if (!method || !['badekas', 'rigida'].includes(method)) {
    return { error: 'Parámetro method inválido (badekas | rigida)' };
  }

  if (!pointsRaw) {
    return { error: 'Parámetro points requerido (JSON array [{x,y},...])' };
  }

  let points: TransformCacheInput['points'];
  try {
    points = JSON.parse(pointsRaw);
    if (!Array.isArray(points) || points.length === 0) {
      return { error: 'points debe ser un array no vacío' };
    }
  } catch {
    return { error: 'points debe ser JSON válido' };
  }

  const crs = DIRECTION_CRS[direction];
  return {
    direction,
    method,
    source_crs: searchParams.get('source_crs') ?? crs.source,
    target_crs: searchParams.get('target_crs') ?? crs.target,
    points,
  };
}

async function executeTransform(input: TransformCacheInput) {
  const scriptPath = path.join(process.cwd(), 'src/engines/geodesy/transform/transform_v2.py');
  const payload = {
    points: input.points,
    source_crs: input.source_crs,
    target_crs: input.target_crs,
    method: input.method,
    direction: input.direction,
  };

  return runPythonScript(scriptPath, payload);
}

async function handleTransform(input: TransformCacheInput) {
  const cacheKey = buildTransformCacheKey(input);
  const cached = await cacheGet<Record<string, unknown>>(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, cache: 'hit' });
  }

  try {
    const result = await executeTransform(input);

    if (result.status === 'error') {
      return NextResponse.json(
        { error: `Geodetic engine error: ${result.message}` },
        { status: 500 },
      );
    }

    await cacheSet(cacheKey, result, CACHE_TTL.TRANSFORM_SECONDS);
    return NextResponse.json({ ...result, cache: 'miss' });
  } catch (error) {
    console.error('[API /transform] Error:', error);
    const message = error instanceof Error ? error.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/transform?direction=canoa_regven&method=badekas&points=[{"x":123,"y":456}]
 */
export async function GET(request: Request) {
  const auth = await requireSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const parsed = parseTransformInput(searchParams);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  return handleTransform(parsed);
}

/** POST /api/transform – same Cache-Aside logic for larger payloads. */
export async function POST(request: Request) {
  const auth = await requireSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: TransformCacheInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  if (!body.direction || !body.method || !Array.isArray(body.points) || body.points.length === 0) {
    return NextResponse.json(
      { error: 'Se requieren direction, method y points[]' },
      { status: 400 },
    );
  }

  const crs = DIRECTION_CRS[body.direction];
  const input: TransformCacheInput = {
    direction: body.direction,
    method: body.method,
    source_crs: body.source_crs ?? crs.source,
    target_crs: body.target_crs ?? crs.target,
    points: body.points,
  };

  return handleTransform(input);
}
