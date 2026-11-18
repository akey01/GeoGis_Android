import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { enforceAuthAndDeviceGuard } from '@/src/middleware/authGuard';
import { getRoleConstraints, isDemoRole } from '@/src/types/auth';
import { runPythonScript } from '@/src/lib/python-bridge';
import { injectDemoWatermarkIntoDxfFile, cleanupOutputsDirAsync } from '@/src/utils/dxfWatermark';

export const dynamic = 'force-dynamic';

/**
 * POST /api/export/dxf
 * Exportación CAD DXF protegida con Device Binding.
 * Permitida para el rol 'demo' (máx. 20 vértices), inyectando marca de agua en capa dedicada.
 */
export async function POST(request: Request) {
  const guard = await enforceAuthAndDeviceGuard(request, {
    requiredCapability: 'export_dxf',
    endpoint: '/api/export/dxf',
  });

  if (!guard.ok) {
    return guard.response;
  }

  const body = await request.json().catch(() => ({}));
  const points: any[] = body.points || body.puntos || [];
  if (!Array.isArray(points) || points.length < 1) {
    return NextResponse.json({ error: 'Se requieren puntos para exportar DXF' }, { status: 400 });
  }

  const constraints = getRoleConstraints(guard.canonicalRole);
  if (
    constraints.maxVerticesPerCalculation !== null &&
    points.length > constraints.maxVerticesPerCalculation
  ) {
    return NextResponse.json(
      {
        error: `El perfil "${constraints.label}" permite un máximo de ${constraints.maxVerticesPerCalculation} vértices por cálculo/exportación (recibidos: ${points.length}).`,
        code: 'MAX_VERTICES_EXCEEDED',
        maxVertices: constraints.maxVerticesPerCalculation,
      },
      { status: 403 },
    );
  }

  const isDemo = isDemoRole(guard.canonicalRole);
  const shouldWatermark = Boolean(
    constraints.dxfWatermarkRequired || (constraints.capabilities as any)?.dxf_watermark,
  );
  body.watermark = shouldWatermark;
  if (isDemo && body.metadata) {
    // Bloquear ortofoto satelital embebida en DXF para rol demo
    body.metadata.includeSatellite = false;
  }
  if (body.metadata && typeof body.metadata === 'object') {
    if (shouldWatermark) {
      body.metadata.demoWatermark = 'MODO DEMO - GEOGIS6';
    } else {
      delete body.metadata.demoWatermark;
    }
  }

  try {
    const outputsDir = (process.env.NODE_ENV === 'production' && process.platform !== 'win32')
      ? path.join('/tmp', 'outputs')
      : path.resolve(process.cwd(), 'outputs');

    if (!fs.existsSync(/*turbopackIgnore: true*/ outputsDir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ outputsDir, { recursive: true });
    }

    const projectName = body.metadata?.projectName || body.metadata?.nombreProyecto || 'plano';
    const safeName = projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dxfName = `${safeName}_${shouldWatermark ? 'demo_' : ''}${Date.now()}.dxf`;
    const dxfPath = path.join(/*turbopackIgnore: true*/ outputsDir, dxfName);

    const templatePath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'src/engines/geodesy/exporters/plantilla/MENSURA_BASE00.dxf');
    const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'src/engines/geodesy/exporters/render.py');

    const result = await runPythonScript(scriptPath, {
      template_path: templatePath,
      output_path: dxfPath,
      payload: { ...body, points, watermark: shouldWatermark },
    });

    if (result.status === 'success') {
      const finalPath = result.file || dxfPath;
      if (fs.existsSync(/*turbopackIgnore: true*/ finalPath)) {
        cleanupOutputsDirAsync(outputsDir);
        return NextResponse.json({
          status: 'success',
          watermarked: shouldWatermark,
          watermarkLayer: shouldWatermark ? 'DEMO_WATERMARK_GEOTRANSFORMER' : null,
          file: `/api/download?file=${path.basename(finalPath)}`,
          fileUrl: `/api/download?file=${path.basename(finalPath)}`,
          dxfUrl: `/api/download?file=${path.basename(finalPath)}`,
        });
      }
    }

    throw new Error(result.message || 'Error inesperado generando DXF');
  } catch (err: any) {
    console.error('[API /export/dxf] Error:', err);
    return NextResponse.json(
      { error: 'Error generando DXF: ' + (err?.message || 'Error interno') },
      { status: 500 },
    );
  }
}
