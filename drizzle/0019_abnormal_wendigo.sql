ALTER TABLE "trades" DROP CONSTRAINT "trades_status_consistency_check";--> statement-breakpoint
ALTER TABLE "trade_exits" DROP CONSTRAINT "trade_exits_result_present_check";--> statement-breakpoint
ALTER TABLE "trade_exits" DROP CONSTRAINT "trade_exits_closed_bps_check";--> statement-breakpoint
ALTER TABLE "trade_exits" ALTER COLUMN "closed_bps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_exits" ALTER COLUMN "exited_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_history_completeness" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "final_pnl_source" text;--> statement-breakpoint
ALTER TABLE "trade_exits" ADD COLUMN "exit_scope" text;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_history_completeness_check" CHECK ("trades"."exit_history_completeness" IS NULL OR "trades"."exit_history_completeness" IN (
        'unknown', 'incomplete', 'complete'
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_final_pnl_source_check" CHECK ("trades"."final_pnl_source" IS NULL OR "trades"."final_pnl_source" IN (
        'manual_total', 'exit_history'
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_historical_execution_metadata_check" CHECK ((
        "trades"."exit_history_completeness" IS NULL AND "trades"."final_pnl_source" IS NULL
      ) OR (
        "trades"."status" = 'closed'
        AND ("trades"."final_pnl_source" IS NULL OR "trades"."net_pnl_minor" IS NOT NULL)
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
        AND (
          (
            "trades"."actual_r" IS NULL
            AND "trades"."trader_outcome" IS NULL
          ) OR (
            "trades"."actual_r" IS NOT NULL
            AND "trades"."trader_outcome" IS NOT NULL
            AND (
              ("trades"."actual_r" > 0.0500 AND "trades"."trader_outcome" = 'win')
              OR ("trades"."actual_r" < -0.0500 AND "trades"."trader_outcome" = 'loss')
              OR (
                "trades"."actual_r" BETWEEN -0.0500 AND 0.0500
                AND "trades"."trader_outcome" = 'break_even'
              )
            )
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
          )
        )
      ) OR (
        "trades"."status" = 'canceled'
      ));--> statement-breakpoint
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_scope_check" CHECK ("trade_exits"."exit_scope" IS NULL OR "trade_exits"."exit_scope" IN ('part', 'all_remaining'));--> statement-breakpoint
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_evidence_present_check" CHECK ("trade_exits"."exit_scope" IS NOT NULL
        OR "trade_exits"."closed_bps" IS NOT NULL
        OR "trade_exits"."exited_at" IS NOT NULL
        OR "trade_exits"."exit_price" IS NOT NULL
        OR "trade_exits"."realized_pnl_minor" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_closed_bps_check" CHECK ("trade_exits"."closed_bps" IS NULL OR ("trade_exits"."closed_bps" > 0 AND "trade_exits"."closed_bps" <= 10000));
--> statement-breakpoint
-- Historical closed exits may omit facts. Live/open execution retains the
-- strict timestamp, allocation, and mode-specific evidence contract.
CREATE OR REPLACE FUNCTION "trade_exits_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	parent_workspace uuid;
	parent_status text;
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

	SELECT "workspace_id", "status", "actual_result_mode", "entered_at"
	INTO parent_workspace, parent_status, parent_mode, parent_entered_at
	FROM "trades" WHERE "id" = NEW."trade_id" FOR UPDATE;

	IF parent_workspace IS NULL OR parent_workspace <> NEW."workspace_id" THEN
		RAISE EXCEPTION 'trade exit belongs to another workspace' USING ERRCODE = '23514';
	END IF;

	IF parent_status = 'open' THEN
		IF parent_entered_at IS NULL OR NEW."exited_at" IS NULL OR NEW."exited_at" < parent_entered_at THEN
			RAISE EXCEPTION 'live trade exit requires a valid timestamp after actual entry' USING ERRCODE = '23514';
		END IF;
		IF NEW."closed_bps" IS NULL THEN
			RAISE EXCEPTION 'live trade exit requires closed basis points' USING ERRCODE = '23514';
		END IF;
		IF parent_mode = 'price' AND (NEW."exit_price" IS NULL OR NEW."realized_pnl_minor" IS NOT NULL) THEN
			RAISE EXCEPTION 'price-mode exit has invalid result shape' USING ERRCODE = '23514';
		ELSIF parent_mode = 'money' AND NEW."realized_pnl_minor" IS NULL THEN
			RAISE EXCEPTION 'money-mode exit has invalid result shape' USING ERRCODE = '23514';
		ELSIF parent_mode IS NULL THEN
			RAISE EXCEPTION 'live trade exit requires an Actual result mode' USING ERRCODE = '23514';
		END IF;
	ELSIF parent_entered_at IS NOT NULL
		AND NEW."exited_at" IS NOT NULL
		AND NEW."exited_at" < parent_entered_at THEN
		RAISE EXCEPTION 'trade exit precedes actual entry' USING ERRCODE = '23514';
	END IF;

	SELECT COALESCE(SUM("closed_bps"), 0)::integer INTO other_bps
	FROM "trade_exits"
	WHERE "trade_id" = NEW."trade_id" AND (TG_OP = 'INSERT' OR "id" <> OLD."id");
	IF NEW."closed_bps" IS NOT NULL AND other_bps + NEW."closed_bps" > 10000 THEN
		RAISE EXCEPTION 'trade exits exceed 10000 closed basis points' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Closed lifecycle state is independent of exit reconstruction. Only a claim
-- that canonical P&L came from exit history requires complete matching rows.
CREATE OR REPLACE FUNCTION "trade_execution_consistency_deferred"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	target_trade_id uuid;
	parent_status text;
	parent_history_completeness text;
	parent_pnl_source text;
	parent_net_pnl bigint;
	exit_count integer;
	unknown_allocation_count integer;
	unknown_pnl_count integer;
	total_bps integer;
	exit_pnl_subtotal numeric;
BEGIN
	IF TG_TABLE_NAME = 'trades' THEN
		target_trade_id := NEW."id";
	ELSIF TG_OP = 'DELETE' THEN
		target_trade_id := OLD."trade_id";
	ELSE
		target_trade_id := NEW."trade_id";
	END IF;

	SELECT "status", "exit_history_completeness", "final_pnl_source", "net_pnl_minor"
	INTO parent_status, parent_history_completeness, parent_pnl_source, parent_net_pnl
	FROM "trades" WHERE "id" = target_trade_id;
	IF parent_status IS NULL THEN RETURN NULL; END IF;

	SELECT
		COUNT(*)::integer,
		COUNT(*) FILTER (WHERE "closed_bps" IS NULL)::integer,
		COUNT(*) FILTER (WHERE "realized_pnl_minor" IS NULL)::integer,
		COALESCE(SUM("closed_bps"), 0)::integer,
		COALESCE(SUM("realized_pnl_minor"), 0)
	INTO exit_count, unknown_allocation_count, unknown_pnl_count, total_bps, exit_pnl_subtotal
	FROM "trade_exits" WHERE "trade_id" = target_trade_id;

	IF parent_status = 'open' AND (unknown_allocation_count <> 0 OR total_bps >= 10000) THEN
		RAISE EXCEPTION 'open Trade must have known allocation below 10000 basis points' USING ERRCODE = '23514';
	ELSIF parent_status IN ('planned', 'canceled') AND exit_count <> 0 THEN
		RAISE EXCEPTION 'non-executing Trade cannot have Exit rows' USING ERRCODE = '23514';
	ELSIF parent_pnl_source = 'exit_history' AND (
		parent_status <> 'closed'
		OR parent_history_completeness <> 'complete'
		OR parent_net_pnl IS NULL
		OR exit_count = 0
		OR unknown_pnl_count <> 0
		OR exit_pnl_subtotal <> parent_net_pnl
	) THEN
		RAISE EXCEPTION 'exit-history P&L source requires complete matching realized exit history' USING ERRCODE = '23514';
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER "trades_execution_consistency_trigger" ON "trades";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trades_execution_consistency_trigger"
AFTER INSERT OR UPDATE OF "status", "exit_history_completeness", "final_pnl_source", "net_pnl_minor" ON "trades"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "trade_execution_consistency_deferred"();
