import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getOtaBundle } from '@/lib/serverOtaBundle';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GITHUB_MANIFEST_URL =
  'https://github.com/akey01/GeoGis_Android/releases/download/v6.0.0/apk-version.json';
const CACHE_TTL_MS = 30_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-device-id',
};

const FALLBACK_MANIFEST = {
  versionCode: 624,
  versionName: '6.0.24',
  bundleVersionCode: 624,
  nativeVersionCode: 612,
  buildNumber: 24,
  publishedAt: new Date().toISOString(),
  downloadUrl: 'https://github.com/akey01/GeoGis_Android/releases/latest/download/GeoGis6_Android.apk',
  bundleUrl: 'https://geogis6-android.onrender.com/api/ota-bundle',
  bundleSha256: null,
  releaseApiUrl: 'https://api.github.com/repos/akey01/GeoGis_Android/releases/latest',
  notes: 'GeoGIS6 Android Mobile Topographer + Parcelas + Proyectos Offline + OTA Live Update.',
};

let cachedManifest: { data: Record<string, any>; ts: number } | null = null;

function resolveRequestOrigin(request: Request): string {
  const fwdHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const fwdProto = request.headers.get('x-forwarded-proto');
  if (fwdHost) {
    const cleanHost = fwdHost.split(',')[0].trim();
    const proto = cleanHost.endsWith('.onrender.com')
      ? 'https'
      : (fwdProto ? fwdProto.split(',')[0].trim() : 'https');
    return `${proto}://${cleanHost}`;
  }
  const urlOrigin = new URL(request.url).origin;
  return urlOrigin.includes('.onrender.com')
    ? urlOrigin.replace(/^http:\/\//i, 'https://')
    : urlOrigin;
}

async function getLiveManifest(): Promise<Record<string, any>> {
  const now = Date.now();
  if (cachedManifest && now - cachedManifest.ts < CACHE_TTL_MS) {
    return cachedManifest.data;
  }

  try {
    const res = await fetch(`${GITHUB_MANIFEST_URL}?t=${now}`, {
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': 'GeoGIS6-Version-Check/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const ghJson = await res.json();
      if (ghJson && typeof ghJson === 'object') {
        cachedManifest = { data: ghJson, ts: now };
        return ghJson;
      }
    }
  } catch {
    // Fallback al manifiesto empaquetado localmente
  }

  try {
    const jsonPath = path.join(process.cwd(), 'public', 'apk-version.json');
    const raw = await fs.readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Fallback al constante por defecto
  }

  return FALLBACK_MANIFEST;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function normalizeSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : null;
}

export async function GET(request: Request) {
  const origin = resolveRequestOrigin(request);
  const live = await getLiveManifest();
  const versionCode = Number(live.bundleVersionCode ?? live.versionCode ?? FALLBACK_MANIFEST.versionCode);

  let bundleSha256 = normalizeSha256(live.bundleSha256);
  try {
    const bundle = await getOtaBundle(String(versionCode));
    bundleSha256 = bundle.sha256;
  } catch {
    // Keep live.bundleSha256 if ZIP fetch temporarily fails
  }

  return NextResponse.json(
    {
      success: true,
      ...FALLBACK_MANIFEST,
      ...live,
      versionCode,
      bundleVersionCode: versionCode,
      bundleUrl: `${origin}/api/ota-bundle?v=${versionCode}`,
      bundleSha256,
    },
    { status: 200, headers: CORS_HEADERS },
  );
}
