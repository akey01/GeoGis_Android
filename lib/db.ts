// lib/db.ts – PostgreSQL pool (Singleton) for Next.js serverless / dev HMR
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import dns from 'dns';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

declare global {
  // eslint-disable-next-line no-var
  var __geotransPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __geotransDbInitPromise: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __geotransSchemaVerified: boolean | undefined;
}

const isPostgres = !!process.env.DATABASE_URL;

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  const poolUrl = process.env.DATABASE_URL;
  const isPgBouncer = poolUrl.includes('pgbouncer=true');
  const isRenderCloud = Boolean(process.env.RENDER || process.env.NODE_ENV === 'production');

  const pool = new Pool({
    connectionString: poolUrl,
    ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: isRenderCloud && isPgBouncer
      ? Math.min(parseEnvInt('PG_POOL_MAX', 5), 5)
      : parseEnvInt('PG_POOL_MAX', isRenderCloud ? 5 : 20),
    idleTimeoutMillis: parseEnvInt('PG_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: parseEnvInt('PG_CONNECTION_TIMEOUT_MS', 8_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client', err);
  });

  return pool;
}

/** Singleton pool – survives Next.js dev HMR and serverless warm starts. */
export function getPool(): Pool | null {
  if (!isPostgres) {
    return null;
  }

  if (!global.__geotransPgPool) {
    global.__geotransPgPool = createPool();
    console.log(
      `[DB] Pool created (max=${parseEnvInt('PG_POOL_MAX', 20)}, idle=${parseEnvInt('PG_IDLE_TIMEOUT_MS', 30_000)}ms)`,
    );
  }

  return global.__geotransPgPool;
}

/**
 * Inicialización bajo demanda en un solo bloque SQL sin ALTER TABLE bloqueantes.
 * Solo se ejecuta si una tabla aún no existe (código 42P01) o si FORCE_DB_INIT=true.
 */
function ensureInit(force = false): Promise<void> {
  if (!force && global.__geotransSchemaVerified) {
    return Promise.resolve();
  }
  if (global.__geotransDbInitPromise) {
    return global.__geotransDbInitPromise;
  }

  if (!isPostgres) {
    global.__geotransSchemaVerified = true;
    return Promise.resolve();
  }

  // En arranque normal asumir esquema existente para evitar 6 viajes DDL en el login;
  // si faltara alguna tabla en un entorno nuevo, queryWithRetry invoca ensureInit(true).
  if (!force && process.env.FORCE_DB_INIT !== 'true') {
    global.__geotransSchemaVerified = true;
    return Promise.resolve();
  }

  global.__geotransDbInitPromise = (async () => {
    const pool = getPool()!;
    const client = await pool.connect();

    try {
      console.log('[DB] Verifying schema (single batch)...');

      await client.query(`
        CREATE TABLE IF NOT EXISTS usuario (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          nombre TEXT NOT NULL,
          email TEXT UNIQUE,
          rol TEXT NOT NULL DEFAULT 'junior',
          activo BOOLEAN DEFAULT TRUE,
          creado TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ultimo_acceso TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS proyecto (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          usuario_id TEXT NOT NULL,
          content JSONB NOT NULL,
          creado TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actualizado TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT proyecto_nombre_usuario_unique UNIQUE (nombre, usuario_id),
          FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS actividad (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          tipo TEXT NOT NULL,
          descripcion TEXT NOT NULL,
          usuario_id TEXT NOT NULL,
          ip TEXT,
          FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS usuario_email_unique_idx
        ON usuario(email)
        WHERE email IS NOT NULL;
      `);

      global.__geotransSchemaVerified = true;
      console.log('[DB] PostgreSQL schema verified.');
    } catch (err) {
      global.__geotransDbInitPromise = undefined;
      throw err;
    } finally {
      client.release();
    }
  })();

  return global.__geotransDbInitPromise;
}

const RETRYABLE_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', '57P01'];

async function queryWithRetry<T extends QueryResultRow>(
  pool: Pool,
  text: string,
  params: unknown[],
  retries = 2,
): Promise<{ rows: T[]; rowCount?: number }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await pool.query<T>(text, params);
      return { rows: result.rows, rowCount: result.rowCount ?? undefined };
    } catch (err: any) {
      // Si la tabla no existe en una BD recién creada, inicializar esquema una vez y reintentar
      if (err?.code === '42P01' && attempt === 0) {
        await ensureInit(true);
        continue;
      }
      if (attempt < retries && RETRYABLE_CODES.includes(err.code)) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 100));
        continue;
      }
      throw err;
    }
  }
}

const db = {
  query: async <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount?: number }> => {
    const pool = getPool();
    if (!pool) throw new Error('DATABASE_URL no configurada');
    return queryWithRetry<T>(pool, text, params);
  },

  /** Acquire a dedicated client – always release in a finally block. */
  connect: async (): Promise<PoolClient> => {
    const pool = getPool();
    if (!pool) throw new Error('DATABASE_URL no configurada');
    return pool.connect();
  },
};

export default db;

export async function dbGet<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const res = await db.query<T>(text, params);
  return res.rows[0];
}
