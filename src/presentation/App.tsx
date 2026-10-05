import { useEffect, useSyncExternalStore } from 'react';
import logoUrl from '../../assets/logo.svg';
import type { ProjectCommands } from '../application/project/project-commands';
import type { ProjectStore } from '../application/project/project-store';
import { TitleField } from './TitleField';

interface AppProps {
  readonly store: ProjectStore;
  readonly commands: ProjectCommands;
}

export function App({ store, commands }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    document.title = snapshot.name + (snapshot.dirty ? ' \u2022' : '') + ' \u2014 Editor OpenAPI (vista previa React)';
  }, [snapshot.name, snapshot.dirty]);

  return (
    <>
      <header className="toolbar">
        <div className="brand">
          <img src={logoUrl} alt="" width={26} height={26} />
          <span className="brand-name">OpenAPI</span>
        </div>
        <div className="proj">
          <strong>{snapshot.name}</strong>
          <span className={'status ' + (snapshot.dirty ? 'dirty' : 'clean')} role="status">
            <span className="dot" />
            <span className="lbl">{snapshot.dirty ? 'Cambios sin guardar' : 'Guardado'}</span>
          </span>
        </div>
        <span className="spacer" />
        <div className="tool-group">
          <button type="button" className="btn small" disabled={!snapshot.canUndo} onClick={commands.undo}>Deshacer</button>
          <button type="button" className="btn small" disabled={!snapshot.canRedo} onClick={commands.redo}>Rehacer</button>
        </div>
      </header>
      <main className="preview-main">
        <div className="preview">
          <p className="callout">
            Vista previa de la migración a React: solo permite editar el título de un contrato nuevo y no guarda cambios.
            El resto de funciones sigue en la aplicación actual (index.html).
          </p>
          <div className="stack">
            <h2>{snapshot.title === '' ? '(sin título)' : snapshot.title}</h2>
            <p className="muted">
              Versión {snapshot.apiVersion === '' ? '(sin versión)' : snapshot.apiVersion} · Fichero raíz {snapshot.rootFile ?? '(ninguno)'}
            </p>
          </div>
          <TitleField title={snapshot.title} onCommit={commands.setTitle} />
        </div>
      </main>
    </>
  );
}
