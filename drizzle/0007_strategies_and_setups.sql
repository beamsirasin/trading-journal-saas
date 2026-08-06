CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"current_version_id" uuid,
	"is_archived" boolean DEFAULT false NOT NULL,
	"mutation_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"notes" text,
	"change_note" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_versions_version_number_check" CHECK ("strategy_versions"."version_number" > 0),
	CONSTRAINT "strategy_versions_name_not_blank_check" CHECK (btrim("strategy_versions"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "setups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"mutation_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_setup_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"setup_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_setup_versions_sort_order_check" CHECK ("strategy_setup_versions"."sort_order" >= 0),
	CONSTRAINT "strategy_setup_versions_name_not_blank_check" CHECK (btrim("strategy_setup_versions"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "strategy_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"setup_version_id" uuid,
	"rule_key" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_required" boolean DEFAULT true NOT NULL,
	"is_pre_trade_check" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_rules_category_check" CHECK ("strategy_rules"."category" IN ('entry', 'invalidation', 'risk', 'management', 'exit')),
	CONSTRAINT "strategy_rules_sort_order_check" CHECK ("strategy_rules"."sort_order" >= 0),
	CONSTRAINT "strategy_rules_title_not_blank_check" CHECK (btrim("strategy_rules"."title") <> '')
);
--> statement-breakpoint
-- Indexes are created before any foreign key below. Several FKs here are
-- composite and reference a non-primary-key unique index (e.g.
-- strategies_id_workspace_idx) rather than a table's primary key — Postgres
-- requires that referenced column set to already be covered by a unique
-- constraint or index at the time the FK is added, so index creation must
-- come first. Drizzle's default generated ordering (tables, then all FKs,
-- then all indexes) does not hold for this migration; this file reorders it.
CREATE INDEX "strategies_workspace_idx" ON "strategies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "strategies_workspace_archived_idx" ON "strategies" USING btree ("workspace_id","is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_workspace_mutation_key_idx" ON "strategies" USING btree ("workspace_id","mutation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_id_workspace_idx" ON "strategies" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "strategy_versions_workspace_strategy_idx" ON "strategy_versions" USING btree ("workspace_id","strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_strategy_version_number_idx" ON "strategy_versions" USING btree ("strategy_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_id_strategy_idx" ON "strategy_versions" USING btree ("id","strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_id_workspace_idx" ON "strategy_versions" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "setups_strategy_idx" ON "setups" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "setups_workspace_archived_idx" ON "setups" USING btree ("workspace_id","is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "setups_workspace_mutation_key_idx" ON "setups" USING btree ("workspace_id","mutation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "setups_id_strategy_idx" ON "setups" USING btree ("id","strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_setup_versions_version_setup_idx" ON "strategy_setup_versions" USING btree ("strategy_version_id","setup_id");--> statement-breakpoint
CREATE INDEX "strategy_setup_versions_version_sort_idx" ON "strategy_setup_versions" USING btree ("strategy_version_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_setup_versions_id_version_idx" ON "strategy_setup_versions" USING btree ("id","strategy_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_rules_version_rule_key_idx" ON "strategy_rules" USING btree ("strategy_version_id","rule_key");--> statement-breakpoint
CREATE INDEX "strategy_rules_version_sort_idx" ON "strategy_rules" USING btree ("strategy_version_id","sort_order");--> statement-breakpoint
CREATE INDEX "strategy_rules_setup_version_idx" ON "strategy_rules" USING btree ("setup_version_id");--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_workspace_fk" FOREIGN KEY ("strategy_id","workspace_id") REFERENCES "public"."strategies"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setups" ADD CONSTRAINT "setups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setups" ADD CONSTRAINT "setups_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setups" ADD CONSTRAINT "setups_strategy_workspace_fk" FOREIGN KEY ("strategy_id","workspace_id") REFERENCES "public"."strategies"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_setup_versions" ADD CONSTRAINT "strategy_setup_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_setup_versions" ADD CONSTRAINT "strategy_setup_versions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_setup_versions" ADD CONSTRAINT "strategy_setup_versions_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_setup_versions" ADD CONSTRAINT "strategy_setup_versions_setup_id_setups_id_fk" FOREIGN KEY ("setup_id") REFERENCES "public"."setups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_setup_versions" ADD CONSTRAINT "strategy_setup_versions_version_strategy_fk" FOREIGN KEY ("strategy_version_id","strategy_id") REFERENCES "public"."strategy_versions"("id","strategy_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_setup_versions" ADD CONSTRAINT "strategy_setup_versions_setup_strategy_fk" FOREIGN KEY ("setup_id","strategy_id") REFERENCES "public"."setups"("id","strategy_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_setup_versions" ADD CONSTRAINT "strategy_setup_versions_version_workspace_fk" FOREIGN KEY ("strategy_version_id","workspace_id") REFERENCES "public"."strategy_versions"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_rules" ADD CONSTRAINT "strategy_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_rules" ADD CONSTRAINT "strategy_rules_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_rules" ADD CONSTRAINT "strategy_rules_setup_version_id_strategy_setup_versions_id_fk" FOREIGN KEY ("setup_version_id") REFERENCES "public"."strategy_setup_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_rules" ADD CONSTRAINT "strategy_rules_version_workspace_fk" FOREIGN KEY ("strategy_version_id","workspace_id") REFERENCES "public"."strategy_versions"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_rules" ADD CONSTRAINT "strategy_rules_setup_version_strategy_version_fk" FOREIGN KEY ("setup_version_id","strategy_version_id") REFERENCES "public"."strategy_setup_versions"("id","strategy_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-authored below this point: a composite FK a circular TypeScript type
-- cannot express, plus version-immutability triggers (Drizzle has no DDL for
-- either). Same pattern as 0006's billing_transactions snapshot trigger.
--> statement-breakpoint
-- strategies.current_version_id must reference a strategy_versions row that
-- belongs to this same strategy (strategy_id = strategies.id). NULL is
-- exempt from FK checking (Postgres MATCH SIMPLE), matching the atomic
-- create-strategy-then-create-first-version window a future service needs.
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_current_version_strategy_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."strategy_versions"("id","strategy_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Shared by every delete-protection trigger below. A locked row's content
-- must be permanently immutable UNLESS the deletion is a direct consequence
-- of the owning workspace itself being deleted — ordinary workspace deletion
-- is allowed to cascade the tenant's own strategy history away with it (the
-- same "ordinary tenant-owned record" policy every other business table
-- follows), while a direct delete of locked history, or a delete of a
-- Strategy/Setup identity row while its workspace still exists, must still
-- be rejected.
--
-- This depends on one empirically-verified PostgreSQL guarantee, not an
-- assumption: within a single transaction, by the time a cascading DELETE
-- reaches a child row (however many FK levels away, and regardless of which
-- of several redundant CASCADE paths reaches it first), the parent row that
-- triggered the cascade is already invisible to a plain SELECT run from
-- inside the child's own trigger — Postgres's cascade machinery increments
-- the command counter before invoking per-row triggers, so a transaction
-- always sees its own prior writes. Verified directly against this
-- database, for all five tables in this domain, before this function was
-- written: deleting a workspace whose strategy history includes a locked
-- version reports workspace_still_visible = false in every cascaded child
-- trigger, while a direct delete with the workspace still present reports
-- true. A concurrent session's uncommitted workspace deletion is never
-- visible here either (ordinary READ COMMITTED cross-transaction
-- visibility), so this cannot be gamed by a second session, and it is not a
-- session-settable flag of any kind — only the literal absence of the
-- workspace row activates it.
CREATE FUNCTION "strategy_domain_workspace_gone"(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
	SELECT NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = check_workspace_id);
$$;
--> statement-breakpoint
-- Version immutability (assumption A6). Once locked_at is set, this trigger
-- rejects every subsequent UPDATE to the row unconditionally — there is no
-- legitimate change to a locked version, so this single check both blocks
-- content edits and blocks any attempt to clear or replace locked_at itself.
-- While unlocked (OLD.locked_at IS NULL), every update is allowed, including
-- the null -> non-null lock transition. Workspace deletion never issues an
-- UPDATE (only cascading DELETEs), so this trigger needs no workspace-gone
-- exception.
CREATE FUNCTION "strategy_versions_protect_locked"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."locked_at" IS NOT NULL THEN
		RAISE EXCEPTION 'strategy version is locked and cannot be modified'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "strategy_versions_protect_locked_update_trigger"
BEFORE UPDATE ON "strategy_versions"
FOR EACH ROW
EXECUTE FUNCTION "strategy_versions_protect_locked"();
--> statement-breakpoint
-- A locked version can never be deleted directly, independent of the update
-- trigger above (DELETE does not fire a BEFORE UPDATE trigger) — except as
-- part of its own owning workspace being deleted; see
-- strategy_domain_workspace_gone()'s comment above.
CREATE FUNCTION "strategy_versions_protect_locked_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."locked_at" IS NOT NULL AND NOT "strategy_domain_workspace_gone"(OLD."workspace_id") THEN
		RAISE EXCEPTION 'strategy version is locked and cannot be deleted'
			USING ERRCODE = '23514';
	END IF;

	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "strategy_versions_protect_locked_delete_trigger"
BEFORE DELETE ON "strategy_versions"
FOR EACH ROW
EXECUTE FUNCTION "strategy_versions_protect_locked_delete"();
--> statement-breakpoint
-- Child rows of a locked version (its setup snapshots) are equally
-- immutable. Checked against BOTH the old and new strategy_version_id on
-- UPDATE, so a row cannot be "moved" out of a locked version's child set as
-- a back door around the lock — that would silently remove content from a
-- version that is supposed to be permanently fixed. Workspace deletion never
-- issues INSERT/UPDATE (only cascading DELETEs), so only the DELETE branch
-- carries the workspace-gone exception.
CREATE FUNCTION "strategy_setup_versions_protect_locked"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	old_locked_at timestamptz;
	new_locked_at timestamptz;
BEGIN
	IF TG_OP = 'DELETE' THEN
		SELECT "locked_at" INTO old_locked_at FROM "strategy_versions" WHERE "id" = OLD."strategy_version_id";
		IF old_locked_at IS NOT NULL AND NOT "strategy_domain_workspace_gone"(OLD."workspace_id") THEN
			RAISE EXCEPTION 'cannot modify a setup version snapshot belonging to a locked strategy version'
				USING ERRCODE = '23514';
		END IF;
		RETURN OLD;
	END IF;

	IF TG_OP = 'UPDATE' THEN
		SELECT "locked_at" INTO old_locked_at FROM "strategy_versions" WHERE "id" = OLD."strategy_version_id";
		IF old_locked_at IS NOT NULL THEN
			RAISE EXCEPTION 'cannot modify a setup version snapshot belonging to a locked strategy version'
				USING ERRCODE = '23514';
		END IF;
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT "locked_at" INTO new_locked_at FROM "strategy_versions" WHERE "id" = NEW."strategy_version_id";
		IF new_locked_at IS NOT NULL THEN
			RAISE EXCEPTION 'cannot modify a setup version snapshot belonging to a locked strategy version'
				USING ERRCODE = '23514';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "strategy_setup_versions_protect_locked_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "strategy_setup_versions"
FOR EACH ROW
EXECUTE FUNCTION "strategy_setup_versions_protect_locked"();
--> statement-breakpoint
-- Rule rows of a locked version are equally immutable, same reasoning and
-- same old/new check as the setup-version trigger above, and the same
-- DELETE-only workspace-gone exception.
CREATE FUNCTION "strategy_rules_protect_locked"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	old_locked_at timestamptz;
	new_locked_at timestamptz;
BEGIN
	IF TG_OP = 'DELETE' THEN
		SELECT "locked_at" INTO old_locked_at FROM "strategy_versions" WHERE "id" = OLD."strategy_version_id";
		IF old_locked_at IS NOT NULL AND NOT "strategy_domain_workspace_gone"(OLD."workspace_id") THEN
			RAISE EXCEPTION 'cannot modify a rule belonging to a locked strategy version'
				USING ERRCODE = '23514';
		END IF;
		RETURN OLD;
	END IF;

	IF TG_OP = 'UPDATE' THEN
		SELECT "locked_at" INTO old_locked_at FROM "strategy_versions" WHERE "id" = OLD."strategy_version_id";
		IF old_locked_at IS NOT NULL THEN
			RAISE EXCEPTION 'cannot modify a rule belonging to a locked strategy version'
				USING ERRCODE = '23514';
		END IF;
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT "locked_at" INTO new_locked_at FROM "strategy_versions" WHERE "id" = NEW."strategy_version_id";
		IF new_locked_at IS NOT NULL THEN
			RAISE EXCEPTION 'cannot modify a rule belonging to a locked strategy version'
				USING ERRCODE = '23514';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "strategy_rules_protect_locked_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "strategy_rules"
FOR EACH ROW
EXECUTE FUNCTION "strategy_rules_protect_locked"();
