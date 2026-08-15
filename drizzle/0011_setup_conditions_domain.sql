CREATE TABLE "setup_conditions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"setup_id" uuid NOT NULL,
	"setup_version_id" uuid NOT NULL,
	"condition_key" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_conditions_key_present_check" CHECK ("setup_conditions"."condition_key" IS NOT NULL),
	CONSTRAINT "setup_conditions_label_not_blank_check" CHECK (btrim("setup_conditions"."label") <> ''),
	CONSTRAINT "setup_conditions_sort_order_check" CHECK ("setup_conditions"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trade_setup_condition_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"setup_condition_id" uuid NOT NULL,
	"setup_version_id" uuid NOT NULL,
	"condition_key" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"check_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_setup_condition_checks_status_check" CHECK ("trade_setup_condition_checks"."check_status" IN ('met', 'not_met')),
	CONSTRAINT "trade_setup_condition_checks_label_not_blank_check" CHECK (btrim("trade_setup_condition_checks"."label") <> ''),
	CONSTRAINT "trade_setup_condition_checks_sort_order_check" CHECK ("trade_setup_condition_checks"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_setup_versions_id_setup_workspace_idx" ON "strategy_setup_versions" USING btree ("id","setup_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_id_setup_version_idx" ON "trades" USING btree ("id","setup_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_conditions_version_key_idx" ON "setup_conditions" USING btree ("setup_version_id","condition_key");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_conditions_id_version_key_workspace_idx" ON "setup_conditions" USING btree ("id","setup_version_id","condition_key","workspace_id");--> statement-breakpoint
CREATE INDEX "setup_conditions_version_sort_idx" ON "setup_conditions" USING btree ("setup_version_id","sort_order");--> statement-breakpoint
CREATE INDEX "setup_conditions_workspace_idx" ON "setup_conditions" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "setup_conditions" ADD CONSTRAINT "setup_conditions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_conditions" ADD CONSTRAINT "setup_conditions_setup_id_setups_id_fk" FOREIGN KEY ("setup_id") REFERENCES "public"."setups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_conditions" ADD CONSTRAINT "setup_conditions_setup_version_id_strategy_setup_versions_id_fk" FOREIGN KEY ("setup_version_id") REFERENCES "public"."strategy_setup_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_conditions" ADD CONSTRAINT "setup_conditions_setup_version_setup_workspace_fk" FOREIGN KEY ("setup_version_id","setup_id","workspace_id") REFERENCES "public"."strategy_setup_versions"("id","setup_id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD CONSTRAINT "trade_setup_condition_checks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD CONSTRAINT "trade_setup_condition_checks_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD CONSTRAINT "trade_setup_condition_checks_setup_condition_id_setup_conditions_id_fk" FOREIGN KEY ("setup_condition_id") REFERENCES "public"."setup_conditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD CONSTRAINT "trade_setup_condition_checks_setup_version_id_strategy_setup_versions_id_fk" FOREIGN KEY ("setup_version_id") REFERENCES "public"."strategy_setup_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD CONSTRAINT "trade_setup_condition_checks_trade_workspace_fk" FOREIGN KEY ("trade_id","workspace_id") REFERENCES "public"."trades"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD CONSTRAINT "trade_setup_condition_checks_trade_setup_version_fk" FOREIGN KEY ("trade_id","setup_version_id") REFERENCES "public"."trades"("id","setup_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD CONSTRAINT "trade_setup_condition_checks_source_fk" FOREIGN KEY ("setup_condition_id","setup_version_id","condition_key","workspace_id") REFERENCES "public"."setup_conditions"("id","setup_version_id","condition_key","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_setup_condition_checks_trade_key_idx" ON "trade_setup_condition_checks" USING btree ("trade_id","condition_key");--> statement-breakpoint
CREATE INDEX "trade_setup_condition_checks_workspace_idx" ON "trade_setup_condition_checks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "trade_setup_condition_checks_condition_key_idx" ON "trade_setup_condition_checks" USING btree ("condition_key");
--> statement-breakpoint
-- Setup Conditions are content owned by a Setup Version. Reuse the Strategy
-- domain's parent-version lock instead of inventing an independent lock.
CREATE FUNCTION "setup_conditions_protect_locked"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	old_locked_at timestamptz;
	new_locked_at timestamptz;
BEGIN
	IF TG_OP = 'DELETE' THEN
		SELECT sv."locked_at" INTO old_locked_at
		FROM "strategy_setup_versions" ssv
		JOIN "strategy_versions" sv ON sv."id" = ssv."strategy_version_id"
		WHERE ssv."id" = OLD."setup_version_id";
		IF old_locked_at IS NOT NULL AND NOT "strategy_domain_workspace_gone"(OLD."workspace_id") THEN
			RAISE EXCEPTION 'cannot modify a condition belonging to a locked strategy version'
				USING ERRCODE = '23514';
		END IF;
		RETURN OLD;
	END IF;

	IF TG_OP = 'UPDATE' THEN
		SELECT sv."locked_at" INTO old_locked_at
		FROM "strategy_setup_versions" ssv
		JOIN "strategy_versions" sv ON sv."id" = ssv."strategy_version_id"
		WHERE ssv."id" = OLD."setup_version_id";
		IF old_locked_at IS NOT NULL THEN
			RAISE EXCEPTION 'cannot modify a condition belonging to a locked strategy version'
				USING ERRCODE = '23514';
		END IF;
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT sv."locked_at" INTO new_locked_at
		FROM "strategy_setup_versions" ssv
		JOIN "strategy_versions" sv ON sv."id" = ssv."strategy_version_id"
		WHERE ssv."id" = NEW."setup_version_id";
		IF new_locked_at IS NOT NULL THEN
			RAISE EXCEPTION 'cannot modify a condition belonging to a locked strategy version'
				USING ERRCODE = '23514';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "setup_conditions_protect_locked_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "setup_conditions"
FOR EACH ROW
EXECUTE FUNCTION "setup_conditions_protect_locked"();
--> statement-breakpoint
-- Entry snapshots are immutable. Workspace deletion is the sole hard-delete
-- exception, matching the existing Strategy-history cascade contract.
CREATE FUNCTION "trade_setup_condition_checks_protect_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' AND "strategy_domain_workspace_gone"(OLD."workspace_id") THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'trade setup condition snapshots are immutable'
		USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trade_setup_condition_checks_protect_snapshot_trigger"
BEFORE UPDATE OR DELETE ON "trade_setup_condition_checks"
FOR EACH ROW
EXECUTE FUNCTION "trade_setup_condition_checks_protect_snapshot"();
