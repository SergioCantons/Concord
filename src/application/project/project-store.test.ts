import { describe, expect, it } from 'vitest';
import { Project } from '../../domain/project';
import { createProjectCommands } from './project-commands';
import { createProjectStore } from './project-store';

describe('createProjectStore', () => {
  it('describes the empty contract created by the domain', () => {
    const store = createProjectStore(Project.newEmpty());

    expect(store.getSnapshot()).toEqual({
      version: 0, name: 'contrato-nuevo', rootFile: 'openapi.yaml', title: 'Nuevo contrato',
      apiVersion: '1.0.0', dirty: false, canUndo: false, canRedo: false,
    });
  });

  it('returns the same frozen snapshot while the project does not change', () => {
    const store = createProjectStore(Project.newEmpty());

    const first = store.getSnapshot();

    expect(store.getSnapshot()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('notifies subscribers and publishes a new snapshot after an edit', () => {
    const project = Project.newEmpty();
    const store = createProjectStore(project);
    const before = store.getSnapshot();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });

    createProjectCommands(project).setTitle('API de pedidos');

    const after = store.getSnapshot();
    expect(notifications).toBe(1);
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ title: 'API de pedidos', dirty: true, canUndo: true, canRedo: false });
  });

  it('stops notifying after unsubscribing', () => {
    const project = Project.newEmpty();
    const store = createProjectStore(project);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications += 1; });

    unsubscribe();
    createProjectCommands(project).setTitle('API de pedidos');

    expect(notifications).toBe(0);
  });
});
