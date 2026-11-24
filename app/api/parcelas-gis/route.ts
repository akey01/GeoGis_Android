import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireSession } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return NextResponse.json({ error: 'Base de datos no configurada' }, { status: 500 });
    }

    const result = await pool.query(`
      SELECT 
        id, 
        codigo, 
        propietario, 
        area_ha, 
        municipio, 
        estado, 
        geom_json,
        centroide_este,
        centroide_norte
      FROM public.parcelas_geojson
      ORDER BY id ASC;
    `);

    return NextResponse.json({ data: result.rows, total: result.rowCount });
  } catch (err) {
    console.error('[API /api/parcelas-gis] Error:', err);
    return NextResponse.json(
      { error: 'Error interno al consultar parcelas catastrales' },
      { status: 500 },
    );
  }
}
