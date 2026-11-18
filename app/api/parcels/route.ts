import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { requireSession } from '@/lib/rbac';

interface ParcelRow {
  project_id: string;
  project_name: string;
  parcels: unknown;
}

/**
 * GET /api/parcels?projectId=<optional>
 * Lists parcels stored inside project JSONB content.
 */
export async function GET(request: Request) {
  const auth = await requireSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  let client: PoolClient | undefined;
  try {
    const pool = getPool();
    if (!pool) {
      return NextResponse.json({ error: 'Base de datos no configurada' }, { status: 500 });
    }
    client = await pool.connect();

    const query = projectId
      ? `SELECT id AS project_id, nombre AS project_name, content->'parcels' AS parcels
         FROM proyecto
         WHERE id = $1 AND usuario_id = $2`
      : `SELECT id AS project_id, nombre AS project_name, content->'parcels' AS parcels
         FROM proyecto
         WHERE usuario_id = $1
         ORDER BY actualizado DESC`;

    const params = projectId
      ? [projectId, auth.session.userId]
      : [auth.session.userId];

    const result = await client.query<ParcelRow>(query, params);

    const parcels = result.rows.flatMap((row) => {
      const items = Array.isArray(row.parcels) ? row.parcels : [];
      return items.map((parcel) => ({
        ...(parcel as Record<string, unknown>),
        projectId: row.project_id,
        projectName: row.project_name,
      }));
    });

    return NextResponse.json({ parcels, total: parcels.length });
  } catch (error) {
    console.error('[API /parcels] Error:', error);
    const message = error instanceof Error ? error.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client?.release();
  }
}
