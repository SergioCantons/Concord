/**
 * Contrato tipado del núcleo JavaScript (js/core/project.js) que expone el puente generado por
 * scripts/build-core-bridge.js en src/domain/core-bridge.mjs (artefacto local, no versionado).
 * Solo declara lo que usa la aplicación React; se amplía junto con su uso.
 */

/** Ruta lógica desde el documento raíz, p. ej. ['info', 'title']. Sigue los $ref intermedios. */
export type LogicalPath = readonly (string | number)[];

export interface ProjectTransaction {
  /** Asigna un valor en la ruta lógica editando el AST YAML; `undefined` elimina la clave. */
  set(path: LogicalPath, value: unknown): void;
}

export interface MutateOptions {
  /** Agrupa en un único paso de deshacer las ediciones seguidas con la misma etiqueta. */
  readonly coalesce?: boolean;
}

/** Contrato OpenAPI editable: AST YAML por fichero, borradores e historial de deshacer/rehacer. */
export declare class Project {
  private constructor();
  static newEmpty(): Project;
  static fromFiles(files: ReadonlyMap<string, string>, rootFile: string, name?: string): Project;
  readonly name: string;
  readonly rootFile: string | null;
  /** Aumenta con cada cambio observable (edición, deshacer, guardado...). */
  readonly version: number;
  /** Suscribe a los cambios; la función devuelta cancela la suscripción. */
  onChange(listener: () => void): () => boolean;
  /** Valor plano en la ruta lógica (`undefined` si no existe). */
  read(path: LogicalPath, follow?: boolean): unknown;
  /** Edición atómica: si `edit` lanza, se revierte y no entra en el historial. */
  mutate<T>(label: string, edit: (tx: ProjectTransaction) => T, options?: MutateOptions): T;
  /** Copia del texto actual de cada fichero. */
  texts(): Map<string, string>;
  isDirty(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Devuelve la etiqueta de la edición deshecha, o `null` si no había ninguna. */
  undo(): string | null;
  redo(): string | null;
}
