-- Record Exit / Final Close for Add Trade contract Trades (contract §10–§12).
--
-- 1. Exit idempotency that checks what was said, not only which key was used.
--    Each exit leg is recorded under a Save key (`trade_exits.mutation_key`,
--    already unique per workspace). `mutation_fingerprint` stores a SHA-256 of
--    the canonical exit request, so a replay whose content differs is refused
--    as a replay conflict rather than answered with the first result — the
--    same rule migration 0024 gave Trade creation. Additive and nullable:
--    every exit recorded before this migration keeps NULL, and a replay of one
--    of those keys is unverifiable.
--
-- 2. The live exit guards stop imposing the legacy exit shape on contract
--    Trades. Migration 0019 required every exit of an Open Trade to carry an
--    exit time, a closed percentage and a mode-specific result (P&L in Money
--    mode, price in Price mode), and every allocation of an Open Trade to be
--    known. The contract makes each of those answers optional on a live exit
--    ("missing price, time or percentage does not make an exit invalid", §10).
--    For a Trade with `recording_contract = 'add_trade_v1'` only the checks
--    that still hold are kept: same workspace, never before entry when both
--    times are known, never more than the whole position, and an Open Trade's
--    KNOWN allocations stay below the whole position (only All Remaining
--    closes it). Legacy Trades (`recording_contract IS NULL`) keep exactly the
--    0019 rules. No row is read, rewritten or backfilled.
ALTER TABLE "trade_exits" ADD COLUMN "mutation_fingerprint" text;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "trade_exits_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	parent_workspace uuid;
	parent_status text;
	parent_mode text;
	parent_entered_at timestamptz;
	parent_contract text;
	other_bps integer;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW."id" <> OLD."id" OR NEW."workspace_id" <> OLD."workspace_id"
		OR NEW."trade_id" <> OLD."trade_id" OR NEW."mutation_key" <> OLD."mutation_key"
		OR NEW."sequence" <> OLD."sequence"
	) THEN
		RAISE EXCEPTION 'trade exit identity fields are immutable' USING ERRCODE = '23514';
	END IF;

	SELECT "workspace_id", "status", "actual_result_mode", "entered_at", "recording_contract"
	INTO parent_workspace, parent_status, parent_mode, parent_entered_at, parent_contract
	FROM "trades" WHERE "id" = NEW."trade_id" FOR UPDATE;

	IF parent_workspace IS NULL OR parent_workspace <> NEW."workspace_id" THEN
		RAISE EXCEPTION 'trade exit belongs to another workspace' USING ERRCODE = '23514';
	END IF;

	IF parent_status = 'open' AND parent_contract IS NULL THEN
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
CREATE OR REPLACE FUNCTION "trade_execution_consistency_deferred"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	target_trade_id uuid;
	parent_status text;
	parent_history_completeness text;
	parent_pnl_source text;
	parent_net_pnl bigint;
	parent_contract text;
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

	SELECT "status", "exit_history_completeness", "final_pnl_source", "net_pnl_minor", "recording_contract"
	INTO parent_status, parent_history_completeness, parent_pnl_source, parent_net_pnl, parent_contract
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

	IF parent_status = 'open' AND parent_contract IS NULL
		AND (unknown_allocation_count <> 0 OR total_bps >= 10000) THEN
		RAISE EXCEPTION 'open Trade must have known allocation below 10000 basis points' USING ERRCODE = '23514';
	ELSIF parent_status = 'open' AND parent_contract IS NOT NULL AND total_bps >= 10000 THEN
		RAISE EXCEPTION 'open Trade known allocation must stay below 10000 basis points' USING ERRCODE = '23514';
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
