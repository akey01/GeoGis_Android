import { NextResponse } from 'next/server';
import { enforceAuthAndDeviceGuard } from '@/src/middleware/authGuard';
import { isDemoRole } from '@/src/types/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/layers/satellite-tiles
 * Proxy/Autorizador de teselas satelitales y ortofotos de alta resolución.
 * Estrictamente bloqueado (HTTP 403) cuando el rol es 'demo'.
 */
export async function GET(request: Request) {
  const guard = await enforceAuthAndDeviceGuard(request, {
    requiredCapability: 'satellite_imagery',
    endpoint: '/api/layers/satellite-tiles',
  });

  if (!guard.ok) {
    return guard.response;
  }

  if (isDemoRole(guard.canonicalRole)) {
    return NextResponse.json(
      {
        error: 'El acceso y descarga de capas satelitales y ortofotos está bloqueado en Modo Demo.',
        code: 'DEMO_SATELLITE_BLOCKED',
      },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const z = searchParams.get('z') || '15';
  const x = searchParams.get('x') || '0';
  const y = searchParams.get('y') || '0';

  const tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

  try {
    const upstream = await fetch(tileUrl);
    if (!upstream.ok) {
      return NextResponse.json({ error: 'No se pudo obtener la tesela satelital' }, { status: 502 });
    }
    const buffer = await upstream.arrayBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error al obtener tesela satelital' },
      { status: 500 },
    );
  }
}

