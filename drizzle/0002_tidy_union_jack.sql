-- `DEFAULT gen_random_uuid()` is a backfill mechanism for rows that already
-- exist on an upgraded Phase 3A database (each gets its own random, unique
-- value so the unique index below can never see a NULL/duplicate collision
-- among them) — it is NOT declared in `trading-accounts.ts`, whose
-- `$defaultFn(generateId)` is the actual application-level default for every
-- future insert. `gen_random_uuid()` is a Postgres 13+ built-in, no extension
-- required.
ALTER TABLE "trading_accounts" ADD COLUMN "mutation_key" uuid NOT NULL DEFAULT gen_random_uuid();--> statement-breakpoint
CREATE UNIQUE INDEX "trading_accounts_workspace_mutation_key_idx" ON "trading_accounts" USING btree ("workspace_id","mutation_key");