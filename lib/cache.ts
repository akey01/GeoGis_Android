// lib/cache.ts – Cache-Aside helpers for Redis
import { createHash } from 'crypto';
import { ensureRedisConnected } from '@/lib/redis';

export const CACHE_TTL = {
  TRANSFORM_SECONDS: 86_400, // 24 h
  PROJECT_SECONDS: 3_600, // 1 h
} as const;

const CACHE_VERSION = 'v1';

export const CACHE_KEYS = {
  transform: (hash: string) => `${CACHE_VERSION}:transform:${hash}`,
  project: (projectId: string) => `${CACHE_VERSION}:project:${projectId}`,
  projectContent: (projectId: string) => `${CACHE_VERSION}:project:${projectId}:content`,
} as const;

export interface TransformCacheInput {
  direction: 'canoa_regven' | 'regven_canoa';
  method: 'badekas' | 'rigida';
  source_crs?: string;
  target_crs?: string;
  points: Array<{ x: number; y: number; [key: string]: unknown }>;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

export function buildTransformCacheKey(input: TransformCacheInput): string {
  const defaultSource = input.direction === 'regven_canoa' ? 'EPSG:2202' : 'EPSG:24879';
  const defaultTarget = input.direction === 'regven_canoa' ? 'EPSG:24879' : 'EPSG:2202';
  const normalized = {
    direction: input.direction,
    method: input.method,
    source_crs: input.source_crs ?? defaultSource,
    target_crs: input.target_crs ?? defaultTarget,
    points: [...input.points]
      .map((p) => ({ x: p.x, y: p.y }))
      .sort((a, b) => a.x > b.x ? 1 : a.x < b.x ? -1 : a.y > b.y ? 1 : a.y < b.y ? -1 : 0),
  };

  const hash = createHash('sha256').update(stableSerialize(normalized)).digest('hex');
  return CACHE_KEYS.transform(hash);
}

// Caché L1 en memoria (ultrarrápido, seguro para 512 MB, máx 100 elementos)
interface L1CacheEntry {
  value: any;
  expiresAt: number;
}
const MAX_L1_ENTRIES = 100;
const l1Cache = new Map<string, L1CacheEntry>();

function setL1<T>(key: string, value: T, ttlSeconds: number): void {
  if (l1Cache.size >= MAX_L1_ENTRIES) {
    // Purga simple del primer elemento ingresado (FIFO)
    const oldestKey = l1Cache.keys().next().value;
    if (oldestKey) l1Cache.delete(oldestKey);
  }
  l1Cache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function getL1<T>(key: string): T | null {
  const entry = l1Cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    l1Cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  // 1. Verificar L1 en memoria (0 ms, sin red)
  const l1Hit = getL1<T>(key);
  if (l1Hit !== null) return l1Hit;

  // 2. Si no está en L1, consultar Redis (L2)
  const redis = await ensureRedisConnected();
  if (!redis) return null;

  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    // Guardar en L1 para la próxima consulta
    setL1(key, parsed, 300); // 5 min en memoria local
    return parsed;
  } catch (err) {
    console.error('[Cache] GET failed', key, err);
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  // Guardar siempre en L1 local
  setL1(key, value, Math.min(ttlSeconds, 3600));

  // Guardar en Redis L2 si está disponible
  const redis = await ensureRedisConnected();
  if (!redis) return;

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    console.error('[Cache] SET failed', key, err);
  }
}

export async function invalidateProjectCache(projectId: string): Promise<void> {
  const keys = [
    CACHE_KEYS.project(projectId),
    CACHE_KEYS.projectContent(projectId),
  ];

  // Invalidar en L1
  for (const k of keys) {
    l1Cache.delete(k);
  }

  // Invalidar en Redis
  const redis = await ensureRedisConnected();
  if (!redis) return;

  try {
    await redis.del(...keys);
  } catch (err) {
    console.error('[Cache] Project invalidation failed', projectId, err);
  }
}
