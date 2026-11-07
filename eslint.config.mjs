// Lint del código React/TypeScript (src/). Las reglas de importación hacen cumplir la dirección
// de dependencias entre capas: presentación → aplicación → dominio.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const forbid = (group, message) => ({ 'no-restricted-imports': ['error', { patterns: [{ group, message }] }] });

export default defineConfig(
  { ignores: ['src/domain/core-bridge.mjs'] },
  {
    files: ['src/**/*.{ts,tsx,mts}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: forbid(['**/application/**', '**/presentation/**', '**/infrastructure/**', '**/composition', 'react', 'react-dom', 'react-dom/*'],
      'El dominio no depende de otras capas ni de React.'),
  },
  {
    files: ['src/application/**/*.ts'],
    rules: forbid(['**/presentation/**', '**/infrastructure/**', '**/composition', 'react', 'react-dom', 'react-dom/*'],
      'La aplicación no depende de la presentación, de la infraestructura ni de React.'),
  },
  {
    files: ['src/presentation/**/*.{ts,tsx}'],
    rules: forbid(['**/domain/**', '**/infrastructure/**'],
      'La presentación trabaja con la capa de aplicación; no accede al dominio ni a la infraestructura.'),
  },
);
