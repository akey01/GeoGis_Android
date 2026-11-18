// lib/rbac.ts – Role-based access control helpers
import { getSession } from '@/lib/session';
import type { SessionPayload } from '@/lib/auth';
import type { UserRole } from '@/lib/store';
import {
  hasPermission,
  normalizeUserRole,
  type CanonicalUserRole,
  type RoleCapability,
} from '@/src/types/auth';

type AuthFailure = { ok: false; status: 401 | 403; error: string };
type AuthSuccess = { ok: true; session: SessionPayload };

export type AuthResult = AuthFailure | AuthSuccess;

export async function requireSession(): Promise<AuthResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, status: 401, error: 'No autorizado' };
  }
  return { ok: true, session };
}

export async function requireRole(
  allowedRoles: (UserRole | CanonicalUserRole)[],
  existingAuth?: AuthResult,
): Promise<AuthResult> {
  const auth = existingAuth ?? await requireSession();
  if (!auth.ok) return auth;

  const currentRole = auth.session.role as UserRole;
  const canonicalRole = normalizeUserRole(currentRole);

  if (!allowedRoles.includes(currentRole) && !allowedRoles.includes(canonicalRole)) {
    return {
      ok: false,
      status: 403,
      error: 'Operación restringida para tu nivel profesional',
    };
  }

  return auth;
}

export async function requireCapability(
  capability: RoleCapability,
  existingAuth?: AuthResult,
): Promise<AuthResult> {
  const auth = existingAuth ?? await requireSession();
  if (!auth.ok) return auth;

  if (!hasPermission(auth.session.role, capability)) {
    return {
      ok: false,
      status: 403,
      error: `Capacidad "${capability}" bloqueada para el rol ${normalizeUserRole(auth.session.role)}`,
    };
  }

  return auth;
}

/** Admin and Revisor Catastral (Senior) can mutate projects and invalidate cache. */
export const PROJECT_EDIT_ROLES: (UserRole | CanonicalUserRole)[] = [
  'admin',
  'senior',
  'revisor_catastral',
];
