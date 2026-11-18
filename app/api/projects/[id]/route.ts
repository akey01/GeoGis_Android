import { NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { invalidateProjectCache } from '@/lib/cache';
import { PROJECT_EDIT_ROLES, requireRole, requireSession } from '@/lib/rbac';

const ProjectUpdateSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
}).refine(d => d.nombre || d.content, {
  message: 'Se requiere al menos nombre o content',
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/projects/[id] – fetch project content (optional Redis layer).
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;

  try {
    const result = await db.query<{ content: unknown; nombre: string }>(
      `SELECT nombre, content FROM proyecto WHERE id = $1 AND usuario_id = $2`,
      [id, auth.session.userId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
    }

    return NextResponse.json({
      id,
      nombre: result.rows[0].nombre,
      content: result.rows[0].content,
    });
  } catch (error) {
    console.error('[API /projects/[id] GET] Error:', error);
    return NextResponse.json({ error: 'Error al cargar el proyecto' }, { status: 500 });
  }
}

/**
 * PUT /api/projects/[id]
 * Admin/Senior: update project and invalidate Redis cache for that project.
 */
export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireRole(PROJECT_EDIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;

  let body: z.infer<typeof ProjectUpdateSchema>;
  try {
    body = ProjectUpdateSchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map(e => e.message).join(', ') : 'JSON inválido';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM proyecto WHERE id = $1 AND usuario_id = $2`,
      [id, auth.session.userId],
    );

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
    }

    const result = await db.query<{ id: string; nombre: string; actualizado: string }>(
      `UPDATE proyecto
       SET nombre = COALESCE($1, nombre),
           content = COALESCE($2, content),
           actualizado = CURRENT_TIMESTAMP
       WHERE id = $3 AND usuario_id = $4
       RETURNING id, nombre, actualizado`,
      [body.nombre ?? null, body.content ?? null, id, auth.session.userId],
    );

    await invalidateProjectCache(id);

    return NextResponse.json({
      success: true,
      project: result.rows[0],
      cacheInvalidated: true,
    });
  } catch (error) {
    console.error('[API /projects/[id] PUT] Error:', error);
    const message = error instanceof Error ? error.message : 'Error al actualizar el proyecto';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/projects/[id] – Admin/Senior only, with cache invalidation.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireRole(PROJECT_EDIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;

  try {
    const result = await db.query(
      `DELETE FROM proyecto WHERE id = $1 AND usuario_id = $2`,
      [id, auth.session.userId],
    );

    if (!result.rowCount) {
      return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
    }

    await invalidateProjectCache(id);

    return NextResponse.json({ success: true, cacheInvalidated: true });
  } catch (error) {
    console.error('[API /projects/[id] DELETE] Error:', error);
    return NextResponse.json({ error: 'Error al eliminar el proyecto' }, { status: 500 });
  }
}
