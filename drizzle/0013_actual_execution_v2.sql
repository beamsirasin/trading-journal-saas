CREATE TABLE "trade_exits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"mutation_key" uuid NOT NULL,
	"sequence" smallint NOT NULL,
	"closed_bps" integer NOT NULL,
	"exit_price" numeric(20, 10),
	"realized_pnl_minor" bigint,
	"exit_reason" text,
	"exited_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_exits_sequence_check" CHECK ("trade_exits"."sequence" > 0),
	CONSTRAINT "trade_exits_closed_bps_check" CHECK ("trade_exits"."closed_bps" > 0 AND "trade_exits"."closed_bps" <= 10000),
	CONSTRAINT "trade_exits_result_present_check" CHECK ("trade_exits"."exit_price" IS NOT NULL OR "trade_exits"."realized_pnl_minor" IS NOT NULL),
	CONSTRAINT "trade_exits_reason_not_blank_check" CHECK ("trade_exits"."exit_reason" IS NULL OR btrim("trade_exits"."exit_reason") <> '')
);
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_status_consistency_check";--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "actual_result_mode" text;--> statement-breakpoint
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_trade_workspace_fk" FOREIGN KEY ("trade_id","workspace_id") REFERENCES "public"."trades"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_exits_trade_sequence_idx" ON "trade_exits" USING btree ("trade_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_exits_workspace_mutation_key_idx" ON "trade_exits" USING btree ("workspace_id","mutation_key");--> statement-breakpoint
CREATE INDEX "trade_exits_workspace_trade_idx" ON "trade_exits" USING btree ("workspace_id","trade_id");--> statement-breakpoint
-- Legacy V1 open/closed Trades were necessarily Money-authoritative: the
-- pre-0013 CHECK requires monetary risk, and the only close calculator was
-- net_pnl_minor / actual_initial_risk_minor.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "trades" WHERE "status" = 'open' AND ("actual_initial_risk_minor" IS NULL OR "entered_at" IS NULL)) THEN
		RAISE EXCEPTION '0013 cannot truthfully classify a legacy open Trade';
	END IF;
	IF EXISTS (SELECT 1 FROM "trades" WHERE "status" = 'closed' AND ("actual_initial_risk_minor" IS NULL OR "net_pnl_minor" IS NULL OR "actual_r" IS NULL OR "trader_outcome" IS NULL OR "exited_at" IS NULL)) THEN
		RAISE EXCEPTION '0013 cannot truthfully backfill a legacy closed Trade';
	END IF;
END;
$$;
--> statement-breakpoint
UPDATE "trades" SET "actual_result_mode" = 'money' WHERE "status" IN ('open', 'closed');
--> statement-breakpoint
-- Mechanical, values-preserving normalization of every V1 one-shot close.
INSERT INTO "trade_exits" ("id", "workspace_id", "trade_id", "mutation_key", "sequence", "closed_bps", "exit_price", "realized_pnl_minor", "exit_reason", "exited_at", "created_at", "updated_at")
SELECT gen_random_uuid(), "workspace_id", "id", gen_random_uuid(), 1, 10000, "actual_exit", "net_pnl_minor", NULL, "exited_at", "created_at", "updated_at"
FROM "trades"
WHERE "status" = 'closed' AND "net_pnl_minor" IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM "trade_exits" WHERE "trade_exits"."trade_id" = "trades"."id");
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_actual_result_mode_check" CHECK ("trades"."actual_result_mode" IS NULL OR "trades"."actual_result_mode" IN ('price', 'money'));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_actual_price_shape_check" CHECK ((
        "trades"."actual_entry" IS NULL AND "trades"."actual_initial_stop" IS NULL
      ) OR (
        "trades"."actual_entry" IS NOT NULL AND "trades"."actual_initial_stop" IS NOT NULL
        AND (
          ("trades"."direction" = 'long' AND "trades"."actual_initial_stop" < "trades"."actual_entry")
          OR ("trades"."direction" = 'short' AND "trades"."actual_initial_stop" > "trades"."actual_entry")
        )
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_status_consistency_check" CHECK ((
        "trades"."status" = 'planned'
        AND "trades"."actual_result_mode" IS NULL
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
        AND "trades"."actual_result_mode" IS NOT NULL
        AND "trades"."entered_at" IS NOT NULL
        AND "trades"."actual_exit" IS NULL
        AND "trades"."net_pnl_minor" IS NULL
        AND "trades"."exited_at" IS NULL
        AND "trades"."actual_r" IS NULL
        AND "trades"."trader_outcome" IS NULL
        AND (
          (
            "trades"."actual_result_mode" = 'price'
            AND "trades"."actual_entry" IS NOT NULL
            AND "trades"."actual_initial_stop" IS NOT NULL
            AND "trades"."actual_initial_risk_minor" IS NULL
          ) OR (
            "trades"."actual_result_mode" = 'money'
            AND "trades"."actual_initial_risk_minor" IS NOT NULL
          )
        )
      ) OR (
        "trades"."status" = 'closed'
        AND "trades"."actual_result_mode" IS NOT NULL
        AND "trades"."entered_at" IS NOT NULL
        AND "trades"."exited_at" IS NOT NULL
        AND "trades"."actual_r" IS NOT NULL
        AND "trades"."trader_outcome" IS NOT NULL
        AND (
          (
            "trades"."actual_result_mode" = 'price'
            AND "trades"."actual_entry" IS NOT NULL
            AND "trades"."actual_initial_stop" IS NOT NULL
            AND "trades"."actual_initial_risk_minor" IS NULL
            AND "trades"."net_pnl_minor" IS NULL
            AND "trades"."actual_exit" IS NOT NULL
          ) OR (
            "trades"."actual_result_mode" = 'money'
            AND "trades"."actual_initial_risk_minor" IS NOT NULL
            AND "trades"."net_pnl_minor" IS NOT NULL
          )
        )
      ) OR (
        "trades"."status" = 'canceled'
      ));
--> statement-breakpoint
CREATE FUNCTION "trade_exits_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	parent_workspace uuid;
	parent_mode text;
	parent_entered_at timestamptz;
	other_bps integer;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW."id" <> OLD."id" OR NEW."workspace_id" <> OLD."workspace_id"
		OR NEW."trade_id" <> OLD."trade_id" OR NEW."mutation_key" <> OLD."mutation_key"
		OR NEW."sequence" <> OLD."sequence"
	) THEN
		RAISE EXCEPTION 'trade exit identity fields are immutable' USING ERRCODE = '23514';
	END IF;
	SELECT "workspace_id", "actual_result_mode", "entered_at"
	INTO parent_workspace, parent_mode, parent_entered_at
	FROM "trades" WHERE "id" = NEW."trade_id" FOR UPDATE;
	IF parent_workspace IS NULL OR parent_workspace <> NEW."workspace_id" THEN
		RAISE EXCEPTION 'trade exit belongs to another workspace' USING ERRCODE = '23514';
	END IF;
	IF parent_entered_at IS NULL OR NEW."exited_at" < parent_entered_at THEN
		RAISE EXCEPTION 'trade exit precedes actual entry' USING ERRCODE = '23514';
	END IF;
	IF parent_mode = 'price' AND (NEW."exit_price" IS NULL OR NEW."realized_pnl_minor" IS NOT NULL) THEN
		RAISE EXCEPTION 'price-mode exit has invalid result shape' USING ERRCODE = '23514';
	ELSIF parent_mode = 'money' AND NEW."realized_pnl_minor" IS NULL THEN
		RAISE EXCEPTION 'money-mode exit has invalid result shape' USING ERRCODE = '23514';
	ELSIF parent_mode IS NULL THEN
		RAISE EXCEPTION 'trade exit requires an Actual result mode' USING ERRCODE = '23514';
	END IF;
	SELECT COALESCE(SUM("closed_bps"), 0)::integer INTO other_bps
	FROM "trade_exits"
	WHERE "trade_id" = NEW."trade_id" AND (TG_OP = 'INSERT' OR "id" <> OLD."id");
	IF other_bps + NEW."closed_bps" > 10000 THEN
		RAISE EXCEPTION 'trade exits exceed 10000 closed basis points' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trade_exits_guard_trigger"
BEFORE INSERT OR UPDATE ON "trade_exits"
FOR EACH ROW EXECUTE FUNCTION "trade_exits_guard"();
--> statement-breakpoint
CREATE FUNCTION "trade_execution_consistency_deferred"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	target_trade_id uuid;
	parent_status text;
	total_bps integer;
BEGIN
	IF TG_TABLE_NAME = 'trades' THEN
		target_trade_id := NEW."id";
	ELSIF TG_OP = 'DELETE' THEN
		target_trade_id := OLD."trade_id";
	ELSE
		target_trade_id := NEW."trade_id";
	END IF;
	SELECT "status" INTO parent_status FROM "trades" WHERE "id" = target_trade_id;
	IF parent_status IS NULL THEN RETURN NULL; END IF;
	SELECT COALESCE(SUM("closed_bps"), 0)::integer INTO total_bps FROM "trade_exits" WHERE "trade_id" = target_trade_id;
	IF parent_status = 'open' AND total_bps >= 10000 THEN
		RAISE EXCEPTION 'open Trade must have fewer than 10000 closed basis points' USING ERRCODE = '23514';
	ELSIF parent_status = 'closed' AND total_bps <> 10000 THEN
		RAISE EXCEPTION 'closed Trade must have exactly 10000 closed basis points' USING ERRCODE = '23514';
	ELSIF parent_status IN ('planned', 'canceled') AND total_bps <> 0 THEN
		RAISE EXCEPTION 'non-executing Trade cannot have Exit rows' USING ERRCODE = '23514';
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trade_exits_consistency_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "trade_exits"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "trade_execution_consistency_deferred"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trades_execution_consistency_trigger"
AFTER INSERT OR UPDATE OF "status" ON "trades"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "trade_execution_consistency_deferred"();
--> statement-breakpoint
CREATE FUNCTION "trades_actual_mode_immutability"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."actual_result_mode" IS DISTINCT FROM OLD."actual_result_mode"
		AND EXISTS (SELECT 1 FROM "trade_exits" WHERE "trade_id" = OLD."id") THEN
		RAISE EXCEPTION 'actual_result_mode is immutable after the first Exit' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trades_actual_mode_immutability_trigger"
BEFORE UPDATE OF "actual_result_mode" ON "trades"
FOR EACH ROW EXECUTE FUNCTION "trades_actual_mode_immutability"();
