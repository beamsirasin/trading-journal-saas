CREATE TABLE "workspace_entitlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" text NOT NULL,
	"plan_key" text,
	"trial_started_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"current_period_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_entitlements_status_check" CHECK ("workspace_entitlements"."status" IN ('trialing', 'active', 'expired', 'canceled')),
	CONSTRAINT "workspace_entitlements_plan_key_check" CHECK ("workspace_entitlements"."plan_key" IS NULL OR "workspace_entitlements"."plan_key" IN ('starter', 'pro', 'elite'))
);
--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_entitlements_workspace_idx" ON "workspace_entitlements" USING btree ("workspace_id");
--> statement-breakpoint
-- Phase 3C backfill policy: no production customers exist yet on this
-- schema, so every workspace that has ALREADY completed onboarding (and
-- therefore has a real trading account and no entitlement row yet) receives
-- a fresh 7-day trial starting now, rather than being backdated to its
-- original onboarding date. Workspaces that have not completed onboarding
-- get no row here — completeOnboarding() starts their trial the moment they
-- finish, per the "trial begins when onboarding completes" rule. This
-- statement is idempotent (WHERE NOT EXISTS) so re-running this migration
-- file against a database that already has entitlement rows is a no-op.
-- `gen_random_uuid()` here is a backfill-only concession, the same one
-- 0002's `mutation_key` DEFAULT already established for this codebase: normal
-- application inserts always supply `id` client-side via `generateId()`
-- (UUIDv7, ADR 0008); this one-time raw-SQL INSERT has no application layer
-- to generate one, and a v4 fallback for a handful of one-off backfill rows
-- does not need the sortability UUIDv7 gives ordinary application writes.
INSERT INTO "workspace_entitlements" ("id", "workspace_id", "status", "trial_started_at", "trial_ends_at")
SELECT gen_random_uuid(), "id", 'trialing', now(), now() + interval '7 days'
FROM "workspaces" AS w
WHERE w."onboarding_completed_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_entitlements" AS e WHERE e."workspace_id" = w."id"
  );