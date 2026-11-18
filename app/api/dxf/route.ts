import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { runPythonScript } from '@/src/lib/python-bridge';
import { enforceAuthAndDeviceGuard } from '@/src/middleware/authGuard';
import { getRoleConstraints, isDemoRole } from '@/src/types/auth';
import { cleanupOutputsDirAsync } from '@/src/utils/dxfWatermark';

/**
 * @deprecated Usar /api/cad-layout o /api/export/dxf en su lugar.
 */
export async function POST(request: Request) {
  const guard = await enforceAuthAndDeviceGuard(request, {
    requiredCapability: 'export_dxf',
    endpoint: '/api/dxf',
  });
  if (!guard.ok) {
    return guard.response;
  }

  const constraints = getRoleConstraints(guard.canonicalRole);
  const isDemo = isDemoRole(guard.canonicalRole);
  const shouldWatermark = Boolean(
    constraints.dxfWatermarkRequired || (constraints.capabilities as any)?.dxf_watermark,
  );

  // ------- Payload --------------------------------------------------------
  const body = await request.json();
  const points = body.points || body.puntos;
  if (!Array.isArray(points) || points.length < 3) {
    return NextResponse.json({ error: 'La parcela debe tener al menos 3 puntos' }, { status: 400 });
  }

  body.watermark = shouldWatermark;
  if (isDemo && body.metadata) {
    body.metadata.includeSatellite = false;
  }

  try {
    const outputsDir = process.env.NODE_ENV === 'production' 
      ? path.join('/tmp', 'outputs') 
      : path.join(/*turbopackIgnore: true*/ process.cwd(), 'outputs');
    if (!fs.existsSync(/*turbopackIgnore: true*/ outputsDir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ outputsDir, { recursive: true });
    }

    const projectName = body.metadata?.projectName || body.metadata?.nombreProyecto || '';
    const safeName = projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dxfName = safeName ? `${safeName}_${Date.now()}.dxf` : `plano_${Date.now()}.dxf`;
    const dxfPath = path.join(/*turbopackIgnore: true*/ outputsDir, dxfName);
    
    const templatePath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'src/engines/geodesy/exporters/plantilla/MENSURA_BASE00.dxf');
    const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'src/engines/geodesy/exporters/render.py');

    const result = await runPythonScript(scriptPath, {
      template_path: templatePath,
      output_path: dxfPath,
      payload: body
    });

    if (result.status === 'success') {
      const finalPath = result.file || dxfPath;
      if (fs.existsSync(/*turbopackIgnore: true*/ finalPath)) {
        const response: any = { 
          status: 'success', 
          watermarked: shouldWatermark,
          watermarkLayer: shouldWatermark ? 'DEMO_WATERMARK_GEOTRANSFORMER' : null,
          fileUrl: `/api/download?file=${path.basename(finalPath)}` 
        };
        const svgPath = finalPath.replace(/\.dxf$/i, '.svg');
        if (fs.existsSync(/*turbopackIgnore: true*/ svgPath)) {
          response.svgUrl = `/api/download?file=${path.basename(svgPath)}&inline=true`;
        }
        if ((result as any).sat_image && !isDemo) {
          const relSatPath = path.relative(outputsDir, (result as any).sat_image).replace(/\\/g, '/');
          response.satImage = `/api/download?file=${encodeURIComponent(relSatPath)}`;
        }
        cleanupOutputsDirAsync(outputsDir);
        return NextResponse.json(response);
      }
    }

    throw new Error(result.message || 'Error inesperado en render.py');
  } catch (e: any) {
    console.error('[API DXF] Error generando DXF:', e);
    return NextResponse.json({ error: 'Error generando DXF: ' + e.message }, { status: 500 });
  }
}
