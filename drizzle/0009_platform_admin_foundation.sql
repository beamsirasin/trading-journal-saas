CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_admin_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_admin_id" uuid,
	CONSTRAINT "platform_admins_revoked_by_requires_revoked_at" CHECK ("platform_admins"."revoked_by_admin_id" IS NULL OR "platform_admins"."revoked_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_admin_id" uuid,
	"action" text NOT NULL,
	"subject_user_id" text,
	"subject_workspace_id" uuid,
	"reason_code" text NOT NULL,
	"reason_note" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_log_actor_kind_check" CHECK ("admin_audit_log"."actor_kind" IN ('platform_admin', 'system')),
	CONSTRAINT "admin_audit_log_actor_invariant_check" CHECK (("admin_audit_log"."actor_kind" = 'platform_admin' AND "admin_audit_log"."actor_admin_id" IS NOT NULL) OR ("admin_audit_log"."actor_kind" = 'system' AND "admin_audit_log"."actor_admin_id" IS NULL)),
	CONSTRAINT "admin_audit_log_action_check" CHECK ("admin_audit_log"."action" IN (
        'platform_admin.granted',
        'platform_admin.revoked',
        'subscription.trial_extended',
        'subscription.complimentary_granted',
        'subscription.complimentary_revoked',
        'vat.configuration_changed'
      )),
	CONSTRAINT "admin_audit_log_reason_code_check" CHECK ("admin_audit_log"."reason_code" IN (
        'bootstrap',
        'access_grant',
        'access_revoke',
        'trial_extension_goodwill',
        'complimentary_access',
        'support_adjustment',
        'configuration_change',
        'other'
      )),
	CONSTRAINT "admin_audit_log_reason_note_length_check" CHECK ("admin_audit_log"."reason_note" IS NULL OR char_length("admin_audit_log"."reason_note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "platform_vat_configuration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_by_admin_id" uuid,
	"reason_code" text NOT NULL,
	"reason_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_vat_configuration_rate_check" CHECK ("platform_vat_configuration"."rate_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "platform_vat_configuration_reason_code_check" CHECK ("platform_vat_configuration"."reason_code" IN (
        'bootstrap',
        'access_grant',
        'access_revoke',
        'trial_extension_goodwill',
        'complimentary_access',
        'support_adjustment',
        'configuration_change',
        'other'
      )),
	CONSTRAINT "platform_vat_configuration_reason_note_length_check" CHECK ("platform_vat_configuration"."reason_note" IS NULL OR char_length("platform_vat_configuration"."reason_note") <= 500)
);
--> statement-breakpoint
-- Backfill policy for existing rows (Phase 11B): `source` is added nullable
-- first, backfilled deterministically, then locked NOT NULL — never a blanket
-- default across every existing row, which would misclassify an already-paid
-- workspace as 'trial'. The rule is exact, not a guess: `workspace_entitlements
-- .plan_key` has exactly two writers in this codebase before this migration —
-- `startTrialInTx` (src/server/services/entitlement.ts), which never sets a
-- plan key, and `activatePaidSubscriptionInTransaction`/`applyImmediateUpgrade
-- InTransaction`/`recoverSubscription`/`materializeDueLifecycleState`
-- (src/server/services/subscription-lifecycle.ts), which only ever set or
-- preserve one after a trusted paid activation. So a non-null `plan_key` on
-- any pre-migration row is proof that row was paid-activated at least once,
-- regardless of its current status (active/past_due/canceled/expired) —
-- deterministic, not ambiguous, and requires no manual inspection of a live
-- database (see docs/phases/PHASE-11-admin.md and the Phase 11A audit this
-- migration follows). No pre-migration row can have `source = 'complimentary'`
-- — nothing writes that value until a future Phase 11E admin action exists.
ALTER TABLE "workspace_entitlements" ADD COLUMN "source" text;--> statement-breakpoint
UPDATE "workspace_entitlements" SET "source" = CASE WHEN "plan_key" IS NOT NULL THEN 'paid' ELSE 'trial' END;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
-- The default applies only to INSERTs from here forward (existing test
-- fixtures across the Phase 04-10 suites that insert this table directly,
-- bypassing the service layer) — every real application write path
-- (`startTrialInTx`, `activatePaidSubscriptionInTransaction`) sets this
-- column explicitly rather than relying on it; see the schema comment.
ALTER TABLE "workspace_entitlements" ALTER COLUMN "source" SET DEFAULT 'trial';--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_granted_by_admin_id_platform_admins_id_fk" FOREIGN KEY ("granted_by_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_revoked_by_admin_id_platform_admins_id_fk" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_admin_id_platform_admins_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_subject_workspace_id_workspaces_id_fk" FOREIGN KEY ("subject_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_vat_configuration" ADD CONSTRAINT "platform_vat_configuration_created_by_admin_id_platform_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_active_user_idx" ON "platform_admins" USING btree ("user_id") WHERE "platform_admins"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "platform_admins_user_idx" ON "platform_admins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_subject_user_idx" ON "admin_audit_log" USING btree ("subject_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_subject_workspace_idx" ON "admin_audit_log" USING btree ("subject_workspace_id");--> statement-breakpoint
CREATE INDEX "platform_vat_configuration_effective_idx" ON "platform_vat_configuration" USING btree ("effective_at");--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_source_check" CHECK ("workspace_entitlements"."source" IN ('trial', 'paid', 'complimentary'));
--> statement-breakpoint
-- Hand-authored below this point: append-only immutability triggers (Drizzle
-- has no DDL for either). Same pattern as 0006's billing_transactions
-- snapshot trigger and 0007's strategy-version lock triggers.
--
-- admin_audit_log: every content column is permanently immutable once
-- inserted, with ONE narrow exception. `subject_user_id`/`subject_workspace_
-- id` carry `ON DELETE SET NULL` foreign keys (matching audit_logs' own
-- subject-nulling precedent), and Postgres implements that referential
-- action as an UPDATE — an unconditional "reject every UPDATE" trigger would
-- make a future user/workspace deletion fail outright the moment it tried to
-- null this table's pointer. The trigger below allows exactly that one
-- transition (non-null -> NULL on those two columns only) and rejects every
-- other change, including reassigning a subject to a different non-null
-- value. No content column (actor, action, reason, before/after state,
-- timestamp) may ever change.
CREATE FUNCTION "admin_audit_log_protect_content"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."actor_kind" IS DISTINCT FROM OLD."actor_kind"
		OR NEW."actor_admin_id" IS DISTINCT FROM OLD."actor_admin_id"
		OR NEW."action" IS DISTINCT FROM OLD."action"
		OR NEW."reason_code" IS DISTINCT FROM OLD."reason_code"
		OR NEW."reason_note" IS DISTINCT FROM OLD."reason_note"
		OR NEW."before_state" IS DISTINCT FROM OLD."before_state"
		OR NEW."after_state" IS DISTINCT FROM OLD."after_state"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
		OR (NEW."subject_user_id" IS DISTINCT FROM OLD."subject_user_id" AND NEW."subject_user_id" IS NOT NULL)
		OR (NEW."subject_workspace_id" IS DISTINCT FROM OLD."subject_workspace_id" AND NEW."subject_workspace_id" IS NOT NULL)
	THEN
		RAISE EXCEPTION 'admin audit log entries are immutable'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "admin_audit_log_protect_content_trigger"
BEFORE UPDATE ON "admin_audit_log"
FOR EACH ROW
EXECUTE FUNCTION "admin_audit_log_protect_content"();
--> statement-breakpoint
-- No foreign key referencing admin_audit_log ever issues a DELETE against
-- it (this table has no children), so an unconditional rejection needs no
-- workspace-gone-style exception.
CREATE FUNCTION "admin_audit_log_protect_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'admin audit log entries cannot be deleted'
		USING ERRCODE = '23514';
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "admin_audit_log_protect_delete_trigger"
BEFORE DELETE ON "admin_audit_log"
FOR EACH ROW
EXECUTE FUNCTION "admin_audit_log_protect_delete"();
--> statement-breakpoint
-- platform_vat_configuration: append-only in the same spirit as billing_
-- transactions' commercial snapshot, but simpler — no column here is ever
-- legitimately updated after insert (a change is always a NEW row), and
-- `created_by_admin_id` is RESTRICT rather than SET NULL, so no foreign key
-- ever issues an UPDATE or a DELETE against this table either. Both
-- rejections can be unconditional.
CREATE FUNCTION "platform_vat_configuration_protect_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'platform VAT configuration rows are immutable; insert a new row instead'
		USING ERRCODE = '23514';
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "platform_vat_configuration_protect_update_trigger"
BEFORE UPDATE ON "platform_vat_configuration"
FOR EACH ROW
EXECUTE FUNCTION "platform_vat_configuration_protect_update"();
--> statement-breakpoint
CREATE FUNCTION "platform_vat_configuration_protect_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'platform VAT configuration rows cannot be deleted'
		USING ERRCODE = '23514';
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "platform_vat_configuration_protect_delete_trigger"
BEFORE DELETE ON "platform_vat_configuration"
FOR EACH ROW
EXECUTE FUNCTION "platform_vat_configuration_protect_delete"();
--> statement-breakpoint
-- Deterministic launch baseline (Phase 11's own requirement: "the future
-- runtime source is never dependent on an empty-table interpretation").
-- `enabled = false` / `rate_basis_points = 700` matches src/config/billing.
-- server.ts's DEFAULT_VAT_CONFIGURATION exactly, which remains the actual
-- live source for checkout/quotation until Phase 11F switches the read path
-- over to this table — this row does not change production behavior today.
-- `gen_random_uuid()` here is the same one-time backfill-only concession
-- migration 0003 already established for a raw-SQL seed row with no
-- application layer present to call generateId() (UUIDv7, ADR 0008).
INSERT INTO "platform_vat_configuration"
  ("id", "enabled", "rate_basis_points", "effective_at", "created_by_admin_id", "reason_code", "reason_note", "created_at")
VALUES
  (gen_random_uuid(), false, 700, now(), NULL, 'bootstrap', 'Launch baseline seeded by migration 0009: VAT disabled, rate prepared at 7.00%. Mirrors src/config/billing.server.ts DEFAULT_VAT_CONFIGURATION, which remains the live source until Phase 11F wiring.', now());