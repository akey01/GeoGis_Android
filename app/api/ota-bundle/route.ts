import { NextResponse } from 'next/server';
import { getOtaBundle } from '@/lib/serverOtaBundle';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-device-id',
  'Access-Control-Expose-Headers': 'X-Bundle-Sha256, Content-Length',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function HEAD(request: Request) {
  try {
    const versionKey = new URL(request.url).searchParams.get('v') || 'latest';
    const bundle = await getOtaBundle(versionKey);
    return new NextResponse(null, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/zip',
        'Content-Length': String(bundle.data.byteLength),
        'Content-Disposition': 'attachment; filename="geogis6-web-bundle.zip"',
        'X-Bundle-Sha256': bundle.sha256,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Bundle OTA no disponible' },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}

export async function GET(request: Request) {
  try {
    const versionKey = new URL(request.url).searchParams.get('v') || 'latest';
    const bundle = await getOtaBundle(versionKey);
    return new NextResponse(bundle.data, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/zip',
        'Content-Length': String(bundle.data.byteLength),
        'Content-Disposition': 'attachment; filename="geogis6-web-bundle.zip"',
        'X-Bundle-Sha256': bundle.sha256,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[API /ota-bundle] Error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Error descargando paquete OTA' },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}
