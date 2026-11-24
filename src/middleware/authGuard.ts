import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import db from '@/lib/db';
import { getSession } from '@/lib/session';
import type { SessionPayload } from '@/lib/auth';
import {
  applyDynamicRoleConfig,
  getRoleConstraints,
  hasPermission,
  normalizeUserRole,
  ROLE_PERMISSIONS_MATRIX,
  type CanonicalUserRole,
  type DynamicRoleConfigPayload,
  type RoleCapability,
  type SessionAccessDenyReason,
  type ValidateSessionAccessResult,
} from '@/src/types/auth';
import { parseDevicePlatform } from '@/src/utils/device';

declare global {
  // eslint-disable-next-line no-var
  var __gtDeviceTablesInitialized: boolean | undefined;
  // eslint-disable-next-line no-var
  var __gtLoggedOutTokens: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __gtRoleConfigCache: { ts: number; map: Record<string, DynamicRoleConfigPayload> } | undefined;
}

const LOGGED_OUT_TOKEN_TTL_MS = 30_000;
const ROLE_CONFIG_CACHE_TTL_MS = 5_000;

function getLoggedOutTokensMap(): Map<string, number> {
  if (!global.__gtLoggedOutTokens) {
    global.__gtLoggedOutTokens = new Map<string, number>();
  }
  return global.__gtLoggedOutTokens;
}

export function markSessionTokenLoggedOut(token?: string | null): void {
  if (!token) return;
  const map = getLoggedOutTokensMap();
  map.set(token, Date.now() + LOGGED_OUT_TOKEN_TTL_MS);
}

export function isSessionTokenLoggedOut(token?: string | null): boolean {
  if (!token) return false;
  const map = getLoggedOutTokensMap();
  const exp = map.get(token);
  if (!exp) return false;
  if (exp > Date.now()) return true;
  map.delete(token);
  return false;
}

/**
 * Carga y sincroniza en memoria la configuración dinámica de permisos por rol desde PostgreSQL.
 */
export async function getDynamicRoleConfig(
  role?: string | null,
): Promise<DynamicRoleConfigPayload | null> {
  await ensureDeviceBindingTables();
  const now = Date.now();
  if (!global.__gtRoleConfigCache || now - global.__gtRoleConfigCache.ts > ROLE_CONFIG_CACHE_TTL_MS) {
    try {
      const res = await db.query(
        `SELECT role, label, max_vertices, max_allowed_devices, dxf_watermark, capabilities
         FROM public.role_permissions_config`,
      );
      const map: Record<string, DynamicRoleConfigPayload> = {};
      for (const row of res.rows) {
        const canonical = normalizeUserRole(row.role);
        const rawCaps =
          row.capabilities && typeof row.capabilities === 'object' ? { ...row.capabilities } : {};
        const resolvedWatermark =
          typeof rawCaps.dxf_watermark === 'boolean'
            ? rawCaps.dxf_watermark
            : Boolean(row.dxf_watermark);
        rawCaps.dxf_watermark = resolvedWatermark;

        const cfg: DynamicRoleConfigPayload = {
          role: canonical,
          label: row.label,
          maxVerticesPerCalculation:
            row.max_vertices === null || row.max_vertices === undefined || Number(row.max_vertices) <= 0
              ? null
              : Number(row.max_vertices),
          maxAllowedDevices: canonical === 'admin' ? 10 : 1,
          dxfWatermark: resolvedWatermark,
          dxfWatermarkRequired: resolvedWatermark,
          capabilities: rawCaps,
        };
        map[canonical] = cfg;
        applyDynamicRoleConfig(canonical, cfg);
      }
      global.__gtRoleConfigCache = { ts: now, map };
    } catch (err) {
      console.warn('[authGuard] Warning loading role_permissions_config:', err);
    }
  }

  if (!role) return null;
  const canonical = normalizeUserRole(role);
  return global.__gtRoleConfigCache?.map?.[canonical] || null;
}

/**
 * Garantiza que las tablas user_authorized_devices, user_access_logs y role_permissions_config existan
 * en la base de datos PostgreSQL activa y normaliza los 4 perfiles de usuario.
 */
export async function ensureDeviceBindingTables(): Promise<void> {
  if (global.__gtDeviceTablesInitialized) return;

  try {
    await db.query(`
      ALTER TABLE IF EXISTS public.usuario
        ADD COLUMN IF NOT EXISTS max_allowed_devices INT NOT NULL DEFAULT 1;

      UPDATE public.usuario SET rol = 'operador_campo' WHERE rol = 'junior';
      UPDATE public.usuario SET rol = 'revisor_catastral' WHERE rol = 'senior';
      UPDATE public.usuario SET rol = 'demo' WHERE rol = 'viewer';

      UPDATE public.usuario
      SET max_allowed_devices = CASE WHEN rol = 'admin' THEN 10 ELSE 1 END
      WHERE max_allowed_devices IS NULL
         OR (rol = 'admin' AND max_allowed_devices < 10)
         OR (rol <> 'admin' AND max_allowed_devices <> 1);

      CREATE TABLE IF NOT EXISTS public.user_authorized_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        device_id VARCHAR(128) NOT NULL,
        device_name VARCHAR(100),
        first_seen_ip INET NOT NULL,
        last_seen_ip INET NOT NULL,
        user_agent TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        revoked_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_authorized_devices_user_device UNIQUE (user_id, device_id)
      );

      ALTER TABLE IF EXISTS public.user_authorized_devices
        ADD COLUMN IF NOT EXISTS revoked_by_admin BOOLEAN NOT NULL DEFAULT FALSE;

      CREATE INDEX IF NOT EXISTS idx_user_authorized_devices_user_id
        ON public.user_authorized_devices(user_id, last_active_at DESC);

      CREATE TABLE IF NOT EXISTS public.user_access_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        device_id VARCHAR(128) NOT NULL,
        ip_address INET NOT NULL,
        endpoint TEXT NOT NULL DEFAULT '/api',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_user_access_logs_user_window
        ON public.user_access_logs(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS public.role_permissions_config (
        role VARCHAR(32) PRIMARY KEY,
        label VARCHAR(80) NOT NULL,
        max_vertices INT,
        max_allowed_devices INT NOT NULL DEFAULT 1,
        dxf_watermark BOOLEAN NOT NULL DEFAULT FALSE,
        capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE public.user_authorized_devices ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.user_access_logs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.role_permissions_config ENABLE ROW LEVEL SECURITY;

      DO $$
      DECLARE
        t TEXT;
        pol TEXT;
      BEGIN
        FOREACH t IN ARRAY ARRAY['user_authorized_devices', 'user_access_logs', 'role_permissions_config'] LOOP
          EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
          EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
          pol := 'service_role_full_access_' || t;
          EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
          EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', pol, t);
        END LOOP;
      EXCEPTION WHEN undefined_object THEN
        NULL;
      END $$;
    `);

    const rolesToSeed: CanonicalUserRole[] = ['demo', 'operador_campo', 'revisor_catastral', 'admin'];
    for (const r of rolesToSeed) {
      const def = ROLE_PERMISSIONS_MATRIX[r];
      await db.query(
        `INSERT INTO public.role_permissions_config (role, label, max_vertices, max_allowed_devices, dxf_watermark, capabilities)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (role) DO NOTHING`,
        [
          r,
          def.label,
          def.maxVerticesPerCalculation,
          r === 'admin' ? 10 : 1,
          def.dxfWatermarkRequired,
          JSON.stringify({ ...def.capabilities, dxf_watermark: def.dxfWatermarkRequired }),
        ],
      );
    }

    global.__gtDeviceTablesInitialized = true;
  } catch (err) {
    console.warn('[authGuard] Warning ensuring device binding tables:', err);
  }
}

/**
 * Extrae y normaliza la IP pública del cliente soportando proxies/CGNAT (Digitel, Movistar, CANTV, Render, Cloudflare).
 */
export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0]?.trim();
    if (firstIp) return sanitizeInet(firstIp);
  }

  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return sanitizeInet(cfIp.trim());

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return sanitizeInet(realIp.trim());

  const reqAny = request as any;
  if (typeof reqAny.ip === 'string' && reqAny.ip.trim()) {
    return sanitizeInet(reqAny.ip.trim());
  }

  return '127.0.0.1';
}

function sanitizeInet(rawIp: string): string {
  const cleaned = rawIp.replace(/^::ffff:/i, '').trim();
  // Validar formato básico IPv4 o IPv6 para evitar errores de casteo a tipo INET en PostgreSQL
  const ipv4Regex = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^[0-9a-fA-F:]+$/;
  if (ipv4Regex.test(cleaned) || ipv6Regex.test(cleaned)) {
    return cleaned;
  }
  return '127.0.0.1';
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Libera automáticamente sesiones de dispositivos que dejaron de enviar heartbeat (> 15s sin actividad)
 * y que NO fueron revocados manualmente por un administrador.
 */
export async function expireStaleDeviceSessions(userId?: string): Promise<void> {
  await ensureDeviceBindingTables();
  try {
    if (userId) {
      await db.query(
        `WITH expired AS (
           UPDATE public.user_authorized_devices
           SET is_active = FALSE
           WHERE user_id = $1::text
             AND is_active = TRUE
             AND COALESCE(revoked_by_admin, FALSE) = FALSE
             AND last_active_at < (NOW() - INTERVAL '15 seconds')
           RETURNING user_id, device_id
         )
         DELETE FROM public.user_access_logs l
         USING expired e
         WHERE l.user_id = e.user_id AND l.device_id = e.device_id`,
        [userId],
      );
    } else {
      await db.query(
        `WITH expired AS (
           UPDATE public.user_authorized_devices
           SET is_active = FALSE
           WHERE is_active = TRUE
             AND COALESCE(revoked_by_admin, FALSE) = FALSE
             AND last_active_at < (NOW() - INTERVAL '15 seconds')
           RETURNING user_id, device_id
         )
         DELETE FROM public.user_access_logs l
         USING expired e
         WHERE l.user_id = e.user_id AND l.device_id = e.device_id`,
      );
    }
  } catch (err) {
    console.warn('[authGuard] Warning expiring stale device sessions:', err);
  }
}

/**
 * Desconecta explícitamente un dispositivo al cerrar sesión o cerrar pestaña,
 * liberando inmediatamente el cupo de dispositivo y limpiando su ventana de IP reciente.
 */
export async function releaseUserDeviceSession(params: {
  userId?: string | null;
  deviceId?: string | null;
  releaseAllForUser?: boolean;
}): Promise<void> {
  const { userId, deviceId, releaseAllForUser = false } = params;
  if (!userId && !deviceId) return;

  await ensureDeviceBindingTables();
  try {
    if (userId && (releaseAllForUser || !deviceId)) {
      await db.query(
        `UPDATE public.user_authorized_devices
         SET is_active = FALSE,
             last_active_at = NOW() - INTERVAL '1 hour'
         WHERE user_id = $1::text
           AND COALESCE(revoked_by_admin, FALSE) = FALSE`,
        [String(userId)],
      );
      await db.query(
        `DELETE FROM public.user_access_logs
         WHERE user_id = $1::text`,
        [String(userId)],
      );
    } else if (userId && deviceId) {
      await db.query(
        `UPDATE public.user_authorized_devices
         SET is_active = FALSE,
             last_active_at = NOW() - INTERVAL '1 hour'
         WHERE user_id = $1::text
           AND device_id = $2
           AND COALESCE(revoked_by_admin, FALSE) = FALSE`,
        [String(userId), String(deviceId)],
      );
      await db.query(
        `DELETE FROM public.user_access_logs
         WHERE user_id = $1::text AND device_id = $2`,
        [String(userId), String(deviceId)],
      );
    } else if (deviceId) {
      await db.query(
        `UPDATE public.user_authorized_devices
         SET is_active = FALSE,
             last_active_at = NOW() - INTERVAL '1 hour'
         WHERE device_id = $1
           AND COALESCE(revoked_by_admin, FALSE) = FALSE`,
        [String(deviceId)],
      );
      await db.query(
        `DELETE FROM public.user_access_logs
         WHERE device_id = $1`,
        [String(deviceId)],
      );
    }
  } catch (err) {
    console.warn('[authGuard] Error releasing device session on logout:', err);
  }
}

/**
 * Ejecuta la validación de acceso de sesión y Device Binding:
 * 1) Intenta vía RPC de Supabase (`validate_user_session_access`) si el entorno y UUID están configurados.
 * 2) Ejecuta la transacción PostgreSQL equivalente sobre `user_authorized_devices` y `user_access_logs`.
 */
export async function validateUserSessionAccess(params: {
  userId: string;
  userRole?: string;
  deviceId: string;
  clientIp: string;
  userAgent: string;
  endpoint?: string;
  allowReactivate?: boolean;
}): Promise<ValidateSessionAccessResult> {
  const {
    userId,
    userRole,
    deviceId,
    clientIp: rawClientIp,
    userAgent,
    endpoint = '/api',
  } = params;
  const clientIp = sanitizeInet(rawClientIp || '127.0.0.1');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (supabaseUrl && supabaseKey && UUID_REGEX.test(userId)) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      });
      const { data, error } = await supabase.rpc('validate_user_session_access', {
        p_user_id: userId,
        p_device_id: deviceId,
        p_client_ip: clientIp,
        p_user_agent: userAgent,
        p_endpoint: endpoint,
      });

      if (!error && data && typeof data.allowed === 'boolean') {
        return data as ValidateSessionAccessResult;
      }
    } catch {
      // Fallback directo al pool PostgreSQL si la RPC no está desplegada en instancia externa
    }
  }

  await ensureDeviceBindingTables();

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Consultar usuario en tabla usuario
    const userRes = await client.query(
      'SELECT id, rol, activo, COALESCE(max_allowed_devices, 1) AS max_allowed_devices FROM public.usuario WHERE id = $1 LIMIT 1',
      [userId],
    );

    let canonicalRole: CanonicalUserRole = normalizeUserRole(userRole);
    let maxAllowedDevices = canonicalRole === 'admin' ? 10 : 1;

    if (userRes.rows.length > 0) {
      const u = userRes.rows[0];
      if (!u.activo) {
        await client.query('ROLLBACK');
        return { allowed: false, reason: 'ACCOUNT_SUSPENDED' };
      }
      canonicalRole = normalizeUserRole(u.rol);
      // Regla estricta: 1 solo equipo para cualquier rol, salvo Admin (10 equipos para pruebas)
      maxAllowedDevices = canonicalRole === 'admin' ? 10 : 1;
    }

    const platform = parseDevicePlatform(userAgent);
    const deviceName = `${platform.osLabel} (${platform.browserLabel})`;

    // 0) Liberar automáticamente terminales inactivos (> 15s sin heartbeat)
    await client.query(
      `WITH expired AS (
         UPDATE public.user_authorized_devices
         SET is_active = FALSE
         WHERE user_id = $1::text
           AND device_id <> $2
           AND is_active = TRUE
           AND COALESCE(revoked_by_admin, FALSE) = FALSE
           AND last_active_at < (NOW() - INTERVAL '15 seconds')
         RETURNING user_id, device_id
       )
       DELETE FROM public.user_access_logs l
       USING expired e
       WHERE l.user_id = e.user_id AND l.device_id = e.device_id`,
      [userId, deviceId],
    );

    // 0.1) Si el usuario está iniciando sesión explícitamente con sus credenciales (/login):
    //      - Para roles no-admin (1 solo equipo): cerramos automáticamente cualquier sesión previa colgada
    //        (ej. pestaña cerrada en móvil sin sendBeacon) para que NUNCA quede bloqueado al entrar en el
    //        mismo dispositivo o al cambiarse a otro equipo; si el equipo anterior seguía abierto, su próximo
    //        heartbeat (/api/auth/me) lo desconectará de inmediato por límite de 1 equipo.
    //      - Para rol admin (10 equipos): si ya alcanzó los 10 equipos activos, libera el más antiguo.
    if (endpoint === '/login') {
      if (canonicalRole !== 'admin') {
        await client.query(
          `UPDATE public.user_authorized_devices
           SET is_active = FALSE
           WHERE user_id = $1::text
             AND device_id <> $2
             AND is_active = TRUE
             AND COALESCE(revoked_by_admin, FALSE) = FALSE`,
          [userId, deviceId],
        );
        await client.query(
          `DELETE FROM public.user_access_logs
           WHERE user_id = $1::text AND device_id <> $2`,
          [userId, deviceId],
        );
      } else {
        await client.query(
          `UPDATE public.user_authorized_devices
           SET is_active = FALSE
           WHERE id IN (
             SELECT id FROM public.user_authorized_devices
             WHERE user_id = $1::text
               AND device_id <> $2
               AND is_active = TRUE
               AND COALESCE(revoked_by_admin, FALSE) = FALSE
             ORDER BY last_active_at DESC
             OFFSET $3
           )`,
          [userId, deviceId, Math.max(0, maxAllowedDevices - 1)],
        );
      }
    }

    // a) Verificar si el dispositivo ya está registrado para este usuario
    const existingRes = await client.query(
      `SELECT id, is_active, COALESCE(revoked_by_admin, FALSE) AS revoked_by_admin
       FROM public.user_authorized_devices
       WHERE user_id = $1::text AND device_id = $2
       FOR UPDATE`,
      [userId, deviceId],
    );

    if (existingRes.rows.length > 0) {
      const dev = existingRes.rows[0];
      if (dev.is_active) {
        await client.query(
          `UPDATE public.user_authorized_devices
           SET last_seen_ip = $1::inet,
               last_active_at = NOW(),
               user_agent = COALESCE($2, user_agent),
               device_name = COALESCE(device_name, $3)
           WHERE id = $4`,
          [clientIp, userAgent, deviceName, dev.id],
        );
      } else {
        if (dev.revoked_by_admin) {
          await client.query('ROLLBACK');
          return {
            allowed: false,
            reason: 'DEVICE_REVOKED',
            max_allowed_devices: maxAllowedDevices,
          };
        }

        // Dispositivo inactivo: verificar si hay OTRO dispositivo activo ocupando el cupo
        const countRes = await client.query<{ cnt: number }>(
          `SELECT COUNT(*)::int AS cnt
           FROM public.user_authorized_devices
           WHERE user_id = $1::text
             AND device_id <> $2
             AND is_active = TRUE`,
          [userId, deviceId],
        );
        const activeCount = countRes.rows[0]?.cnt ?? 0;

        if (activeCount >= maxAllowedDevices) {
          await client.query('ROLLBACK');
          return {
            allowed: false,
            reason: 'DEVICE_LIMIT_EXCEEDED',
            max_allowed_devices: maxAllowedDevices,
            active_devices: activeCount,
          };
        }

        await client.query(
          `UPDATE public.user_authorized_devices
           SET is_active = TRUE,
               last_seen_ip = $1::inet,
               last_active_at = NOW(),
               user_agent = COALESCE($2, user_agent),
               device_name = COALESCE(device_name, $3)
           WHERE id = $4`,
          [clientIp, userAgent, deviceName, dev.id],
        );
      }
    } else {
      // b) Dispositivo nuevo: verificar límite de dispositivos activos
      const countRes = await client.query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt
         FROM public.user_authorized_devices
         WHERE user_id = $1::text AND is_active = TRUE`,
        [userId],
      );
      const activeCount = countRes.rows[0]?.cnt ?? 0;

      if (activeCount >= maxAllowedDevices) {
        await client.query('ROLLBACK');
        return {
          allowed: false,
          reason: 'DEVICE_LIMIT_EXCEEDED',
          max_allowed_devices: maxAllowedDevices,
          active_devices: activeCount,
        };
      }

      await client.query(
        `INSERT INTO public.user_authorized_devices (
          user_id, device_id, device_name, first_seen_ip, last_seen_ip, user_agent, is_active, created_at, last_active_at
        ) VALUES ($1::text, $2, $3, $4::inet, $4::inet, $5, TRUE, NOW(), NOW())`,
        [userId, deviceId, deviceName, clientIp, userAgent],
      );
    }

    // c) Detectar concurrencia imposible (> 2 IPs públicas distintas en los últimos 5 minutos
    //    SOLO entre dispositivos que siguen actualmente conectados/activos)
    const ipWindowRes = await client.query<{ distinct_ips: number }>(
      `SELECT COUNT(DISTINCT host(ip_address))::int AS distinct_ips
       FROM (
         SELECT l.ip_address
         FROM public.user_access_logs l
         INNER JOIN public.user_authorized_devices d
           ON d.user_id = l.user_id AND d.device_id = l.device_id
         WHERE l.user_id = $1::text
           AND d.is_active = TRUE
           AND l.created_at >= (NOW() - INTERVAL '5 minutes')
         UNION ALL
         SELECT $2::inet AS ip_address
       ) AS recent_window`,
      [userId, clientIp],
    );

    const distinctIps = ipWindowRes.rows[0]?.distinct_ips ?? 1;
    if (distinctIps > 2 && canonicalRole !== 'admin') {
      await client.query('ROLLBACK');
      return {
        allowed: false,
        reason: 'CONCURRENT_IP_ABUSE',
        distinct_ips_5m: distinctIps,
      };
    }

    // d) Insertar registro de acceso en user_access_logs
    await client.query(
      `INSERT INTO public.user_access_logs (user_id, device_id, ip_address, endpoint, created_at)
       VALUES ($1::text, $2, $3::inet, $4, NOW())`,
      [userId, deviceId, clientIp, endpoint],
    );

    await client.query('COMMIT');
    return {
      allowed: true,
      role: canonicalRole,
      max_allowed_devices: maxAllowedDevices,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[authGuard] Error validating device session access:', err);
    return { allowed: false, reason: 'SERVICE_UNAVAILABLE' };
  } finally {
    client.release();
  }
}

function getDenyMessage(reason?: SessionAccessDenyReason, maxDevices?: number): string {
  switch (reason) {
    case 'DEVICE_LIMIT_EXCEEDED':
      return `Límite de dispositivos autorizados alcanzado (${maxDevices || 1} máx.). Se ha conectado desde otro equipo o debe cerrar la sesión previa.`;
    case 'CONCURRENT_IP_ABUSE':
      return 'Se detectó uso concurrente de credenciales desde múltiples redes/IPs simultáneas (más de 2 IPs en 5 minutos). Acceso bloqueado por seguridad.';
    case 'DEVICE_REVOKED':
      return 'Este dispositivo ha sido revocado por el administrador del sistema.';
    case 'ACCOUNT_SUSPENDED':
      return 'Su cuenta se encuentra suspendida por el administrador.';
    case 'SERVICE_UNAVAILABLE':
      return 'No se pudo verificar la seguridad de la sesión en base de datos. Intenta nuevamente.';
    default:
      return 'Acceso denegado por política de seguridad de dispositivos.';
  }
}

export type GuardResult =
  | {
      ok: true;
      session: SessionPayload;
      canonicalRole: CanonicalUserRole;
      deviceId: string;
      clientIp: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

/**
 * Guard principal de Autenticación, RBAC y Device Binding para rutas API de Next.js.
 */
export async function enforceAuthAndDeviceGuard(
  request: Request,
  options?: {
    requiredCapability?: RoleCapability;
    requireAdmin?: boolean;
    endpoint?: string;
  },
): Promise<GuardResult> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No autenticado o sesión expirada', code: 'UNAUTHORIZED' },
        { status: 401 },
      ),
    };
  }

  const canonicalRole = normalizeUserRole(session.role);
  await getDynamicRoleConfig(canonicalRole);

  if (options?.requireAdmin && canonicalRole !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Se requieren privilegios de administrador', code: 'FORBIDDEN_ADMIN_ONLY' },
        { status: 403 },
      ),
    };
  }

  if (options?.requiredCapability && !hasPermission(canonicalRole, options.requiredCapability)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Operación bloqueada para el perfil "${getRoleConstraints(canonicalRole).label}" (${options.requiredCapability}).`,
          code: 'ROLE_CAPABILITY_RESTRICTED',
          role: canonicalRole,
        },
        { status: 403 },
      ),
    };
  }

  const deviceId = request.headers.get('x-device-id')?.trim() || '';
  if (!deviceId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Falta el encabezado obligatorio de identificación de dispositivo (x-device-id).',
          code: 'MISSING_DEVICE_ID',
        },
        { status: 400 },
      ),
    };
  }

  const clientIp = extractClientIp(request);
  const userAgent = request.headers.get('user-agent') || 'unknown';
  const pathname = options?.endpoint || new URL(request.url).pathname;

  const accessCheck = await validateUserSessionAccess({
    userId: session.userId,
    userRole: session.role,
    deviceId,
    clientIp,
    userAgent,
    endpoint: pathname,
  });

  if (!accessCheck.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: getDenyMessage(accessCheck.reason, accessCheck.max_allowed_devices),
          reason: accessCheck.reason,
          max_allowed_devices: accessCheck.max_allowed_devices,
          active_devices: accessCheck.active_devices,
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    session,
    canonicalRole,
    deviceId,
    clientIp,
  };
}

