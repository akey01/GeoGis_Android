import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { runPythonScript } from '@/src/lib/python-bridge';
import { cacheGet, cacheSet } from '@/lib/cache';
import { enforceAuthAndDeviceGuard } from '@/src/middleware/authGuard';
import { getRoleConstraints, isDemoRole } from '@/src/types/auth';
import { injectDemoWatermarkIntoDxfFile, cleanupOutputsDirAsync } from '@/src/utils/dxfWatermark';
export { cleanupOutputsDirAsync };

const CACHE_TTL_DXF = 86_400;
const isRenderCloud = Boolean(process.env.RENDER || process.env.NODE_ENV === 'production');
const MAX_POINTS = isRenderCloud ? 500 : 5000;
const MAX_JSON_BYTES = isRenderCloud ? 8 * 1024 * 1024 : 20 * 1024 * 1024;

function dxfCacheKey(body: any, role: string, shouldWatermark: boolean): string {
  const stable = JSON.stringify({ ...body, __role: role, __wm: shouldWatermark }, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((a, k) => { (a as any)[k] = (v as any)[k]; return a; }, {} as any)
      : v
  );
  return `dxf_v8:${createHash('sha256').update(stable).digest('hex')}`;
}

function validateCadPayload(body: any, maxPointsAllowed: number | null) {
  if (!body || typeof body !== 'object') {
    return 'Payload invalido';
  }
  if (!Array.isArray(body.points)) {
    return 'points debe ser un array';
  }
  const minPts = body.geometryType === 'puntos' ? 1 : body.geometryType === 'abierta' ? 2 : 3;
  if (body.points.length < minPts) {
    return `La parcela debe tener al menos ${minPts} punto(s) para geometría ${body.geometryType || 'cerrada'}`;
  }
  const limit = maxPointsAllowed !== null ? Math.min(MAX_POINTS, maxPointsAllowed) : MAX_POINTS;
  if (body.points.length > limit) {
    return `Su perfil permite un máximo de ${limit} vértices por cálculo/exportación (recibidos: ${body.points.length})`;
  }
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_JSON_BYTES) {
    return 'Payload demasiado grande';
  }
  return null;
}

export async function POST(request: Request) {
  const guard = await enforceAuthAndDeviceGuard(request, {
    requiredCapability: 'export_dxf',
    endpoint: '/api/cad-layout',
  });

  if (!guard.ok) {
    return guard.response;
  }

  const constraints = getRoleConstraints(guard.canonicalRole);
  const isDemo = isDemoRole(guard.canonicalRole);
  const shouldWatermark = Boolean(
    constraints.dxfWatermarkRequired || (constraints.capabilities as any)?.dxf_watermark,
  );

  const body = await request.json();
  if (Array.isArray(body.parcels) && body.parcels.length > 0) {
    if (!body.points || !Array.isArray(body.points) || body.points.length === 0) {
      body.points = body.parcels.flatMap((p: any) => p.points || p.puntos || []);
    }
  } else if (!body.points && body.puntos) {
    body.points = body.puntos;
    delete body.puntos;
  }

  const validationError = validateCadPayload(body, constraints.maxVerticesPerCalculation);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 403 });
  }

  body.watermark = shouldWatermark;
  if (body.metadata && typeof body.metadata === 'object') {
    if (shouldWatermark) {
      body.metadata.demoWatermark = 'MODO DEMO - GEOGIS6';
    } else {
      delete body.metadata.demoWatermark;
    }
  }

  if (isDemo && body.metadata) {
    body.metadata.includeSatellite = false;
  }

  const outputsDir = (process.env.NODE_ENV === 'production' && process.platform !== 'win32')
    ? path.join('/tmp', 'outputs') 
    : path.resolve(process.cwd(), 'outputs');

  const key = dxfCacheKey(body, guard.canonicalRole, shouldWatermark);
  const cached = await cacheGet<{ filename: string }>(key);
  if (cached) {
    const cachedPath = path.join(/*turbopackIgnore: true*/ outputsDir, cached.filename);
    if (fs.existsSync(/*turbopackIgnore: true*/ cachedPath)) {
      return NextResponse.json({
        status: 'success',
        watermarked: shouldWatermark,
        watermarkLayer: shouldWatermark ? 'DEMO_WATERMARK_GEOTRANSFORMER' : null,
        file: `/api/download?file=${cached.filename}`,
        fileUrl: `/api/download?file=${cached.filename}`,
        dxfUrl: `/api/download?file=${cached.filename}`,
        cache: 'hit',
      });
    }
  }

  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ outputsDir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ outputsDir, { recursive: true });
    }
    cleanupOutputsDirAsync(outputsDir);

    const projectName = body.metadata?.projectName || body.metadata?.nombreProyecto || '';
    const sanitizedProjectName = projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = sanitizedProjectName
      ? `${sanitizedProjectName}_${shouldWatermark ? 'demo_' : ''}${Date.now()}.dxf`
      : `plano_${shouldWatermark ? 'demo_' : ''}${Date.now()}.dxf`;

    const outputFilePath = path.join(/*turbopackIgnore: true*/ outputsDir, filename);

    const TEMPLATE_DIRS = [
      path.join(process.cwd(), 'src/engines/geodesy/exporters/plantilla'),
      path.join(process.cwd(), 'plantilla'),
    ];
    function resolveTpl(tplFile: string): string | null {
      for (const d of TEMPLATE_DIRS) {
        const fp = path.join(/*turbopackIgnore: true*/ d, tplFile);
        if (fs.existsSync(/*turbopackIgnore: true*/ fp)) return fp;
      }
      return null;
    }

    let templatePath = resolveTpl('MENSURA_BASE00.dxf') || path.join(/*turbopackIgnore: true*/ process.cwd(), 'src/engines/geodesy/exporters/plantilla/MENSURA_BASE00.dxf');
    if (body.templateId) {
      const metaPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'src/engines/geodesy/exporters/plantilla/templates_meta.json');
      try {
        const metaRaw = fs.readFileSync(/*turbopackIgnore: true*/ metaPath, 'utf-8');
        const templates = JSON.parse(metaRaw);
        const match = templates.find((t: any) => t.id === body.templateId && t.file);
        if (match && match.file) {
          const resolved = resolveTpl(match.file);
          if (resolved) templatePath = resolved;
        }
      } catch { /* fallback to default */ }
    }

    const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'src/engines/geodesy/exporters/render.py');

    const env = {
      ...process.env,
      GOOGLE_MAPS_API_KEY: isDemo ? '' : (process.env.GOOGLE_MAPS_API_KEY || ''),
    };

    const result = await runPythonScript(scriptPath, {
      template_path: templatePath,
      output_path: outputFilePath,
      payload: body,
      layout_config: body.layoutConfig || null,
      render_mode: body.renderMode || 'layout'
    }, env);

    if (result.status === 'success') {
      const dxfPath = (result as any).dxf_file || result.file || outputFilePath;

      if (fs.existsSync(/*turbopackIgnore: true*/ dxfPath)) {
        const dxfFilename = path.basename(dxfPath);

        await cacheSet(key, { 
          filename: dxfFilename,
        }, CACHE_TTL_DXF);

        return NextResponse.json({
          status: 'success',
          watermarked: shouldWatermark,
          watermarkLayer: shouldWatermark ? 'DEMO_WATERMARK_GEOTRANSFORMER' : null,
          file: `/api/download?file=${dxfFilename}`,
          fileUrl: `/api/download?file=${dxfFilename}`,
          dxfUrl: `/api/download?file=${dxfFilename}`,
          cache: 'miss',
        });
      }
    }
    
    throw new Error(result.message || 'Error generando plano DXF');
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[API CAD-Layout] Local render failed:', errorMessage);
    return NextResponse.json({ 
      status: 'error',
      error: errorMessage,
      message: errorMessage 
    }, { status: 500 });
  }
}
