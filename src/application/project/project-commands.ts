import type { LogicalPath, Project } from '../../domain/project';

export interface ProjectCommands {
  readonly setTitle: (title: string) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

const TITLE_PATH: LogicalPath = ['info', 'title'];

export function createProjectCommands(project: Project): ProjectCommands {
  return {
    // Igual que el editor actual: un texto vacío elimina la clave y las ediciones seguidas se agrupan.
    setTitle: (title) => {
      project.mutate('Título', (tx) => { tx.set(TITLE_PATH, title === '' ? undefined : title); }, { coalesce: true });
    },
    undo: () => { project.undo(); },
    redo: () => { project.redo(); },
  };
}
