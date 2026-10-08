//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  ...tanstackConfig,

  {
    name: 'budgy/ignores',
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      'public/**/*.js',
      '.claude/**',
      'worker-configuration.d.ts',
    ],
  },

  {
    name: 'budgy/test-boundary',
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@test/*', '**/__tests__/*'],
              message: 'Production code must not import from src/__tests__.',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'budgy/react-hooks',
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    name: 'budgy/overrides',
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'warn',
      'no-shadow': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
]
