'use server';

import db from '@/lib/db';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';

export async function saveProject(name: string, content: string, projectId?: string) {
  const session = await getSession();
  if (!session) return { error: 'No autorizado' };

  if (session.role === 'viewer') {
    return { error: 'Operación restringida para tu nivel profesional' };
  }

  try {
    const projectContent = JSON.parse(content);
    
    const result = await db.query(
      `INSERT INTO proyecto (id, nombre, usuario_id, content, creado, actualizado)
       VALUES (COALESCE($1, 'prj_' || encode(gen_random_bytes(6), 'hex')), $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET 
         nombre = EXCLUDED.nombre, 
         content = EXCLUDED.content, 
         actualizado = CURRENT_TIMESTAMP
       RETURNING id`,
      [projectId, name, session.userId, projectContent]
    );

    if (!result.rows || result.rows.length === 0) {
      throw new Error('La base de datos no devolvió un ID de proyecto');
    }

    const savedId = result.rows[0].id;
    revalidatePath('/dashboard');
    return { success: true, projectId: savedId };
  } catch (error: any) {
    console.error('Error saving project:', error);
    return { error: error.message || 'Error al guardar el proyecto' };
  }
}

export async function getUserProjects() {
  const session = await getSession();
  if (!session) return { error: 'No autorizado', projects: [] };

  try {
    const result = await db.query(
      `SELECT id, nombre, creado, actualizado FROM proyecto WHERE usuario_id = $1 ORDER BY actualizado DESC`,
      [session.userId]
    );
    return { projects: result?.rows || [] };
  } catch (error: any) {
    console.error('🚨 Error fetching projects:', error.message);
    return { error: 'Error al obtener proyectos', projects: [] };
  }
}

export async function getProjectContent(projectId: string) {
  const session = await getSession();
  if (!session) return { error: 'No autorizado' };

  try {
    const result = await db.query(
      `SELECT content FROM proyecto WHERE id = $1 AND usuario_id = $2`,
      [projectId, session.userId]
    );
    if (result.rows.length === 0) return { error: 'Proyecto no encontrado' };
    return { content: JSON.stringify(result.rows[0].content) };
  } catch (error) {
    console.error('Error fetching project content:', error);
    return { error: 'Error al cargar el proyecto' };
  }
}

export async function deleteProject(projectId: string) {
  const session = await getSession();
  if (!session) return { error: 'No autorizado' };

  if (session.role === 'viewer') {
    return { error: 'Operación restringida para tu nivel profesional' };
  }

  try {
    await db.query(
      `DELETE FROM proyecto WHERE id = $1 AND usuario_id = $2`,
      [projectId, session.userId]
    );
    const remainingRes = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM proyecto WHERE usuario_id = $1`,
      [session.userId]
    );
    const remainingCount = Number.parseInt(remainingRes.rows[0]?.count || '0', 10);
    revalidatePath('/dashboard');
    return { success: true, remainingCount };
  } catch (error) {
    console.error('Error deleting project:', error);
    return { error: 'Error al eliminar el proyecto' };
  }
}

export async function deleteAllUserProjects() {
  const session = await getSession();
  if (!session) return { error: 'No autorizado' };

  if (session.role === 'viewer') {
    return { error: 'Operación restringida para tu nivel profesional' };
  }

  try {
    await db.query(
      `DELETE FROM proyecto WHERE usuario_id = $1`,
      [session.userId]
    );
    revalidatePath('/dashboard');
    return { success: true, remainingCount: 0 };
  } catch (error) {
    console.error('Error deleting all projects:', error);
    return { error: 'Error al eliminar todos los proyectos' };
  }
}
