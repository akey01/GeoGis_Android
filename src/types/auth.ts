/**
 * src/types/auth.ts
 * Contrato de Tipos RBAC, Matriz de Capacidades, Restricciones de Modo Demo
 * y Gestión de Dispositivos Autorizados para GeoGIS6.
 */

export type CanonicalUserRole =
  | 'demo'
  | 'operador_campo'
  | 'revisor_catastral'
  | 'admin';

export type LegacyUserRole = 'viewer' | 'junior' | 'senior';

export type AnyUserRole = CanonicalUserRole | LegacyUserRole;

export type RoleCapability =
  | 'transform'
  | 'view_map'
  | 'polygon_calculation'
  | 'export_dxf'
  | 'export_csv'
  | 'export_pdf'
  | 'export_reports'
  | 'satellite_imagery'
  | 'copy_clipboard'
  | 'print_view'
  | 'edit_datum_params'
  | 'overlap_analysis'
  | 'manage_users'
  | 'manage_devices';

export interface RoleConstraints {
  role: CanonicalUserRole;
  label: string;
  maxVerticesPerCalculation: number;
  maxAllowedDevices: number;
  dxfWatermarkRequired: boolean;
  capabilities: Record<RoleCapability, boolean>;
}

export interface AuthorizedDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string | null;
  first_seen_ip: string;
  last_seen_ip: string;
  user_agent: string | null;
  is_active: boolean;
  revoked_by_admin?: boolean;
  created_at: string;
  last_active_at: string;
}

export type SessionAccessDenyReason =
  | 'DEVICE_LIMIT_EXCEEDED'
  | 'CONCURRENT_IP_ABUSE'
  | 'DEVICE_REVOKED'
  | 'ACCOUNT_SUSPENDED'
  | 'INVALID_DEVICE_ID'
  | 'SERVICE_UNAVAILABLE';

export interface ValidateSessionAccessResult {
  allowed: boolean;
  reason?: SessionAccessDenyReason;
  role?: CanonicalUserRole;
  max_allowed_devices?: number;
  active_devices?: number;
  distinct_ips_5m?: number;
}

/**
 * Normaliza roles legacy de base de datos ('viewer', 'junior', 'senior')
 * hacia los roles canónicos de la directiva ('demo', 'operador_campo', 'revisor_catastral', 'admin').
 */
export function normalizeUserRole(role?: string | null): CanonicalUserRole {
  if (!role) return 'demo';
  const clean = role.toLowerCase().trim();
  switch (clean) {
    case 'admin':
      return 'admin';
    case 'revisor_catastral':
    case 'senior':
      return 'revisor_catastral';
    case 'operador_campo':
    case 'junior':
      return 'operador_campo';
    case 'demo':
    case 'viewer':
    default:
      return 'demo';
  }
}

export const ROLE_PERMISSIONS_MATRIX: Record<CanonicalUserRole, RoleConstraints> = {
  demo: {
    role: 'demo',
    label: 'Modo Demo (Evaluación)',
    maxVerticesPerCalculation: 20,
    maxAllowedDevices: 1,
    dxfWatermarkRequired: true,
    capabilities: {
      transform: true,
      view_map: true,
      polygon_calculation: true,
      export_dxf: true,          // Permitido con marca de agua en capa dedicada
      export_csv: false,         // Bloqueado en Demo
      export_pdf: false,         // Estrictamente BLOQUEADO
      export_reports: false,     // Estrictamente BLOQUEADO (Memorias descriptivas / Fichas)
      satellite_imagery: true,   // Activa por defecto al iniciar (configurable desde Admin Panel)
      copy_clipboard: false,     // Estrictamente BLOQUEADO
      print_view: false,         // Estrictamente BLOQUEADO (Ctrl+P / @media print)
      edit_datum_params: false,
      overlap_analysis: false,
      manage_users: false,
      manage_devices: false,
    },
  },
  operador_campo: {
    role: 'operador_campo',
    label: 'Operador de Campo',
    maxVerticesPerCalculation: 2000,
    maxAllowedDevices: 1,
    dxfWatermarkRequired: false,
    capabilities: {
      transform: true,
      view_map: true,
      polygon_calculation: true,
      export_dxf: true,
      export_csv: true,
      export_pdf: false,         // Sin acceso a PDF/Fichas catastrales
      export_reports: false,
      satellite_imagery: true,
      copy_clipboard: true,
      print_view: false,
      edit_datum_params: false,  // Sin edición manual de parámetros de datum
      overlap_analysis: false,
      manage_users: false,
      manage_devices: false,
    },
  },
  revisor_catastral: {
    role: 'revisor_catastral',
    label: 'Revisor Catastral (QA/QC)',
    maxVerticesPerCalculation: 10000,
    maxAllowedDevices: 1,
    dxfWatermarkRequired: false,
    capabilities: {
      transform: true,
      view_map: true,
      polygon_calculation: true,
      export_dxf: true,
      export_csv: true,
      export_pdf: true,
      export_reports: true,
      satellite_imagery: true,
      copy_clipboard: true,
      print_view: true,
      edit_datum_params: true,
      overlap_analysis: true,
      manage_users: false,
      manage_devices: false,
    },
  },
  admin: {
    role: 'admin',
    label: 'Administrador General',
    maxVerticesPerCalculation: Number.MAX_SAFE_INTEGER,
    maxAllowedDevices: 10,
    dxfWatermarkRequired: false,
    capabilities: {
      transform: true,
      view_map: true,
      polygon_calculation: true,
      export_dxf: true,
      export_csv: true,
      export_pdf: true,
      export_reports: true,
      satellite_imagery: true,
      copy_clipboard: true,
      print_view: true,
      edit_datum_params: true,
      overlap_analysis: true,
      manage_users: true,
      manage_devices: true,
    },
  },
};

/**
 * Actualiza en caliente la matriz de permisos de un rol (desde configuración dinámica de BD).
 */
export interface DynamicRoleConfigPayload {
  role: CanonicalUserRole;
  label?: string;
  maxVerticesPerCalculation?: number | null;
  maxAllowedDevices?: number;
  dxfWatermark?: boolean;
  dxfWatermarkRequired?: boolean;
  capabilities?: Partial<Record<RoleCapability | string, boolean>>;
}

export function applyDynamicRoleConfig(
  role: AnyUserRole | string | null | undefined,
  rawOverride?: (Partial<RoleConstraints> | DynamicRoleConfigPayload) | null,
): void {
  if (!rawOverride) return;
  const canonical = normalizeUserRole(role);
  const current = ROLE_PERMISSIONS_MATRIX[canonical];
  if (!current) return;

  const anyOverride = rawOverride as DynamicRoleConfigPayload;
  const capWatermark = (anyOverride.capabilities as any)?.dxf_watermark;
  const resolvedWatermark =
    typeof anyOverride.dxfWatermarkRequired === 'boolean'
      ? anyOverride.dxfWatermarkRequired
      : typeof anyOverride.dxfWatermark === 'boolean'
        ? anyOverride.dxfWatermark
        : typeof capWatermark === 'boolean'
          ? capWatermark
          : undefined;

  const override = {
    maxVerticesPerCalculation:
      anyOverride.maxVerticesPerCalculation === null
        ? 1_000_000 // null en BD = ilimitado
        : anyOverride.maxVerticesPerCalculation,
    maxAllowedDevices: anyOverride.maxAllowedDevices,
    dxfWatermarkRequired: resolvedWatermark,
    capabilities: (anyOverride.capabilities || {}) as Partial<Record<RoleCapability, boolean>>,
  };

  ROLE_PERMISSIONS_MATRIX[canonical] = {
    ...current,
    ...(typeof override.maxVerticesPerCalculation === 'number'
      ? { maxVerticesPerCalculation: override.maxVerticesPerCalculation }
      : {}),
    ...(typeof override.maxAllowedDevices === 'number'
      ? { maxAllowedDevices: override.maxAllowedDevices }
      : {}),
    ...(typeof override.dxfWatermarkRequired === 'boolean'
      ? { dxfWatermarkRequired: override.dxfWatermarkRequired }
      : {}),
    capabilities: {
      ...current.capabilities,
      ...(override.capabilities || {}),
    },
  };
}

/**
 * Valida si un rol (canónico o legacy) posee una capacidad específica.
 */
export function hasPermission(
  role: AnyUserRole | string | null | undefined,
  capability: RoleCapability,
  customCapabilities?: Partial<Record<RoleCapability, boolean>> | null,
): boolean {
  if (customCapabilities && typeof customCapabilities[capability] === 'boolean') {
    return Boolean(customCapabilities[capability]);
  }
  const canonical = normalizeUserRole(role);
  return Boolean(ROLE_PERMISSIONS_MATRIX[canonical]?.capabilities[capability]);
}

/**
 * Obtiene las restricciones operativas (máx. vértices, máx. dispositivos, marca de agua DXF) del rol.
 */
export function getRoleConstraints(
  role: AnyUserRole | string | null | undefined,
): RoleConstraints {
  const canonical = normalizeUserRole(role);
  return ROLE_PERMISSIONS_MATRIX[canonical];
}

/**
 * Determina si el usuario actual opera bajo las restricciones del Modo Demo.
 */
export function isDemoRole(role: AnyUserRole | string | null | undefined): boolean {
  return normalizeUserRole(role) === 'demo';
}

