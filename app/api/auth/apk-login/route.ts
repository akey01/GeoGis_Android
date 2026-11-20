import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import db from '@/lib/db';
import { getJwtSecret } from '@/lib/auth';
import { primeSessionCache } from '@/lib/session';
import {
  extractClientIp,
  getDynamicRoleConfig,
  validateUserSessionAccess,
} from '@/src/middleware/authGuard';
import { getRoleConstraints, normalizeUserRole } from '@/src/types/auth';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-device-id',
};

const ApkLoginSchema = z.object({
  email: z.string().min(1, 'Usuario o correo requerido'),
  password: z.string().min(1, 'Contraseña requerida'),
  deviceId: z.string().optional(),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsed = ApkLoginSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message || 'Credenciales incompletas',
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const trimmedIdentity = parsed.data.email.trim();
    const { password } = parsed.data;
    const rawDeviceId = (
      parsed.data.deviceId ||
      request.headers.get('x-device-id') ||
      ''
    ).trim();

    const userRes = await db.query(
      'SELECT id, username, nombre, email, rol, activo, password FROM usuario WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1',
      [trimmedIdentity],
    );

    if (userRes.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Credenciales inválidas' },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    const userData = userRes.rows[0];
    if (!userData.activo) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cuenta suspendida o pendiente de autorización por el administrador',
        },
        { status: 403, headers: CORS_HEADERS },
      );
    }

    const passwordMatch = await bcrypt.compare(password, userData.password);
    if (!passwordMatch) {
      return NextResponse.json(
        { success: false, error: 'Credenciales inválidas' },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    if (rawDeviceId.length >= 6) {
      const clientIp = extractClientIp(request);
      const userAgent = request.headers.get('user-agent') || 'GeoGIS6-Android-APK';
      const accessDecision = await validateUserSessionAccess({
        userId: String(userData.id),
        userRole: userData.rol,
        deviceId: rawDeviceId,
        clientIp,
        userAgent,
        endpoint: '/login',
        allowReactivate: true,
      });

      if (!accessDecision.allowed) {
        const errorMsg =
          accessDecision.reason === 'DEVICE_LIMIT_EXCEEDED'
            ? `Límite de dispositivos alcanzado (${accessDecision.active_devices ?? 1}/${accessDecision.max_allowed_devices ?? 1}). Cierre sesión en su otro equipo antes de ingresar.`
            : accessDecision.reason === 'CONCURRENT_IP_ABUSE'
              ? 'Se detectó uso simultáneo desde múltiples redes. Espere unos minutos.'
              : 'Acceso denegado por política de seguridad de dispositivos.';

        return NextResponse.json(
          { success: false, error: errorMsg, reason: accessDecision.reason },
          { status: 403, headers: CORS_HEADERS },
        );
      }
    }

    primeSessionCache(
      String(userData.id),
      userData.email || userData.username,
      userData.rol,
      true,
    );

    void db
      .query('UPDATE usuario SET ultimo_acceso = $1 WHERE id = $2', [
        new Date().toISOString(),
        userData.id,
      ])
      .catch(() => {});

    const canonicalRole = normalizeUserRole(userData.rol);
    const roleConfig = await getDynamicRoleConfig(canonicalRole);
    const constraints = getRoleConstraints(canonicalRole);

    const token = await new SignJWT({
      userId: String(userData.id),
      email: userData.email || userData.username,
      role: userData.rol,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(getJwtSecret());

    const projectsRes = await db.query(
      'SELECT id, nombre, creado, actualizado FROM proyecto WHERE usuario_id = $1 ORDER BY actualizado DESC',
      [userData.id],
    );

    const res = NextResponse.json(
      {
        success: true,
        token,
        user: {
          id: String(userData.id),
          username: userData.username,
          nombre: userData.nombre || userData.username,
          email: userData.email || userData.username,
          rol: canonicalRole,
          canonicalRole,
          activo: Boolean(userData.activo),
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
        projects: projectsRes.rows || [],
      },
      { status: 200, headers: CORS_HEADERS },
    );

    res.cookies.set('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });

    return res;
  } catch (err: any) {
    console.error('[API /auth/apk-login] Error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Error interno de autenticación' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
