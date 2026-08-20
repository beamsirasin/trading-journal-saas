ALTER TABLE "trades" ALTER COLUMN "strategy_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "strategy_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "setup_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "setup_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "strategy_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "setup_assigned_at" timestamp with time zone;--> statement-breakpoint
-- Phase 14B backfill: every Trade through Phase 13 was classified under the
-- old mandatory-at-creation path — its `strategy_id`/`setup_id` (still
-- non-null for every existing row at this point in the migration, since the
-- NOT NULL constraint was only just dropped above and no application code
-- has ever written a null into either column) was necessarily assigned at
-- the exact moment the row was created. `created_at` is therefore the one
-- truthful timestamp for "when was this Trade's classification first
-- assigned" for historical rows — not `entered_at` (many Trades are created
-- and classified well before they are Opened) and not `updated_at` (which a
-- later, unrelated edit could have moved forward). This mirrors exactly how
-- migration 0013's Exit backfill chose `trades.exited_at` as the one
-- truthful value already implied by the pre-13E data, never a fabricated
-- one. No row is backfilled as a "late classification" — see the module doc
-- comment in `src/server/db/schema/trades.ts`. Idempotent and values-
-- preserving: a re-run only ever touches rows this exact migration has not
-- already visited (`... IS NULL` guards), matching the `WHERE ... NOT
-- EXISTS`-guarded idempotency posture migration 0013's own backfill uses.
--
-- Classification timing truth for NEW rows going forward is maintained by
-- application code (`createTrade`, `assignTradeClassification`) — not by a
-- database CHECK pairing `strategy_id`/`strategy_assigned_at` together.
-- Deliberately NOT added: a pairing CHECK here would also bind every
-- existing and future raw fixture/backfill insert of a classified `trades`
-- row (this codebase's integration tests construct many directly) to always
-- supply a timing value with no product meaning for that fixture, for a
-- field whose only real consumer is the "captured at/before entry vs. added
-- after entry" UI disclosure — not a financial or tenancy invariant
-- CLAUDE.md requires the database to enforce.
UPDATE "trades" SET "strategy_assigned_at" = "created_at" WHERE "strategy_id" IS NOT NULL AND "strategy_assigned_at" IS NULL;--> statement-breakpoint
UPDATE "trades" SET "setup_assigned_at" = "created_at" WHERE "setup_id" IS NOT NULL AND "setup_assigned_at" IS NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_identity_version_pairing_check" CHECK (("trades"."strategy_id" IS NULL) = ("trades"."strategy_version_id" IS NULL));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_setup_identity_version_pairing_check" CHECK (("trades"."setup_id" IS NULL) = ("trades"."setup_version_id" IS NULL));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_setup_requires_strategy_check" CHECK ("trades"."setup_id" IS NULL OR "trades"."strategy_id" IS NOT NULL);