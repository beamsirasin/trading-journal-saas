CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mutation_key" uuid NOT NULL,
	"trading_account_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"setup_id" uuid NOT NULL,
	"setup_version_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"timeframe" text,
	"session" text,
	"confirmation_notes" text,
	"confidence" smallint,
	"tradingview_url" text,
	"notes" text,
	"planned_entry" numeric(20, 10) NOT NULL,
	"planned_stop" numeric(20, 10) NOT NULL,
	"planned_target" numeric(20, 10),
	"planned_position_size" numeric(20, 10),
	"actual_entry" numeric(20, 10),
	"actual_initial_stop" numeric(20, 10),
	"actual_exit" numeric(20, 10),
	"actual_position_size" numeric(20, 10),
	"actual_initial_risk_minor" bigint,
	"gross_pnl_minor" bigint,
	"commission_minor" bigint DEFAULT 0 NOT NULL,
	"fees_minor" bigint DEFAULT 0 NOT NULL,
	"swap_minor" bigint DEFAULT 0 NOT NULL,
	"net_pnl_minor" bigint,
	"entered_at" timestamp with time zone,
	"exited_at" timestamp with time zone,
	"system_status" text DEFAULT 'pending' NOT NULL,
	"system_exit_price" numeric(20, 10),
	"system_exited_at" timestamp with time zone,
	"system_exit_reason" text,
	"system_cost_r" numeric(12, 4) DEFAULT '0' NOT NULL,
	"system_resolved_at" timestamp with time zone,
	"planned_r" numeric(12, 4),
	"actual_r" numeric(12, 4),
	"system_r" numeric(12, 4),
	"trader_outcome" text,
	"system_outcome" text,
	"calc_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"followed_plan" boolean,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_direction_check" CHECK ("trades"."direction" IN ('long', 'short')),
	CONSTRAINT "trades_status_check" CHECK ("trades"."status" IN ('planned', 'open', 'closed', 'canceled')),
	CONSTRAINT "trades_system_status_check" CHECK ("trades"."system_status" IN ('pending', 'resolved', 'no_trade')),
	CONSTRAINT "trades_system_exit_reason_check" CHECK ("trades"."system_exit_reason" IS NULL OR "trades"."system_exit_reason" IN (
        'target_hit', 'stop_hit', 'break_even_rule', 'trailing_exit',
        'time_exit', 'rule_exit', 'manual_system_valid_exit', 'setup_invalidated'
      )),
	CONSTRAINT "trades_trader_outcome_check" CHECK ("trades"."trader_outcome" IS NULL OR "trades"."trader_outcome" IN ('win', 'loss', 'break_even')),
	CONSTRAINT "trades_system_outcome_check" CHECK ("trades"."system_outcome" IS NULL OR "trades"."system_outcome" IN ('win', 'loss', 'break_even')),
	CONSTRAINT "trades_confidence_check" CHECK ("trades"."confidence" IS NULL OR "trades"."confidence" BETWEEN 1 AND 5),
	CONSTRAINT "trades_calc_version_check" CHECK ("trades"."calc_version" > 0),
	CONSTRAINT "trades_system_cost_r_check" CHECK ("trades"."system_cost_r" >= 0),
	CONSTRAINT "trades_actual_initial_risk_minor_check" CHECK ("trades"."actual_initial_risk_minor" IS NULL OR "trades"."actual_initial_risk_minor" > 0),
	CONSTRAINT "trades_commission_minor_check" CHECK ("trades"."commission_minor" >= 0),
	CONSTRAINT "trades_fees_minor_check" CHECK ("trades"."fees_minor" >= 0),
	CONSTRAINT "trades_swap_minor_check" CHECK ("trades"."swap_minor" >= 0),
	CONSTRAINT "trades_exited_after_entered_check" CHECK ("trades"."exited_at" IS NULL OR "trades"."entered_at" IS NULL OR "trades"."exited_at" >= "trades"."entered_at"),
	CONSTRAINT "trades_planned_price_direction_check" CHECK ((
        "trades"."direction" = 'long'
        AND "trades"."planned_stop" < "trades"."planned_entry"
        AND ("trades"."planned_target" IS NULL OR "trades"."planned_target" > "trades"."planned_entry")
      ) OR (
        "trades"."direction" = 'short'
        AND "trades"."planned_stop" > "trades"."planned_entry"
        AND ("trades"."planned_target" IS NULL OR "trades"."planned_target" < "trades"."planned_entry")
      )),
	CONSTRAINT "trades_system_status_consistency_check" CHECK ((
        "trades"."system_status" = 'pending'
        AND "trades"."system_cost_r" = 0
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" IS NULL
        AND "trades"."system_resolved_at" IS NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
      ) OR (
        "trades"."system_status" = 'resolved'
        AND "trades"."system_cost_r" >= 0
        AND "trades"."system_exit_price" IS NOT NULL
        AND "trades"."system_exited_at" IS NOT NULL
        AND "trades"."system_exit_reason" IS NOT NULL
        AND "trades"."system_exit_reason" <> 'setup_invalidated'
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_r" IS NOT NULL
        AND "trades"."system_outcome" IS NOT NULL
      ) OR (
        "trades"."system_status" = 'no_trade'
        AND "trades"."system_cost_r" = 0
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" = 'setup_invalidated'
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
      )),
	CONSTRAINT "trades_status_consistency_check" CHECK ((
        "trades"."status" = 'planned'
        AND "trades"."actual_entry" IS NULL
        AND "trades"."actual_initial_stop" IS NULL
        AND "trades"."actual_initial_risk_minor" IS NULL
        AND "trades"."entered_at" IS NULL
        AND "trades"."actual_exit" IS NULL
        AND "trades"."net_pnl_minor" IS NULL
        AND "trades"."exited_at" IS NULL
        AND "trades"."actual_r" IS NULL
        AND "trades"."trader_outcome" IS NULL
      ) OR (
        "trades"."status" = 'open'
        AND "trades"."actual_entry" IS NOT NULL
        AND "trades"."actual_initial_stop" IS NOT NULL
        AND "trades"."actual_initial_risk_minor" IS NOT NULL
        AND "trades"."entered_at" IS NOT NULL
        AND "trades"."actual_exit" IS NULL
        AND "trades"."net_pnl_minor" IS NULL
        AND "trades"."exited_at" IS NULL
        AND "trades"."actual_r" IS NULL
        AND "trades"."trader_outcome" IS NULL
      ) OR (
        "trades"."status" = 'closed'
        AND "trades"."actual_entry" IS NOT NULL
        AND "trades"."actual_initial_stop" IS NOT NULL
        AND "trades"."actual_initial_risk_minor" IS NOT NULL
        AND "trades"."entered_at" IS NOT NULL
        AND "trades"."actual_exit" IS NOT NULL
        AND "trades"."net_pnl_minor" IS NOT NULL
        AND "trades"."exited_at" IS NOT NULL
        AND "trades"."actual_r" IS NOT NULL
        AND "trades"."trader_outcome" IS NOT NULL
      ) OR (
        "trades"."status" = 'canceled'
      ))
);
--> statement-breakpoint
CREATE TABLE "mistake_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"severity" text NOT NULL,
	"default_weight" numeric(12, 4) NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mistake_types_severity_check" CHECK ("mistake_types"."severity" IN ('minor', 'moderate', 'severe')),
	CONSTRAINT "mistake_types_default_weight_check" CHECK ("mistake_types"."default_weight" >= 0),
	CONSTRAINT "mistake_types_sort_order_check" CHECK ("mistake_types"."sort_order" >= 0),
	CONSTRAINT "mistake_types_key_not_blank_check" CHECK (btrim("mistake_types"."key") <> ''),
	CONSTRAINT "mistake_types_label_not_blank_check" CHECK (btrim("mistake_types"."label") <> ''),
	CONSTRAINT "mistake_types_tenancy_check" CHECK (("mistake_types"."is_system" AND "mistake_types"."workspace_id" IS NULL) OR (NOT "mistake_types"."is_system" AND "mistake_types"."workspace_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "trade_mistakes" (
	"trade_id" uuid NOT NULL,
	"mistake_type_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"note" text,
	"severity_at_time" text NOT NULL,
	"weight_at_time" numeric(12, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_mistakes_trade_id_mistake_type_id_pk" PRIMARY KEY("trade_id","mistake_type_id"),
	CONSTRAINT "trade_mistakes_severity_at_time_check" CHECK ("trade_mistakes"."severity_at_time" IN ('minor', 'moderate', 'severe')),
	CONSTRAINT "trade_mistakes_weight_at_time_check" CHECK ("trade_mistakes"."weight_at_time" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trade_rule_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"strategy_rule_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"rule_key" uuid NOT NULL,
	"check_status" text DEFAULT 'not_checked' NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"is_required" boolean NOT NULL,
	"is_pre_trade_check" boolean NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_rule_checks_check_status_check" CHECK ("trade_rule_checks"."check_status" IN ('followed', 'violated', 'not_applicable', 'not_checked')),
	CONSTRAINT "trade_rule_checks_category_check" CHECK ("trade_rule_checks"."category" IN ('entry', 'invalidation', 'risk', 'management', 'exit')),
	CONSTRAINT "trade_rule_checks_sort_order_check" CHECK ("trade_rule_checks"."sort_order" >= 0),
	CONSTRAINT "trade_rule_checks_title_not_blank_check" CHECK (btrim("trade_rule_checks"."title") <> '')
);
--> statement-breakpoint
-- Indexes are created before any foreign key below, exactly matching
-- 0007_strategies_and_setups.sql's own note: several FKs here are composite
-- and reference a non-primary-key unique index rather than a table's primary
-- key, and Postgres requires that referenced column set to already be
-- covered by a unique constraint/index at the time the FK is added.
-- Drizzle's default generated ordering (tables, then all FKs, then all
-- indexes) does not hold for this migration; this file reorders it. Three of
-- these indexes belong to tables created by earlier migrations
-- (`trading_accounts`, `strategy_setup_versions`, `strategy_rules`) — Phase
-- 07B's own composite-FK plumbing additions to them, not a change to any
-- existing 0000-0007 index.
CREATE UNIQUE INDEX "trading_accounts_id_workspace_idx" ON "trading_accounts" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_setup_versions_id_setup_idx" ON "strategy_setup_versions" USING btree ("id","setup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_rules_id_version_rule_key_idx" ON "strategy_rules" USING btree ("id","strategy_version_id","rule_key");--> statement-breakpoint
CREATE INDEX "trades_workspace_idx" ON "trades" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "trades_workspace_account_idx" ON "trades" USING btree ("workspace_id","trading_account_id");--> statement-breakpoint
CREATE INDEX "trades_workspace_account_exited_idx" ON "trades" USING btree ("workspace_id","trading_account_id","exited_at");--> statement-breakpoint
CREATE INDEX "trades_workspace_status_idx" ON "trades" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "trades_workspace_strategy_version_idx" ON "trades" USING btree ("workspace_id","strategy_version_id");--> statement-breakpoint
CREATE INDEX "trades_workspace_deleted_idx" ON "trades" USING btree ("workspace_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_workspace_mutation_key_idx" ON "trades" USING btree ("workspace_id","mutation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_id_workspace_idx" ON "trades" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_id_strategy_version_idx" ON "trades" USING btree ("id","strategy_version_id");--> statement-breakpoint
CREATE INDEX "mistake_types_workspace_archived_idx" ON "mistake_types" USING btree ("workspace_id","is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_types_system_key_idx" ON "mistake_types" USING btree ("key") WHERE "mistake_types"."is_system";--> statement-breakpoint
CREATE UNIQUE INDEX "mistake_types_workspace_key_idx" ON "mistake_types" USING btree ("workspace_id","key") WHERE NOT "mistake_types"."is_system";--> statement-breakpoint
CREATE INDEX "trade_mistakes_workspace_idx" ON "trade_mistakes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "trade_mistakes_mistake_type_idx" ON "trade_mistakes" USING btree ("mistake_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_rule_checks_trade_rule_key_idx" ON "trade_rule_checks" USING btree ("trade_id","rule_key");--> statement-breakpoint
CREATE INDEX "trade_rule_checks_workspace_idx" ON "trade_rule_checks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "trade_rule_checks_rule_key_idx" ON "trade_rule_checks" USING btree ("rule_key");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_setup_id_setups_id_fk" FOREIGN KEY ("setup_id") REFERENCES "public"."setups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_setup_version_id_strategy_setup_versions_id_fk" FOREIGN KEY ("setup_version_id") REFERENCES "public"."strategy_setup_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_trading_account_workspace_fk" FOREIGN KEY ("trading_account_id","workspace_id") REFERENCES "public"."trading_accounts"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_workspace_fk" FOREIGN KEY ("strategy_id","workspace_id") REFERENCES "public"."strategies"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_version_strategy_fk" FOREIGN KEY ("strategy_version_id","strategy_id") REFERENCES "public"."strategy_versions"("id","strategy_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_setup_strategy_fk" FOREIGN KEY ("setup_id","strategy_id") REFERENCES "public"."setups"("id","strategy_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_setup_version_strategy_version_fk" FOREIGN KEY ("setup_version_id","strategy_version_id") REFERENCES "public"."strategy_setup_versions"("id","strategy_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_setup_version_setup_fk" FOREIGN KEY ("setup_version_id","setup_id") REFERENCES "public"."strategy_setup_versions"("id","setup_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistake_types" ADD CONSTRAINT "mistake_types_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_mistakes" ADD CONSTRAINT "trade_mistakes_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_mistakes" ADD CONSTRAINT "trade_mistakes_mistake_type_id_mistake_types_id_fk" FOREIGN KEY ("mistake_type_id") REFERENCES "public"."mistake_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_mistakes" ADD CONSTRAINT "trade_mistakes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_mistakes" ADD CONSTRAINT "trade_mistakes_trade_workspace_fk" FOREIGN KEY ("trade_id","workspace_id") REFERENCES "public"."trades"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_strategy_rule_id_strategy_rules_id_fk" FOREIGN KEY ("strategy_rule_id") REFERENCES "public"."strategy_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_trade_workspace_fk" FOREIGN KEY ("trade_id","workspace_id") REFERENCES "public"."trades"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_trade_strategy_version_fk" FOREIGN KEY ("trade_id","strategy_version_id") REFERENCES "public"."trades"("id","strategy_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_rule_version_rule_key_fk" FOREIGN KEY ("strategy_rule_id","strategy_version_id","rule_key") REFERENCES "public"."strategy_rules"("id","strategy_version_id","rule_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-authored below this point: a cross-table tenant-scope check a plain
-- foreign key cannot express (Drizzle has no trigger DDL either), plus the
-- canonical system mistake-taxonomy seed. Same posture as 0007's hand-authored
-- section.
--> statement-breakpoint
-- `mistake_types.workspace_id` is NULL for shared system rows and non-null
-- for workspace-defined custom rows, so an ordinary composite foreign key
-- requiring an exact (mistake_type_id, workspace_id) match would incorrectly
-- reject every reference to a system type (NULL never equals a real
-- workspace id). This trigger allows any reference to a workspace_id IS NULL
-- (system) row unconditionally, and requires an exact workspace match for
-- any other (custom) row — the "cross-workspace custom mistake reference
-- rejected" guarantee, enforced where a plain FK cannot reach.
CREATE FUNCTION "trade_mistakes_workspace_scope_check"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	mistake_workspace_id uuid;
BEGIN
	SELECT "workspace_id" INTO mistake_workspace_id FROM "mistake_types" WHERE "id" = NEW."mistake_type_id";
	IF mistake_workspace_id IS NOT NULL AND mistake_workspace_id <> NEW."workspace_id" THEN
		RAISE EXCEPTION 'trade mistake references a mistake type belonging to another workspace'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trade_mistakes_workspace_scope_trigger"
BEFORE INSERT OR UPDATE ON "trade_mistakes"
FOR EACH ROW
EXECUTE FUNCTION "trade_mistakes_workspace_scope_check"();
--> statement-breakpoint
-- The nine canonical system mistake types (CLAUDE.md, docs/roadmap.md,
-- docs/phases/PHASE-07-calc-engine.md). The source documents name these nine
-- types but define no evidence-backed relative severity or weight, so Phase
-- 07 MVP seeds every row with one neutral default — severity 'moderate',
-- weight 1.0000 — rather than inventing unjustified differentiation. Mirrors
-- src/config/mistakes.ts's CANONICAL_SYSTEM_MISTAKE_TYPES exactly; a change
-- to one without the other is a drift bug. Fixed, deterministic ids so this
-- seed is reproducible across environments. ON CONFLICT targets the partial
-- unique index (mistake_types_system_key_idx, WHERE is_system) so a re-run
-- of this statement against a database that already has these rows is a
-- no-op rather than a duplicate-key error.
INSERT INTO "mistake_types" ("id", "workspace_id", "key", "label", "severity", "default_weight", "is_system", "is_archived", "sort_order")
VALUES
	('019fd76f-1f75-723e-8772-3b408eb1b6cb', NULL, 'moved_stop', 'Moved stop', 'moderate', 1.0000, true, false, 0),
	('019fd76f-1f76-7b7b-b40b-586254407590', NULL, 'early_exit', 'Early exit', 'moderate', 1.0000, true, false, 1),
	('019fd76f-1f76-7b7b-b40b-586347a75b60', NULL, 'oversized_position', 'Oversized position', 'moderate', 1.0000, true, false, 2),
	('019fd76f-1f76-7b7b-b40b-58642644a520', NULL, 'no_setup', 'No setup', 'moderate', 1.0000, true, false, 3),
	('019fd76f-1f76-7b7b-b40b-586587215439', NULL, 'revenge_trade', 'Revenge trade', 'moderate', 1.0000, true, false, 4),
	('019fd76f-1f76-7b7b-b40b-58668a23e267', NULL, 'chased_entry', 'Chased entry', 'moderate', 1.0000, true, false, 5),
	('019fd76f-1f77-7dce-b59d-b0af9e8c3cc8', NULL, 'ignored_invalidation', 'Ignored invalidation', 'moderate', 1.0000, true, false, 6),
	('019fd76f-1f77-7dce-b59d-b0b0c43f0a1a', NULL, 'moved_target', 'Moved target', 'moderate', 1.0000, true, false, 7),
	('019fd76f-1f77-7dce-b59d-b0b19f89e886', NULL, 'no_stop', 'No stop', 'moderate', 1.0000, true, false, 8)
ON CONFLICT ("key") WHERE "is_system" DO NOTHING;