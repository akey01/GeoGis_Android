'use server';

import { z } from 'zod';
import bcrypt from 'bcryptjs';
import db from '@/lib/db';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth';

// ── Shared state type ──────────────────────────────────────────────────────
export type ActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

// ── Validation schema ──────────────────────────────────────────────────────
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es requerida'),
  newPassword: z.string().min(6, 'La nueva contraseña debe tener al menos 6 caracteres'),
  confirmPassword: z.string().min(1, 'Confirmar contraseña es requerida'),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
});

// ── Server action ──────────────────────────────────────────────────────────
export async function changePassword(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const cookieStore = await cookies();
  const session = cookieStore.get('session')?.value;

  if (!session) {
    return { status: 'error', message: 'No autenticado' };
  }

  let userId: string;
  try {
    const payload = await verifySessionToken(session);
    userId = payload.userId;
  } catch {
    return { status: 'error', message: 'Sesión inválida' };
  }

  const validated = changePasswordSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!validated.success) {
    const firstError = Object.values(validated.error.flatten().fieldErrors)[0]?.[0];
    return { status: 'error', message: firstError ?? 'Datos inválidos' };
  }

  const { currentPassword, newPassword } = validated.data;

  try {
    const result = await db.query('SELECT password, activo FROM usuario WHERE id = $1 LIMIT 1', [userId]);
    if (result.rows.length === 0) {
      cookieStore.delete('session');
      return { status: 'error', message: 'Usuario no encontrado' };
    }
    if (!result.rows[0].activo) {
      cookieStore.delete('session');
      return { status: 'error', message: 'Cuenta suspendida por el administrador' };
    }

    const match = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!match) {
      return { status: 'error', message: 'La contraseña actual es incorrecta' };
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE usuario SET password = $1 WHERE id = $2', [hashed, userId]);

    return { status: 'success', message: 'Contraseña actualizada correctamente' };
  } catch (err) {
    console.error('changePassword error:', err);
    return { status: 'error', message: 'Error interno del servidor' };
  }
}
