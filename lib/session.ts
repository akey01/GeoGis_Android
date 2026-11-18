import { cookies } from 'next/headers';
import { verifySessionToken, type SessionPayload } from '@/lib/auth';
import db from '@/lib/db';

interface CachedUserStatus {
  email: string;
  role: string;
  activo: boolean;
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __geotransSessionCache: Map<string, CachedUserStatus> | undefined;
}

const SESSION_CACHE_TTL_MS = 3_000; // 3 segundos: elimina consultas triplicadas en ráfaga manteniendo desconexión rápida

function getSessionCache(): Map<string, CachedUserStatus> {
  if (!global.__geotransSessionCache) {
    global.__geotransSessionCache = new Map<string, CachedUserStatus>();
  }
  return global.__geotransSessionCache;
}

export function primeSessionCache(userId: string, email: string, role: string, activo: boolean) {
  getSessionCache().set(userId, {
    email,
    role,
    activo,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });
}

export function invalidateSessionCache(userId?: string) {
  const cache = getSessionCache();
  if (userId) {
    cache.delete(userId);
  } else {
    cache.clear();
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get('session')?.value;
  if (!session) return null;

  try {
    const payload = await verifySessionToken(session);
    const cache = getSessionCache();
    const now = Date.now();
    const cached = cache.get(payload.userId);

    if (cached && cached.expiresAt > now) {
      if (!cached.activo) {
        try {
          cookieStore.delete('session');
        } catch {}
        return null;
      }
      return {
        ...payload,
        email: cached.email || payload.email,
        role: cached.role || payload.role,
      };
    }

    const result = await db.query(
      'SELECT id, email, rol, activo FROM usuario WHERE id = $1 LIMIT 1',
      [payload.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].activo) {
      cache.set(payload.userId, {
        email: payload.email,
        role: payload.role,
        activo: false,
        expiresAt: now + SESSION_CACHE_TTL_MS,
      });
      try {
        cookieStore.delete('session');
      } catch {
        // En Server Components de solo lectura cookies().delete puede lanzar excepción; se ignora de forma segura
      }
      return null;
    }

    const row = result.rows[0];
    primeSessionCache(payload.userId, row.email || payload.email, row.rol || payload.role, true);

    return {
      ...payload,
      email: row.email || payload.email,
      role: row.rol || payload.role,
    };
  } catch (err) {
    return null;
  }
}
