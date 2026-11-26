import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-device-id',
};

const FALLBACK_MANIFEST = {
  versionCode: 612,
  versionName: '6.0.12',
  bundleVersionCode: 612,
  nativeVersionCode: 612,
  buildNumber: 12,
  publishedAt: new Date().toISOString(),
  downloadUrl: 'https://github.com/akey01/GeoGis_Android/releases/latest/download/GeoGis6_Android.apk',
  bundleUrl: 'https://github.com/akey01/GeoGis_Android/releases/latest/download/geogis6-web-bundle.zip',
  bundleSha256: null,
  releaseApiUrl: 'https://api.github.com/repos/akey01/GeoGis_Android/releases/latest',
  notes: 'GeoGIS6 Android Mobile Topographer + Parcelas + Proyectos Offline + OTA Live Update.',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const jsonPath = path.join(process.cwd(), 'public', 'apk-version.json');
    const raw = await fs.readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return NextResponse.json(
      { success: true, ...FALLBACK_MANIFEST, ...parsed },
      { status: 200, headers: CORS_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { success: true, ...FALLBACK_MANIFEST },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}
