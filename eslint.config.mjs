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

      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      'no-unused-expressions': 'error',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],

      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-multi-spaces': 'error',
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1 }],
      'no-trailing-spaces': 'error',
      semi: ['error', 'always'],
      quotes: ['error', 'single'],
      'arrow-parens': ['error', 'always'],
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',

      'no-process-exit': 'warn',
      'callback-return': 'off',

      'space-before-blocks': ['error', 'always'],
      'space-infix-ops': 'error',
      'keyword-spacing': ['error', { before: true, after: true }],
      'brace-style': ['error', '1tbs', { allowSingleLine: true }],
      'array-bracket-spacing': ['error', 'never'],
      'object-curly-spacing': ['error', 'always'],
      'eol-last': ['error', 'always'],
      'no-console': 'off',
    },
    ignores: ['node_modules/', 'dist/', 'coverage/', 'build/'],
  },
  {
    files: ['test/**/*.js', '**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
]);
