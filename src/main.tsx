import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppServices } from './composition';
import { App } from './presentation/App';

const container = document.getElementById('root');
if (container === null) throw new Error('Falta el elemento #root en react.html');

const { store, commands } = createAppServices();
createRoot(container).render(
  <StrictMode>
    <App store={store} commands={commands} />
  </StrictMode>,
);
