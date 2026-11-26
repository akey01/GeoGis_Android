import {
  DESKTOP_FALLBACK_API_URL,
  PROD_API_URL,
} from '@/components/geogis6-mobile/data/fieldData';

export const PRIMARY_API_URL = PROD_API_URL.replace(/\/+$/, '');
export const FALLBACK_API_URL = DESKTOP_FALLBACK_API_URL.replace(/\/+$/, '');

let lastHealthyBaseUrl: string | null = null;

export function getCandidateApiUrls(): string[] {
  const baseList = [PRIMARY_API_URL, FALLBACK_API_URL].filter(Boolean);
  const deduped: string[] = [];
  for (const url of baseList) {
    const clean = url.replace(/\/+$/, '');
    if (clean && !deduped.includes(clean)) {
      deduped.push(clean);
    }
  }
  if (lastHealthyBaseUrl && deduped.includes(lastHealthyBaseUrl)) {
    return [
      lastHealthyBaseUrl,
      ...deduped.filter((u) => u !== lastHealthyBaseUrl),
    ];
  }
  return deduped;
}

export interface MobileApiFetchOptions {
  timeoutMs?: number;
  onStatus?: (msg: string) => void;
}

export async function mobileApiFetch(
  path: string,
  init: RequestInit = {},
  options: MobileApiFetchOptions = {},
): Promise<{ response: Response; baseUrl: string }> {
  const { timeoutMs = 18000, onStatus } = options;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const candidates = getCandidateApiUrls();
  let lastError: unknown = null;
  let lastResponse: { response: Response; baseUrl: string } | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const baseUrl = candidates[i];
    if (i > 0) {
      onStatus?.('Conectando con servidor de respaldo...');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${normalizedPath}`, {
        ...init,
        signal: init.signal ?? controller.signal,
      });

      let hasDbDisconnection = false;
      if (response.status >= 500) {
        hasDbDisconnection = true;
      } else {
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const clone = response.clone();
          const body = await clone.json().catch(() => null);
          if (
            body &&
            typeof body === 'object' &&
            (body.database === 'disconnected' ||
              (typeof body.dbError === 'string' && body.dbError.length > 0))
          ) {
            hasDbDisconnection = true;
          }
        }
      }

      if (hasDbDisconnection && i < candidates.length - 1) {
        lastResponse = { response, baseUrl };
        continue;
      }

      if (response.ok) {
        lastHealthyBaseUrl = baseUrl;
      }
      return { response, baseUrl };
    } catch (err) {
      lastError = err;
      if (i === candidates.length - 1 && !lastResponse) {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('No se pudo conectar con los servidores de GeoGIS6');
}

export interface BackendHealthStatus {
  navigatorOnline: boolean;
  serverReachable: boolean;
  dbConnected: boolean;
  activeBaseUrl: string | null;
  dbError: string | null;
}

export async function checkBackendHealth(
  timeoutMs = 6000,
): Promise<BackendHealthStatus> {
  const navigatorOnline =
    typeof navigator === 'undefined' ? true : navigator.onLine !== false;

  if (!navigatorOnline) {
    return {
      navigatorOnline: false,
      serverReachable: false,
      dbConnected: false,
      activeBaseUrl: null,
      dbError: 'Sin conexión a internet en el dispositivo',
    };
  }

  try {
    const { response, baseUrl } = await mobileApiFetch(
      `/api/health?t=${Date.now()}`,
      { cache: 'no-store' },
      { timeoutMs },
    );
    const data = await response.json().catch(() => null);
    if (response.ok && data && data.database === 'connected') {
      lastHealthyBaseUrl = baseUrl;
      return {
        navigatorOnline: true,
        serverReachable: true,
        dbConnected: true,
        activeBaseUrl: baseUrl,
        dbError: null,
      };
    }
    return {
      navigatorOnline: true,
      serverReachable: response.ok,
      dbConnected: false,
      activeBaseUrl: baseUrl,
      dbError:
        (data && typeof data.dbError === 'string' && data.dbError) ||
        `Base de datos no disponible (HTTP ${response.status})`,
    };
  } catch (err: any) {
    return {
      navigatorOnline,
      serverReachable: false,
      dbConnected: false,
      activeBaseUrl: null,
      dbError: err?.message || 'Servidor no accesible',
    };
  }
}
