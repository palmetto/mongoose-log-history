import js from '@eslint/js';
import globals from 'globals';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    files: ['**/*.{js,mjs,cjs}'],
    plugins: {
      js,
      prettier: prettierPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'no-unused-vars': ['warn'],
      'no-console': 'off',
    },
    ignores: ['node_modules/', 'dist/', 'coverage/', 'build/'],
  },
]);
