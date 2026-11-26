import crypto from 'node:crypto';

const GITHUB_BUNDLE_URL =
  'https://github.com/akey01/GeoGis_Android/releases/download/v6.0.0/geogis6-web-bundle.zip';
const CACHE_TTL_MS = 60_000;

export interface CachedOtaBundle {
  data: ArrayBuffer;
  sha256: string;
  versionKey: string;
  ts: number;
}

let cachedBundle: CachedOtaBundle | null = null;
let inflight: { key: string; promise: Promise<CachedOtaBundle> } | null = null;

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

/**
 * Fetches, validates, caches, and computes the exact lowercase SHA-256 hex digest
 * of the active GeoGIS6 Android OTA web bundle ZIP so /api/apk-version and /api/ota-bundle
 * always agree on the exact same payload bytes.
 */
export async function getOtaBundle(versionKey = 'latest'): Promise<CachedOtaBundle> {
  const key = String(versionKey || 'latest').trim() || 'latest';
  const now = Date.now();

  if (
    cachedBundle &&
    now - cachedBundle.ts < CACHE_TTL_MS &&
    (key === 'latest' || cachedBundle.versionKey === key)
  ) {
    return cachedBundle;
  }

  if (inflight && inflight.key === key) {
    return inflight.promise;
  }

  const promise = (async (): Promise<CachedOtaBundle> => {
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

    const sha256 = crypto
      .createHash('sha256')
      .update(Buffer.from(buf))
      .digest('hex');

    const bundle: CachedOtaBundle = {
      data: buf,
      sha256,
      versionKey: key,
      ts: Date.now(),
    };
    cachedBundle = bundle;
    return bundle;
  })();

  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) {
      inflight = null;
    }
  }
}
