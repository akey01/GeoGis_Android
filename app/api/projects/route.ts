import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import db from '@/lib/db';
import { verifySessionToken, type SessionPayload } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { invalidateProjectCache } from '@/lib/cache';
import { isDemoRole } from '@/src/types/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-device-id',
};

const SaveProjectSchema = z.object({
  id: z.string().min(1).max(120).optional().nullable(),
  name: z.string().min(1, 'Nombre del proyecto requerido').max(200),
  content: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

async function resolveSession(request: Request): Promise<SessionPayload | null> {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const payload = await verifySessionToken(token);
        const userRes = await db.query(
          'SELECT id, email, rol, activo FROM usuario WHERE id = $1 LIMIT 1',
          [payload.userId],
        );
        if (userRes.rows.length > 0 && userRes.rows[0].activo) {
          return {
            ...payload,
            email: userRes.rows[0].email || payload.email,
            role: userRes.rows[0].rol || payload.role,
          };
        }
        return null;
      } catch {
        return null;
      }
    }
  }
  return getSession();
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const session = await resolveSession(request);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'No autenticado' },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('id')?.trim();

  try {
    if (projectId) {
      const res = await db.query(
        'SELECT id, nombre, content, creado, actualizado FROM proyecto WHERE id = $1 AND usuario_id = $2 LIMIT 1',
        [projectId, session.userId],
      );
      if (res.rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Proyecto no encontrado' },
          { status: 404, headers: CORS_HEADERS },
        );
      }
      const row = res.rows[0];
      return NextResponse.json(
        {
          success: true,
          id: row.id,
          nombre: row.nombre,
          content: row.content,
          creado: row.creado,
          actualizado: row.actualizado,
        },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    const res = await db.query(
      'SELECT id, nombre, creado, actualizado FROM proyecto WHERE usuario_id = $1 ORDER BY actualizado DESC',
      [session.userId],
    );
    return NextResponse.json(
      { success: true, projects: res.rows || [] },
      { status: 200, headers: CORS_HEADERS },
    );
  } catch (err: any) {
    console.error('[API /projects GET] Error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Error al consultar proyectos' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

export async function POST(request: Request) {
  const session = await resolveSession(request);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'No autenticado' },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  if (isDemoRole(session.role) || session.role === 'viewer') {
    return NextResponse.json(
      { success: false, error: 'Operación restringida para el nivel Demo/Visor' },
      { status: 403, headers: CORS_HEADERS },
    );
  }

  let parsedBody: z.infer<typeof SaveProjectSchema>;
  try {
    parsedBody = SaveProjectSchema.parse(await request.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues.map((i) => i.message).join(', ') : 'Payload JSON inválido';
    return NextResponse.json(
      { success: false, error: msg },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const projectContent =
      typeof parsedBody.content === 'string'
        ? JSON.parse(parsedBody.content)
        : parsedBody.content;

    const targetId = parsedBody.id && parsedBody.id.trim() ? parsedBody.id.trim() : null;

    const result = await db.query(
      `INSERT INTO proyecto (id, nombre, usuario_id, content, creado, actualizado)
       VALUES (COALESCE($1, 'prj_' || encode(gen_random_bytes(6), 'hex')), $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         nombre = EXCLUDED.nombre,
         content = EXCLUDED.content,
         actualizado = CURRENT_TIMESTAMP
       RETURNING id, nombre, actualizado`,
      [targetId, parsedBody.name.trim(), session.userId, projectContent],
    );

    if (!result.rows || result.rows.length === 0) {
      throw new Error('La base de datos no devolvió el ID del proyecto');
    }

    const row = result.rows[0];
    await invalidateProjectCache(row.id).catch(() => {});
    try {
      revalidatePath('/dashboard');
    } catch {}

    return NextResponse.json(
      {
        success: true,
        projectId: row.id,
        nombre: row.nombre,
        actualizado: row.actualizado,
      },
      { status: 200, headers: CORS_HEADERS },
    );
  } catch (err: any) {
    console.error('[API /projects POST] Error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Error al guardar el proyecto' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await resolveSession(request);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'No autenticado' },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  if (isDemoRole(session.role) || session.role === 'viewer') {
    return NextResponse.json(
      { success: false, error: 'Operación restringida para el nivel Demo/Visor' },
      { status: 403, headers: CORS_HEADERS },
    );
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('id')?.trim();
  const deleteAll = searchParams.get('all') === '1';

  try {
    if (deleteAll) {
      await db.query('DELETE FROM proyecto WHERE usuario_id = $1', [session.userId]);
      try {
        revalidatePath('/dashboard');
      } catch {}
      return NextResponse.json(
        { success: true, remainingCount: 0 },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'Se requiere id de proyecto' },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    await db.query('DELETE FROM proyecto WHERE id = $1 AND usuario_id = $2', [
      projectId,
      session.userId,
    ]);
    await invalidateProjectCache(projectId).catch(() => {});

    const remainingRes = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM proyecto WHERE usuario_id = $1',
      [session.userId],
    );
    const remainingCount = Number.parseInt(remainingRes.rows[0]?.count || '0', 10);
    try {
      revalidatePath('/dashboard');
    } catch {}

    return NextResponse.json(
      { success: true, remainingCount },
      { status: 200, headers: CORS_HEADERS },
    );
  } catch (err: any) {
    console.error('[API /projects DELETE] Error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Error al eliminar proyecto' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
