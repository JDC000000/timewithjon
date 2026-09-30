import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    // Config goes through src/config/env.ts only (coding-best-practices §5).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/config/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration via @/config/env, not process.env.',
        },
      ],
    },
  },
  {
    // One pool factory with the TLS rules (M11, review V2): no ad-hoc pg Pools anywhere else.
    files: ['**/*.{ts,tsx,mjs,js}'],
    ignores: ['src/lib/db-config.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Pool'], NewExpression[callee.property.name='Pool']",
          message: 'Create pg pools only via createPool() in src/lib/db-config.ts (TLS rules, M11).',
        },
      ],
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'supabase/.temp/**'] },
];

export default config;
