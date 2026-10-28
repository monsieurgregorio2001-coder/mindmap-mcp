import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'data', 'node_modules', 'logs', 'demo/dist', 'demo/node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/web/**/*.{ts,tsx}', 'demo/src/**/*.ts'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    files: ['src/{core,server,mcp}/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs', 'demo/scripts/**/*.mjs', 'demo/*.ts', '*.ts', '*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
);
