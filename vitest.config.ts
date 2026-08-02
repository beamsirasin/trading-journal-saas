import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Resolves the `@/*` alias from tsconfig.json, so tests and app code agree
  // on module paths without a second source of truth.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    // `next-intl`'s navigation module resolves `next/navigation` through
    // Node's own ESM loader when left externalized, and that loader (unlike
    // Vite's) does not resolve the extensionless specifier. Inlining forces
    // Vite to transform the package instead, which resolves it correctly.
    server: {
      deps: {
        inline: [/next-intl/],
      },
    },
    // `e2e/` belongs to Playwright. Without this split, Vitest would try to
    // execute Playwright specs and fail confusingly. `*.integration.test.ts`
    // belongs to `vitest.integration.config.ts` — those hit a real database
    // and import `server-only` modules that throw outside a server-like
    // environment, so they must never run under this jsdom config.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**', 'src/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.d.ts',
        // Layouts are exercised by e2e, not unit tests.
        'src/app/**/layout.tsx',
      ],
    },
  },
});
