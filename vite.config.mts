import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vista previa React (react.html), en paralelo a la aplicación actual (index.html), que no pasa por Vite.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-react',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./react.html', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
