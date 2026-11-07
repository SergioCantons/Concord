import type { LogicalPath, Project } from '../../domain/project';

/** Vista inmutable del contrato para la interfaz; cambia de identidad solo cuando cambia `version`. */
export interface ProjectSnapshot {
  readonly version: number;
  readonly name: string;
  readonly rootFile: string | null;
  readonly title: string;
  readonly apiVersion: string;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/** Contrato de `useSyncExternalStore`: suscripción estable e instantánea cacheada. */
export interface ProjectStore {
  readonly subscribe: (onChange: () => void) => () => void;
  readonly getSnapshot: () => ProjectSnapshot;
}

function readText(project: Project, path: LogicalPath): string {
  const value = project.read(path, false);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function snapshotOf(project: Project): ProjectSnapshot {
  return Object.freeze({
    version: project.version,
    name: project.name,
    rootFile: project.rootFile,
    title: readText(project, ['info', 'title']),
    apiVersion: readText(project, ['info', 'version']),
    dirty: project.isDirty(),
    canUndo: project.canUndo(),
    canRedo: project.canRedo(),
  });
}

export function createProjectStore(project: Project): ProjectStore {
  let cached: ProjectSnapshot | undefined;
  return {
    subscribe: (onChange) => project.onChange(onChange),
    getSnapshot: () => {
      if (cached === undefined || cached.version !== project.version) cached = snapshotOf(project);
      return cached;
    },
  };
}
