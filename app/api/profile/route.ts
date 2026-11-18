import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();

  if (!session) {
    const res = NextResponse.json({ error: 'No autenticado o cuenta suspendida', suspended: true }, { status: 401 });
    res.cookies.delete('session');
    return res;
  }

  try {
    const result = await db.query(
      'SELECT id, username, nombre, email, rol, activo, creado, ultimo_acceso FROM usuario WHERE id = $1',
      [session.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].activo) {
      const res = NextResponse.json({ error: 'Cuenta suspendida', suspended: true }, { status: 403 });
      res.cookies.delete('session');
      return res;
    }

    return NextResponse.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Profile API error:', err);
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
}
