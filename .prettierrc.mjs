/** @type {import('prettier').Config} */
const config = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  endOfLine: 'lf',

  // Import ordering is enforced by Prettier rather than ESLint so that a single
  // `pnpm format` fixes it, and CI's `format:check` catches drift.
  importOrder: [
    '<BUILT_IN_MODULES>',
    '',
    '<THIRD_PARTY_MODULES>',
    '',
    '^@/config/(.*)$',
    '^@/lib/(.*)$',
    '^@/server/(.*)$',
    '^@/components/(.*)$',
    '^@/(.*)$',
    '',
    '^[./]',
    '',
    '^(?!.*[.]css$)[./].*$',
    '.css$',
  ],
  importOrderParserPlugins: ['typescript', 'jsx', 'decorators-legacy'],
  importOrderTypeScriptVersion: '5.9.3',

  // prettier-plugin-tailwindcss must be listed LAST — it relies on being the
  // final plugin to see the fully-parsed output.
  plugins: ['@ianvs/prettier-plugin-sort-imports', 'prettier-plugin-tailwindcss'],
};

export default config;
