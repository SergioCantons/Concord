// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppServices } from '../composition';
import { App } from './App';

afterEach(() => { cleanup(); });

const renderApp = () => {
  const { store, commands } = createAppServices();
  render(<App store={store} commands={commands} />);
  return userEvent.setup();
};

const typeTitle = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  const input = screen.getByLabelText('Título');
  await user.clear(input);
  await user.type(input, title + '{Enter}');
};

describe('App', () => {
  it('applies the edited title and marks unsaved changes', async () => {
    const user = renderApp();

    await typeTitle(user, 'API de pedidos');

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('API de pedidos');
    expect(screen.getByRole('status').textContent).toBe('Cambios sin guardar');
  });

  it('restores the previous title and saved status on undo', async () => {
    const user = renderApp();
    await typeTitle(user, 'API de pedidos');

    await user.click(screen.getByRole('button', { name: 'Deshacer' }));

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Nuevo contrato');
    expect(screen.getByLabelText<HTMLInputElement>('Título').value).toBe('Nuevo contrato');
    expect(screen.getByRole('status').textContent).toBe('Guardado');
  });

  it('reapplies the undone title on redo', async () => {
    const user = renderApp();
    await typeTitle(user, 'API de pedidos');
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));

    await user.click(screen.getByRole('button', { name: 'Rehacer' }));

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('API de pedidos');
  });
});
