import { defineConfig } from 'vitest/config';

/**
 * Integration tests hit a real, disposable Postgres database (see
 * `src/test/integration-db.ts` for the safety guards) — a separate config
 * from `vitest.config.ts` because they need the `node` environment, not
 * `jsdom`, and must never run mixed in with the fast unit suite `pnpm test`
 * runs on every save.
 *
 * `fileParallelism: false`: multiple test files sharing one real database
 * would otherwise run as concurrent workers and race on the same rows. The
 * suite is small enough that running files sequentially costs little.
 */
export default defineConfig({
  resolve: {
    // Resolves the `@/*` alias from tsconfig.json, matching vitest.config.ts.
    tsconfigPaths: true,
    // Every module under test here is genuinely server-only code (schema,
    // DAL, services) and imports the `server-only` marker package
    // accordingly. That package resolves to a throwing stub unless the
    // `react-server` export condition is active — Next.js's own bundler
    // sets it when compiling Server Components; Vite does not by default.
    // Adding it here is what lets these files import under Vitest at all,
    // matching the environment they actually run in.
    conditions: ['react-server'],
  },
  ssr: {
    // Vitest resolves test files through the SSR pipeline even under the
    // `node` test environment; `resolve.conditions` alone only covers the
    // client-graph side of Vite's dual resolution, so the condition has to
    // be repeated here for it to actually apply to these test files.
    resolve: { conditions: ['react-server'] },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./src/test/integration-setup.ts'],
    exclude: ['node_modules/**', '.next/**'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
