'use server';

import { z } from 'zod';
import bcrypt from 'bcryptjs';
import db from '@/lib/db';
import { cookies, headers } from 'next/headers';
import { SignJWT } from 'jose';
import { redirect } from 'next/navigation';
import { getJwtSecret } from '@/lib/auth';
import { primeSessionCache } from '@/lib/session';
import { validateUserSessionAccess } from '@/src/middleware/authGuard';

const loginSchema = z.object({
  email: z.string().min(1, 'Usuario es requerido'),
  password: z.string().min(1, 'Contraseña es requerida'),
  deviceId: z.string().optional(),
});

export async function loginUser(prevState: any, formData: FormData) {
  const validatedFields = loginSchema.safeParse(
    Object.fromEntries(formData.entries())
  );

  if (!validatedFields.success) {
    return { error: validatedFields.error.flatten().fieldErrors.email?.[0] || 'Campos inválidos' };
  }

  const { email, password } = validatedFields.data;
  const trimmedIdentity = email.trim();

  try {
    // 1 sola consulta puntual (case-insensitive para soportar teclados móviles que capitalizan la primera letra)
    const user = await db.query(
      'SELECT id, username, nombre, email, rol, activo, password FROM usuario WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1',
      [trimmedIdentity]
    );

    if (user.rows.length === 0) {
      return { error: 'Credenciales inválidas' };
    }

    const userData = user.rows[0];
    if (!userData.activo) {
      return { error: 'Su cuenta se encuentra suspendida o pendiente de autorización por el administrador' };
    }

    const passwordMatch = await bcrypt.compare(password, userData.password);

    if (!passwordMatch) {
      return { error: 'Credenciales inválidas' };
    }

    // Validar Device Binding & Anti-Abuso (desde campo oculto o cookie gt_device_id)
    const cookieStore = await cookies();
    const cookieDeviceId = cookieStore.get('gt_device_id')?.value
      ? decodeURIComponent(cookieStore.get('gt_device_id')!.value).trim()
      : '';
    const rawDeviceId = (validatedFields.data.deviceId || '').trim() || cookieDeviceId;
    if (rawDeviceId.length >= 6) {
      const hdrs = await headers();
      const forwardedFor = hdrs.get('x-forwarded-for');
      const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : hdrs.get('x-real-ip') || '127.0.0.1';
      const userAgent = hdrs.get('user-agent') || 'Unknown Browser';

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
        if (accessDecision.reason === 'DEVICE_LIMIT_EXCEEDED') {
          return {
            error: `Límite de dispositivos alcanzado (${accessDecision.active_devices ?? 1}/${accessDecision.max_allowed_devices ?? 1} equipo activo). Cierre sesión o pestaña en su otro equipo antes de ingresar.`,
          };
        }
        if (accessDecision.reason === 'CONCURRENT_IP_ABUSE') {
          return {
            error: 'Se detectó uso simultáneo desde múltiples redes (Anti-Abuso de credenciales). Espere 5 minutos.',
          };
        }
        return { error: 'Acceso denegado por política de seguridad de dispositivos.' };
      }
    }

    // Pre-hidratar caché de sesión en memoria para que el redirect a /dashboard no repita la consulta SQL
    primeSessionCache(userData.id, userData.email || userData.username, userData.rol, true);

    // Actualizar ultimo_acceso en segundo plano (no bloquea el redirect del usuario)
    // Si el hash antiguo tenía costo >= 12 (lento en 0.5 vCPU), migrar transparentemente a costo 10
    const isHighCostHash = typeof userData.password === 'string' && /^\$2[abxy]\$1[2-9]\$/.test(userData.password);
    void (async () => {
      try {
        if (isHighCostHash) {
          const fasterHash = await bcrypt.hash(password, 10);
          await db.query('UPDATE usuario SET ultimo_acceso = $1, password = $2 WHERE id = $3', [
            new Date().toISOString(),
            fasterHash,
            userData.id,
          ]);
        } else {
          await db.query('UPDATE usuario SET ultimo_acceso = $1 WHERE id = $2', [
            new Date().toISOString(),
            userData.id,
          ]);
        }
      } catch (err) {
        console.warn('[Login] Non-blocking ultimo_acceso update failed:', err);
      }
    })();

    // Emitir cookie JWT
    const token = await new SignJWT({ 
      userId: userData.id, 
      email: userData.email || userData.username,
      role: userData.rol 
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(getJwtSecret());

    cookieStore.set('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8, // 8 horas
    });

  } catch (error: any) {
    console.error('🚨 Login error details:', error);
    return { error: `Error: ${error.message || 'Error interno del servidor'}` };
  }

  redirect('/dashboard');
}
