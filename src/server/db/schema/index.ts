/**
 * Drizzle schema root.
 *
 * INTENTIONALLY EMPTY. Phase 00b establishes the database boundary without
 * committing to any product schema — `users`, `workspaces`, `trades` and the
 * rest arrive in later schema phases, each with its own reviewed migration.
 *
 * drizzle-kit requires this module to exist and to be resolvable, so it is a
 * real file rather than a missing path. Tables are added by re-exporting them
 * here:
 *
 *   export * from './users';
 *   export * from './workspaces';
 *
 * Conventions every table must follow are recorded in docs/data-dictionary.md.
 * The important one: `workspace_id` on every business record, indexed first.
 */

export {};
