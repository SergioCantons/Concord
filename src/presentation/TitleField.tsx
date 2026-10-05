import { useId, useState } from 'react';

interface TitleFieldProps {
  readonly title: string;
  readonly onCommit: (title: string) => void;
}

/** Mientras se escribe, el borrador es local; se aplica al salir del campo o con Intro, como en el editor actual. */
export function TitleField({ title, onCommit }: TitleFieldProps) {
  const inputId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    onCommit(draft);
    setDraft(null);
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={inputId}>Título</label>
      <input
        id={inputId}
        type="text"
        value={draft ?? title}
        aria-describedby={hintId}
        onChange={(event) => { setDraft(event.target.value); }}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
      />
      <span id={hintId} className="field-hint">Se aplica al salir del campo o al pulsar Intro.</span>
    </div>
  );
}
