// lib/redis.ts – Singleton Redis client (ioredis)
import Redis from 'ioredis';

declare global {
  // eslint-disable-next-line no-var
  var __geotransRedis: Redis | undefined;
}

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not configured');
  }

  return new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 5) return null; // stop retrying after 5 attempts
      return Math.min(times * 200, 2000); // 200ms, 400ms, 800ms, 1600ms, 2000ms
    },
  });
}

/** Singleton Redis client – safe across dev HMR and serverless warm starts. */
export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (!global.__geotransRedis) {
    global.__geotransRedis = createRedisClient();
    global.__geotransRedis.on('error', (err) => {
      console.error('[Redis] Connection error', err);
    });
    global.__geotransRedis.on('connect', () => {
      console.log('[Redis] Connected');
    });
    global.__geotransRedis.on('reconnecting', (delay: number) => {
      console.log(`[Redis] Reconnecting in ${delay}ms`);
    });
  }

  return global.__geotransRedis;
}

export async function ensureRedisConnected(): Promise<Redis | null> {
  const redis = getRedis();
  if (!redis) return null;

  if (redis.status === 'wait') {
    await redis.connect();
  }

  try {
    await redis.ping();
  } catch (err) {
    console.error('[Redis] Health check (PING) failed', err);
    return null;
  }

  return redis;
}
