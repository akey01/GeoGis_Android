import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import db from '@/lib/db';
import { verifySessionToken } from '@/lib/auth';
import { primeSessionCache, invalidateSessionCache } from '@/lib/session';
import {
  extractClientIp,
  getDynamicRoleConfig,
  isSessionTokenLoggedOut,
  validateUserSessionAccess,
} from '@/src/middleware/authGuard';
import { getRoleConstraints, normalizeUserRole } from '@/src/types/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session')?.value;

  if (!sessionToken || isSessionTokenLoggedOut(sessionToken)) {
    const res = NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    if (sessionToken) res.cookies.delete('session');
    return res;
  }

  let payload;
  try {
    payload = await verifySessionToken(sessionToken);
  } catch {
    const res = NextResponse.json({ success: false, error: 'Sesión expirada o inválida' }, { status: 401 });
    res.cookies.delete('session');
    return res;
  }

  const { searchParams } = new URL(request.url);
  const includeProjects = searchParams.get('includeProjects') === '1';
  const cookieDeviceId = cookieStore.get('gt_device_id')?.value
    ? decodeURIComponent(cookieStore.get('gt_device_id')!.value).trim()
    : '';
  const deviceId = request.headers.get('x-device-id')?.trim() || cookieDeviceId;

  try {
    const [userResult, projectsResult] = await Promise.all([
      db.query(
        'SELECT id, username, nombre, email, rol, activo, creado, ultimo_acceso, COALESCE(max_allowed_devices, 1) AS max_allowed_devices FROM usuario WHERE id = $1 LIMIT 1',
        [payload.userId],
      ),
      includeProjects
        ? db.query(
            'SELECT id, nombre, creado, actualizado FROM proyecto WHERE usuario_id = $1 ORDER BY actualizado DESC',
            [payload.userId],
          )
        : Promise.resolve(null),
    ]);

    if (userResult.rows.length === 0) {
      invalidateSessionCache(payload.userId);
      const res = NextResponse.json({ success: false, suspended: true, error: 'Usuario no encontrado' }, { status: 401 });
      res.cookies.delete('session');
      return res;
    }

    const user = userResult.rows[0];
    if (!user.activo) {
      invalidateSessionCache(payload.userId);
      const res = NextResponse.json(
        { success: false, suspended: true, error: 'Cuenta suspendida por el administrador' },
        { status: 403 }
      );
      res.cookies.delete('session');
      return res;
    }

    // Si el cliente envía su fingerprint x-device-id, validar Device Binding y anti-abuso de IPs concurrentes
    if (deviceId) {
      const clientIp = extractClientIp(request);
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const deviceAccess = await validateUserSessionAccess({
        userId: user.id,
        userRole: user.rol,
        deviceId,
        clientIp,
        userAgent,
        endpoint: '/api/auth/me',
      });

      if (!deviceAccess.allowed) {
        invalidateSessionCache(payload.userId);
        const res = NextResponse.json(
          {
            success: false,
            suspended: true,
            reason: deviceAccess.reason,
            error:
              deviceAccess.reason === 'DEVICE_LIMIT_EXCEEDED'
                ? `Se ha iniciado sesión en otro dispositivo o se alcanzó el límite (${deviceAccess.max_allowed_devices || 1} máx.).`
                : deviceAccess.reason === 'CONCURRENT_IP_ABUSE'
                  ? 'Abuso de sesiones concurrentes detectado (> 2 IPs simultáneas).'
                  : 'Este dispositivo ha sido revocado por el administrador.',
          },
          { status: 403 }
        );
        res.cookies.delete('session');
        return res;
      }
    }

    primeSessionCache(user.id, user.email || user.username, user.rol, true);

    const canonicalRole = normalizeUserRole(user.rol);
    const roleConfig = await getDynamicRoleConfig(canonicalRole);
    const constraints = getRoleConstraints(canonicalRole);

    return NextResponse.json({
      success: true,
      user: {
        ...user,
        rol: canonicalRole,
        canonicalRole,
        maxAllowedDevices: canonicalRole === 'admin' ? 10 : 1,
        maxVerticesPerCalculation: constraints.maxVerticesPerCalculation,
        roleConfig: roleConfig || {
          role: canonicalRole,
          label: constraints.label,
          maxVerticesPerCalculation: constraints.maxVerticesPerCalculation,
          maxAllowedDevices: canonicalRole === 'admin' ? 10 : 1,
          dxfWatermark: constraints.dxfWatermarkRequired,
          capabilities: constraints.capabilities,
        },
      },
      ...(projectsResult ? { projects: projectsResult.rows || [] } : {}),
    });
  } catch (err) {
    console.error('Me API error:', err);
    return NextResponse.json({ success: false, error: 'Error al obtener usuario' }, { status: 500 });
  }
}
