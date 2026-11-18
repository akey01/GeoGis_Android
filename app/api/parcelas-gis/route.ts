import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
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
    const message = err instanceof Error ? err.message : 'Error interno de base de datos';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
