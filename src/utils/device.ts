/**
 * src/utils/device.ts
 * Generación de Fingerprint persistente de Dispositivo (Device Binding),
 * Interceptor automático de Fetch para inyectar 'x-device-id',
 * y utilidades de detección de plataforma para el Panel de Dispositivos.
 * (Isomórfico: seguro para importar tanto en Server Actions/Route Handlers como en Client Components).
 */

const DEVICE_STORAGE_KEY = 'gt_device_fingerprint_v1';

declare global {
  interface Window {
    __gtFetchInterceptorInstalled?: boolean;
  }
}

/**
 * Codifica de forma determinista y segura una cadena hacia un hash hexadecimal + sufijo único.
 */
function encodeHardwareSeed(seed: string, uuid: string): string {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hashHex = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  const cleanUuid = uuid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return `gtdev_${hashHex}_${cleanUuid}`.slice(0, 128);
}

/**
 * Obtiene o crea el identificador único de dispositivo (`deviceId`) persistido en localStorage.
 * Utiliza userAgent, resolución de pantalla, núcleos de CPU y UUID criptográfico.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'srv_ssr_device_00000000';
  }

  try {
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing && existing.length >= 16 && existing.length <= 128) {
      document.cookie = `gt_device_id=${encodeURIComponent(existing)}; path=/; max-age=31536000; SameSite=Lax`;
      return existing;
    }

    const ua = window.navigator?.userAgent || 'unknown-ua';
    const screenRes = typeof window.screen !== 'undefined'
      ? `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth || 24}`
      : '0x0x24';
    const cpuCores = String(window.navigator?.hardwareConcurrency || 2);
    const tz = typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Caracas'
      : 'America/Caracas';
    const uuid = typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

    const rawSeed = `${ua}|${screenRes}|cores:${cpuCores}|tz:${tz}`;
    const deviceId = encodeHardwareSeed(rawSeed, uuid);

    window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
    // Sincronizar también en cookie accesible para peticiones de imagen/descarga si aplica
    document.cookie = `gt_device_id=${encodeURIComponent(deviceId)}; path=/; max-age=31536000; SameSite=Lax`;
    return deviceId;
  } catch {
    return `gtdev_fallback_${Date.now().toString(36)}`;
  }
}

/**
 * Instala un interceptor global sobre `window.fetch` para adjuntar automáticamente
 * el encabezado `x-device-id` en todas las llamadas a rutas API (`/api/...`).
 */
export function installGlobalDeviceFetchInterceptor(): void {
  if (typeof window === 'undefined' || window.__gtFetchInterceptorInstalled) {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.__gtFetchInterceptorInstalled = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const urlStr = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      const isSameOriginApi =
        urlStr.startsWith('/api/') ||
        urlStr.includes('/api/');

      if (isSameOriginApi) {
        const deviceId = getOrCreateDeviceId();
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        if (!headers.has('x-device-id')) {
          headers.set('x-device-id', deviceId);
        }
        return originalFetch(input, {
          ...init,
          headers,
        });
      }
    } catch {
      // Fallback seguro al fetch original si ocurre cualquier excepción preparando headers
    }

    return originalFetch(input, init);
  };
}

/**
 * Detecta el nombre amigable y la plataforma del equipo a partir del User-Agent.
 */
export function parseDevicePlatform(userAgent?: string | null): {
  type: 'mobile' | 'desktop';
  osLabel: string;
  browserLabel: string;
} {
  const ua = userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isMac = /Macintosh|Mac OS X/i.test(ua);
  const isLinux = /Linux/i.test(ua) && !isAndroid;
  const isWindows = /Windows/i.test(ua);

  const osLabel = isAndroid
    ? 'Mobile Android'
    : isIOS
      ? 'Mobile iOS'
      : isWindows
        ? 'Desktop Windows'
        : isMac
          ? 'Desktop macOS'
          : isLinux
            ? 'Desktop Linux'
            : 'Terminal Desconocida';

  const browserLabel = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : 'Browser';

  return {
    type: isAndroid || isIOS ? 'mobile' : 'desktop',
    osLabel,
    browserLabel,
  };
}

