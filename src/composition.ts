import { createProjectCommands, type ProjectCommands } from './application/project/project-commands';
import { createProjectStore, type ProjectStore } from './application/project/project-store';
import { Project } from './domain/project';

export interface AppServices {
  readonly store: ProjectStore;
  readonly commands: ProjectCommands;
}

export function createAppServices(): AppServices {
  const project = Project.newEmpty();
  return { store: createProjectStore(project), commands: createProjectCommands(project) };
}
