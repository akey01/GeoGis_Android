import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GITHUB_BUNDLE_URL =
  'https://github.com/akey01/GeoGis_Android/releases/download/v6.0.0/geogis6-web-bundle.zip';
const CACHE_TTL_MS = 60_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-device-id',
};

let cachedZip: { data: ArrayBuffer; ts: number } | null = null;

function isValidZipBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 1024) return false;
  const bytes = new Uint8Array(buf);
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

async function getOtaBundleBuffer(): Promise<ArrayBuffer> {
  const now = Date.now();
  if (cachedZip && now - cachedZip.ts < CACHE_TTL_MS) {
    return cachedZip.data;
  }

  const res = await fetch(`${GITHUB_BUNDLE_URL}?t=${now}`, {
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'User-Agent': 'GeoGIS6-OTA-Proxy/1.0',
      Accept: 'application/octet-stream, application/zip, */*',
    },
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    throw new Error(`GitHub Release respondió HTTP ${res.status}`);
  }

  const buf = await res.arrayBuffer();
  if (!isValidZipBuffer(buf)) {
    throw new Error('El paquete OTA recibido no es un archivo ZIP válido');
  }

  cachedZip = { data: buf, ts: now };
  return buf;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function HEAD() {
  try {
    const buf = await getOtaBundleBuffer();
    return new NextResponse(null, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/zip',
        'Content-Length': String(buf.byteLength),
        'Content-Disposition': 'attachment; filename="geogis6-web-bundle.zip"',
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

export async function GET() {
  try {
    const buf = await getOtaBundleBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/zip',
        'Content-Length': String(buf.byteLength),
        'Content-Disposition': 'attachment; filename="geogis6-web-bundle.zip"',
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
