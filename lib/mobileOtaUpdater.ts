import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import {
  APK_DOWNLOAD_URL,
  APP_NATIVE_VERSION_CODE,
  APP_VERSION_CODE,
  APP_VERSION_NAME,
  BUNDLE_DOWNLOAD_URL,
  DESKTOP_FALLBACK_API_URL,
  GITHUB_RELEASE_API_URL,
  PROD_API_URL,
} from '@/components/geogis6-mobile/data/fieldData';
import { mobileApiFetch } from './mobileApi';

export interface OtaUpdateStatus {
  checking: boolean;
  installing: boolean;
  progress: number;
  hasUpdate: boolean;
  canApplyInApp: boolean;
  requiresApkUpdate: boolean;
  latestCode: number;
  latestName: string;
  bundleUrl: string | null;
  bundleSha256: string | null;
  apkDownloadUrl: string;
  notes: string;
  error: string | null;
}

export const INITIAL_OTA_STATUS: OtaUpdateStatus = {
  checking: false,
  installing: false,
  progress: 0,
  hasUpdate: false,
  canApplyInApp: false,
  requiresApkUpdate: false,
  latestCode: APP_VERSION_CODE,
  latestName: APP_VERSION_NAME,
  bundleUrl: null,
  bundleSha256: null,
  apkDownloadUrl: APK_DOWNLOAD_URL,
  notes: 'Versión oficial instalada y verificada.',
  error: null,
};

export async function notifyOtaAppReady(): Promise<void> {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    // ignore outside native updater runtime
  }
}

export function normalizeSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : null;
}

export async function checkOtaManifest(): Promise<OtaUpdateStatus> {
  let bestCode = APP_VERSION_CODE;
  let bestName = APP_VERSION_NAME;
  let bestNativeCode = APP_NATIVE_VERSION_CODE;
  let bestBundleUrl: string | null = null;
  let bestBundleSha256: string | null = null;
  let bestApkUrl = APK_DOWNLOAD_URL;
  let bestNotes = 'GeoGIS6 Mobile actualizado a la última versión estable.';
  let healthyApiBase: string | null = null;

  try {
    const [apiResult, ghResult] = await Promise.allSettled([
      mobileApiFetch(
        `/api/apk-version?t=${Date.now()}`,
        { cache: 'no-store' },
        { timeoutMs: 8000 },
      ).then(async ({ response, baseUrl }) => {
        if (!response.ok) return null;
        const json = await response.json().catch(() => null);
        return json ? { json, baseUrl } : null;
      }),
      fetch(GITHUB_RELEASE_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      }).then((r) => (r.ok ? r.json() : null)),
    ]);

    if (apiResult.status === 'fulfilled' && apiResult.value) {
      const { json: v, baseUrl } = apiResult.value;
      healthyApiBase = baseUrl;
      const code = Number(v.bundleVersionCode ?? v.versionCode ?? 0);
      const apiSha256 = normalizeSha256(v.bundleSha256);
      if (code > bestCode) {
        bestCode = code;
        bestName = String(v.versionName || bestName);
        bestNativeCode = Number(v.nativeVersionCode ?? APP_NATIVE_VERSION_CODE);
        bestBundleUrl =
          typeof v.bundleUrl === 'string' && v.bundleUrl
            ? v.bundleUrl
            : `${baseUrl}/api/ota-bundle?v=${code}`;
        bestBundleSha256 = apiSha256;
        bestApkUrl = String(v.downloadUrl || bestApkUrl);
        bestNotes = String(v.notes || bestNotes);
      } else if (code === bestCode && apiSha256 && !bestBundleSha256) {
        bestBundleSha256 = apiSha256;
      }
    }

    if (ghResult.status === 'fulfilled' && ghResult.value) {
      const gh = ghResult.value;
      const body = String(gh.body || '');
      const mCode = body.match(/\[APK_VERSION_CODE=(\d+)\]/i);
      const mName = body.match(/\[APK_VERSION_NAME=([^\]]+)\]/i);
      const mNative = body.match(/\[NATIVE_VERSION_CODE=(\d+)\]/i);
      const assets = Array.isArray(gh.assets) ? gh.assets : [];
      const apkAsset = assets.find((a: any) => String(a?.name || '').endsWith('.apk'));
      const zipAsset = assets.find((a: any) => String(a?.name || '').endsWith('.zip'));
      const jsonAsset = assets.find((a: any) => String(a?.name || '') === 'apk-version.json');

      let ghCode = mCode ? Number(mCode[1]) : 0;
      let ghName = mName ? mName[1].trim() : bestName;
      let ghNative = mNative ? Number(mNative[1]) : APP_NATIVE_VERSION_CODE;
      let ghBundleUrl = zipAsset?.browser_download_url || null;
      let ghBundleSha256: string | null = null;
      let ghApkUrl = apkAsset?.browser_download_url || bestApkUrl;
      let ghNotes = body.replace(/\[[A-Z0-9_]+=[^\]]+\]/g, '').trim() || bestNotes;

      if (jsonAsset?.browser_download_url) {
        try {
          const manifestRes = await fetch(jsonAsset.browser_download_url, {
            cache: 'no-store',
            signal: AbortSignal.timeout(6000),
          });
          if (manifestRes.ok) {
            const parsed = await manifestRes.json();
            ghCode = Math.max(ghCode, Number(parsed.bundleVersionCode ?? parsed.versionCode ?? 0));
            ghName = String(parsed.versionName || ghName);
            ghNative = Number(parsed.nativeVersionCode ?? ghNative);
            ghBundleUrl = parsed.bundleUrl || ghBundleUrl;
            ghBundleSha256 = normalizeSha256(parsed.bundleSha256) || ghBundleSha256;
            ghApkUrl = parsed.downloadUrl || ghApkUrl;
            ghNotes = parsed.notes || ghNotes;
          }
        } catch {
          // fallback to release body metadata
        }
      }

      if (ghCode > bestCode) {
        bestCode = ghCode;
        bestName = ghName;
        bestNativeCode = ghNative;
        bestBundleUrl = healthyApiBase
          ? `${healthyApiBase}/api/ota-bundle?v=${ghCode}`
          : `${DESKTOP_FALLBACK_API_URL}/api/ota-bundle?v=${ghCode}`;
        if (!bestBundleUrl && ghBundleUrl) {
          bestBundleUrl = ghBundleUrl;
        }
        bestBundleSha256 = ghBundleSha256 || bestBundleSha256;
        bestApkUrl = ghApkUrl;
        bestNotes = ghNotes;
      }
    }
  } catch {
    // offline field mode
  }

  const hasUpdate = bestCode > APP_VERSION_CODE;
  const requiresApkUpdate = hasUpdate && bestNativeCode > APP_NATIVE_VERSION_CODE;
  const canApplyInApp =
    hasUpdate &&
    !requiresApkUpdate &&
    Boolean(bestBundleUrl) &&
    typeof window !== 'undefined' &&
    Capacitor.isNativePlatform();

  return {
    checking: false,
    installing: false,
    progress: 0,
    hasUpdate,
    canApplyInApp,
    requiresApkUpdate,
    latestCode: bestCode,
    latestName: bestName,
    bundleUrl: bestBundleUrl,
    bundleSha256: bestBundleSha256,
    apkDownloadUrl: bestApkUrl,
    notes: bestNotes,
    error: null,
  };
}

export async function applyOtaBundleInApp(
  manifest: {
    bundleUrl: string;
    latestCode?: number;
    latestName: string;
    bundleSha256?: string | null;
  },
  onProgress: (percent: number) => void,
): Promise<void> {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) {
    throw new Error('Actualización en línea disponible solo dentro de la app Android');
  }

  const codeTag = manifest.latestCode || manifest.latestName;
  const rawCandidates = [
    manifest.bundleUrl && manifest.bundleUrl.includes('/api/ota-bundle')
      ? manifest.bundleUrl
      : '',
    `${DESKTOP_FALLBACK_API_URL.replace(/\/+$/, '')}/api/ota-bundle?v=${encodeURIComponent(String(codeTag))}`,
    `${PROD_API_URL.replace(/\/+$/, '')}/api/ota-bundle?v=${encodeURIComponent(String(codeTag))}`,
    manifest.bundleUrl || '',
    BUNDLE_DOWNLOAD_URL,
  ].filter(Boolean);

  const candidates: string[] = [];
  for (const url of rawCandidates) {
    if (!candidates.includes(url)) {
      candidates.push(url);
    }
  }

  let checksum = normalizeSha256(manifest.bundleSha256);
  if (!checksum) {
    try {
      const { response } = await mobileApiFetch(
        `/api/apk-version?t=${Date.now()}`,
        { cache: 'no-store' },
        { timeoutMs: 10000 },
      );
      if (response.ok) {
        const json = await response.json().catch(() => null);
        checksum = normalizeSha256(json?.bundleSha256);
      }
    } catch {
      // Fallback al header X-Bundle-Sha256 en HEAD
    }
  }

  if (!checksum && candidates[0]) {
    try {
      const headRes = await fetch(candidates[0], {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (headRes.ok) {
        checksum = normalizeSha256(headRes.headers.get('x-bundle-sha256'));
      }
    } catch {
      // ignore HEAD fallback failure
    }
  }

  if (!checksum) {
    throw new Error('No se pudo verificar el checksum SHA-256 del paquete de actualización');
  }

  const listener = await CapacitorUpdater.addListener('download', (info: any) => {
    const pct = Math.max(0, Math.min(100, Math.round(Number(info?.percent ?? 0))));
    onProgress(pct);
  });

  let lastError: unknown = null;
  try {
    for (const url of candidates) {
      try {
        const bundle = await CapacitorUpdater.download({
          url,
          version: manifest.latestName,
          checksum,
        });
        onProgress(100);
        await CapacitorUpdater.set({ id: bundle.id });
        return;
      } catch (err) {
        lastError = err;
      }
    }

    const reason =
      lastError instanceof Error
        ? lastError.message
        : typeof lastError === 'string'
          ? lastError
          : 'No se pudo descargar el paquete OTA';
    throw new Error(reason);
  } finally {
    await listener.remove().catch(() => {});
  }
}
