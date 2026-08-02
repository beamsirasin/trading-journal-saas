import path from 'node:path';

/**
 * Shared by `e2e/global-setup.ts` (seeds an empty fallback so the path
 * always exists) and `e2e/auth.setup.ts` (overwrites it with a real session
 * when a database is configured) — one path, not two copies that could drift.
 */
export const authStateFile = path.join(__dirname, '..', '.auth', 'user-a.json');
