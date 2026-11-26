import type {
  CloudUser,
  CrsMode,
  FieldParcel,
  SyncedProject,
} from '@/components/geogis6-mobile/data/fieldData';

export const STORAGE_AUTH_KEY = 'geogis6_mobile_auth_v6';
export const STORAGE_LOCAL_PROJECTS_KEY = 'geogis6_local_projects_v2';
export const STORAGE_LOCAL_PARCELS_PREFIX = 'geogis6_local_parcels_v2_';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadSavedAuth(): { token: string | null; user: CloudUser | null } {
  if (!hasStorage()) return { token: null, user: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_AUTH_KEY);
    if (!raw) return { token: null, user: null };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string' && parsed.user) {
      return { token: parsed.token, user: parsed.user as CloudUser };
    }
  } catch {
    // ignore corrupt auth storage
  }
  return { token: null, user: null };
}

export function saveSavedAuth(token: string, user: CloudUser): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      STORAGE_AUTH_KEY,
      JSON.stringify({ token, user, savedAt: new Date().toISOString() }),
    );
  } catch {
    // ignore quota errors
  }
}

export function clearSavedAuth(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_AUTH_KEY);
  } catch {
    // ignore
  }
}

export function loadLocalProjects(): SyncedProject[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_LOCAL_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is SyncedProject => Boolean(p && typeof p.id === 'string' && typeof p.name === 'string'),
    );
  } catch {
    return [];
  }
}

export function saveLocalProjects(projects: SyncedProject[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_LOCAL_PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // ignore quota errors
  }
}

export function loadLocalParcels(projectId: string): FieldParcel[] {
  if (!hasStorage() || !projectId) return [];
  try {
    const raw = window.localStorage.getItem(`${STORAGE_LOCAL_PARCELS_PREFIX}${projectId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FieldParcel[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalParcels(projectId: string, parcels: FieldParcel[]): void {
  if (!hasStorage() || !projectId) return;
  try {
    window.localStorage.setItem(
      `${STORAGE_LOCAL_PARCELS_PREFIX}${projectId}`,
      JSON.stringify(parcels),
    );
  } catch {
    // ignore quota errors
  }
}

export function removeLocalParcels(projectId: string): void {
  if (!hasStorage() || !projectId) return;
  try {
    window.localStorage.removeItem(`${STORAGE_LOCAL_PARCELS_PREFIX}${projectId}`);
  } catch {
    // ignore
  }
}

export function createEmptyOfflineProject(input: {
  name: string;
  defaultCrs: CrsMode;
  sectorLabel?: string;
}): { project: SyncedProject; projects: SyncedProject[] } {
  const cleanName = input.name.trim() || 'Proyecto Campo';
  const cleanSector = (input.sectorLabel || '').trim() || 'Trabajo de Campo Android';
  const nowIso = new Date().toISOString();
  const id = `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const project: SyncedProject = {
    id,
    name: cleanName,
    crsLabel: input.defaultCrs === 'psad56' ? 'PSAD56 19N | LOCAL' : 'REGVEN 19N | LOCAL',
    crsBadgeColor: input.defaultCrs === 'psad56' ? 'tertiary' : 'secondary',
    parcelsText: '0 Parcelas (Vacío · Local)',
    syncStatus: 'Pendiente sincronizar',
    syncHighlight: true,
    defaultCrs: input.defaultCrs,
    activeParcelCode: '',
    sectorLabel: cleanSector,
    source: 'local',
    syncState: 'local_only',
    updatedAt: nowIso,
  };

  const existing = loadLocalProjects().filter((p) => p.id !== id);
  const projects = [project, ...existing];
  saveLocalProjects(projects);
  saveLocalParcels(id, []);

  return { project, projects };
}

export function markProjectPendingPush(
  projectId: string,
  parcelCount: number,
  currentProjects?: SyncedProject[],
): SyncedProject[] {
  const list = currentProjects ? [...currentProjects] : loadLocalProjects();
  const nowIso = new Date().toISOString();
  const updated = list.map((p) => {
    if (p.id !== projectId) return p;
    const nextState = p.syncState === 'local_only' ? 'local_only' : 'pending_push';
    return {
      ...p,
      syncState: nextState as SyncedProject['syncState'],
      syncStatus: 'Pendiente sincronizar',
      syncHighlight: true,
      parcelsText:
        parcelCount === 0
          ? '0 Parcelas (Vacío · Local)'
          : `${parcelCount} Parcelas (Local)`,
      updatedAt: nowIso,
    };
  });
  saveLocalProjects(updated);
  return updated;
}

export function migrateLocalProjectToCloud(
  localId: string,
  cloudId: string,
  cloudUpdatedAt?: string,
  currentProjects?: SyncedProject[],
): SyncedProject[] {
  const list = currentProjects ? [...currentProjects] : loadLocalProjects();
  const cachedParcels = loadLocalParcels(localId);
  if (localId !== cloudId) {
    saveLocalParcels(cloudId, cachedParcels);
    removeLocalParcels(localId);
  }

  const syncDate = cloudUpdatedAt
    ? new Date(cloudUpdatedAt).toLocaleDateString('es-VE')
    : 'En línea';

  const seen = new Set<string>();
  const updated: SyncedProject[] = [];

  for (const p of list) {
    const isTarget = p.id === localId || p.id === cloudId;
    const nextId = isTarget ? cloudId : p.id;
    if (seen.has(nextId)) continue;
    seen.add(nextId);

    if (isTarget) {
      updated.push({
        ...p,
        id: cloudId,
        crsLabel: p.defaultCrs === 'psad56' ? 'PSAD56 19N | CLOUD' : 'REGVEN 19N | CLOUD',
        parcelsText:
          cachedParcels.length > 0
            ? `${cachedParcels.length} Parcelas (Sincronizado)`
            : 'Sincronizado en PostgreSQL',
        syncStatus: syncDate,
        syncHighlight: false,
        source: 'cloud',
        syncState: 'synced',
        updatedAt: cloudUpdatedAt || new Date().toISOString(),
      });
    } else {
      updated.push(p);
    }
  }

  saveLocalProjects(updated);
  return updated;
}

export function mergeCloudProjectsWithLocal(
  cloudRows: Array<{ id: string; nombre?: string; actualizado?: string }>,
  existingLocalProjects: SyncedProject[] = loadLocalProjects(),
): SyncedProject[] {
  const existingById = new Map(existingLocalProjects.map((p) => [p.id, p]));
  const pendingLocals = existingLocalProjects.filter(
    (p) => p.syncState === 'local_only' || p.syncState === 'pending_push',
  );
  const pendingIds = new Set(pendingLocals.map((p) => p.id));

  const cloudMapped: SyncedProject[] = [];
  for (const row of cloudRows || []) {
    const cid = String(row.id);
    if (pendingIds.has(cid)) continue;

    const prev = existingById.get(cid);
    const cachedParcels = loadLocalParcels(cid);
    const parcelText =
      cachedParcels.length > 0
        ? `${cachedParcels.length} Parcelas (Dispositivo)`
        : prev?.parcelsText && !prev.parcelsText.includes('Local')
          ? prev.parcelsText
          : 'Sincronizado en PostgreSQL';

    cloudMapped.push({
      id: cid,
      name: String(row.nombre || prev?.name || 'Proyecto Cloud'),
      crsLabel: prev?.defaultCrs === 'psad56' ? 'PSAD56 19N | CLOUD' : 'REGVEN 19N | CLOUD',
      crsBadgeColor: prev?.defaultCrs === 'psad56' ? 'tertiary' : 'secondary',
      parcelsText: parcelText,
      syncStatus: row.actualizado
        ? new Date(row.actualizado).toLocaleDateString('es-VE')
        : 'En línea',
      syncHighlight: false,
      defaultCrs: prev?.defaultCrs || 'regven',
      activeParcelCode: prev?.activeParcelCode || '',
      sectorLabel: prev?.sectorLabel || 'GeoGIS6 Cloud',
      source: 'cloud',
      syncState: 'synced',
      updatedAt: row.actualizado || prev?.updatedAt,
    });
  }

  const merged = [...pendingLocals, ...cloudMapped];
  saveLocalProjects(merged);
  return merged;
}

export function serializeProjectForCloud(
  project: SyncedProject,
  parcels: FieldParcel[],
) {
  return {
    meta: {
      nombre: project.name,
      notas: project.sectorLabel || '',
      defaultCrs: project.defaultCrs,
      source: 'GeoGIS6 Android',
    },
    parcels: (parcels || []).map((p) => ({
      id: p.id,
      nombre: p.code,
      fecha: new Date().toLocaleDateString('es-VE'),
      area: p.areaGraficaM2,
      perim: p.perimeterM,
      ha: p.areaGraficaM2 / 10000,
      geometryType: p.geometryType || 'cerrada',
      method: 'rigida02',
      puntos: p.vertices.map((v) => ({
        id: v.shortId,
        ok: true,
        direction: 'canoa_regven',
        input: {
          id: v.shortId,
          este: v.estePsad56,
          norte: v.nortePsad56,
          huso: p.huso,
          alt: v.cota,
        },
        result: {
          este: v.esteRegven,
          norte: v.norteRegven,
          huso: p.huso,
          cota: v.cota,
          lat: v.lat,
          lng: v.lng,
        },
      })),
    })),
  };
}
