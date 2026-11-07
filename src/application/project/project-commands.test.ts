import { describe, expect, it } from 'vitest';
import { Project } from '../../domain/project';
import { createProjectCommands } from './project-commands';

const ROOT = 'openapi.yaml';
const SOURCE = [
  'openapi: 3.0.3',
  '# Contrato de prueba',
  'info:',
  '  title: Tienda # nombre visible',
  '  version: 2.1.0',
  '  x-owner: equipo-a',
  'paths: {}',
  '',
].join('\n');

const projectFromSource = (): Project => Project.fromFiles(new Map([[ROOT, SOURCE]]), ROOT);

describe('createProjectCommands', () => {
  it('changes only the title in the YAML, keeping comments and extensions', () => {
    const project = projectFromSource();

    createProjectCommands(project).setTitle('Tienda online');

    expect(project.texts().get(ROOT)).toBe(SOURCE.replace('title: Tienda #', 'title: Tienda online #'));
  });

  it('restores the original text and clean state on undo', () => {
    const project = projectFromSource();
    const commands = createProjectCommands(project);
    commands.setTitle('Tienda online');

    commands.undo();

    expect(project.texts().get(ROOT)).toBe(SOURCE);
    expect(project.isDirty()).toBe(false);
  });

  it('reapplies the undone title on redo', () => {
    const project = projectFromSource();
    const commands = createProjectCommands(project);
    commands.setTitle('Tienda online');
    commands.undo();

    commands.redo();

    expect(project.read(['info', 'title'])).toBe('Tienda online');
  });

  it('leaves history untouched when the title does not change', () => {
    const project = projectFromSource();

    createProjectCommands(project).setTitle('Tienda');

    expect(project.version).toBe(0);
    expect(project.canUndo()).toBe(false);
  });

  it('removes the title key when the new title is empty, like the current editor', () => {
    const project = projectFromSource();

    createProjectCommands(project).setTitle('');

    expect(project.read(['info', 'title'])).toBeUndefined();
  });
});
