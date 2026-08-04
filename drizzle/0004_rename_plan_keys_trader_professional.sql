-- Locked product decision correction: the draft plan keys `pro`/`elite`
-- (limits 1/3/10) are replaced by `trader`/`professional` (limits 1/5/15,
-- src/config/plans.ts). This migration runs AFTER 0003, which already
-- applied against the local database with the old keys/constraint — rather
-- than editing that already-applied migration, this is a new forward
-- migration that translates any persisted old-key rows and installs the
-- corrected constraint. No row is dropped, no timestamp is touched, and a
-- database that never had any `pro`/`elite` rows (the common case: no real
-- customers exist yet) sees the UPDATE statements below affect zero rows.
ALTER TABLE "workspace_entitlements" DROP CONSTRAINT "workspace_entitlements_plan_key_check";--> statement-breakpoint
UPDATE "workspace_entitlements" SET "plan_key" = 'trader' WHERE "plan_key" = 'pro';--> statement-breakpoint
UPDATE "workspace_entitlements" SET "plan_key" = 'professional' WHERE "plan_key" = 'elite';--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_plan_key_check" CHECK ("workspace_entitlements"."plan_key" IS NULL OR "workspace_entitlements"."plan_key" IN ('starter', 'trader', 'professional'));