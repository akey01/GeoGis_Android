import { NextRequest, NextResponse } from 'next/server';
import { enforceAuthAndDeviceGuard } from '@/src/middleware/authGuard';
import { isDemoRole } from '@/src/types/auth';

export async function GET(request: NextRequest) {
  const guard = await enforceAuthAndDeviceGuard(request, {
    requiredCapability: 'satellite_imagery',
    endpoint: '/api/staticmap',
  });

  if (!guard.ok) {
    return guard.response;
  }

  if (isDemoRole(guard.canonicalRole)) {
    return NextResponse.json(
      { error: 'La descarga de fotos satelitales y ortofotos está bloqueada en Modo Demo.' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lng = searchParams.get('lng');
  const spanLat = searchParams.get('spanLat') || '0.002';
  const spanLng = searchParams.get('spanLng') || '0.002';
  const type = searchParams.get('type') || 'sat';

  if (!lat || !lng) {
    return NextResponse.json({ error: 'Faltan parámetros lat y lng' }, { status: 400 });
  }

  const yandexUrl = `https://static-maps.yandex.ru/1.x/?ll=${lng},${lat}&spn=${spanLng},${spanLat}&size=650,450&l=${type}`;

  try {
    const res = await fetch(yandexUrl);
    if (!res.ok) {
      throw new Error(`Yandex API returned status ${res.status}`);
    }

    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="mapa_fondo.png"',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('StaticMap proxy error:', err);
    return NextResponse.json({ error: 'Error al obtener el mapa estático' }, { status: 500 });
  }
}
