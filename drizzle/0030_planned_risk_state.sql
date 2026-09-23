-- Planned Risk is an explicit decision (Add Trade contract §4, decision 54).
--
-- Additive, plus one relaxed constraint. Nothing is read, rewritten or
-- backfilled.
--
-- WHAT THE TRADER DECIDED ABOUT RISK BEFORE ENTRY, in three states that must
-- never collapse into each other:
--
--   NULL          Unanswered — nobody said. Never "no defined risk".
--   'defined'     A planned 1R was decided, and `planned_risk_minor` holds it.
--   'no_defined'  An explicit answer that no 1R was defined. No amount exists,
--                 and no R / RR comparison can ever be built for this Trade.
--
-- IT IS NEVER INFERRED FROM PRICE. `context_stop_price` stays Price Context: an
-- SL price neither creates a Defined Risk nor proves the absence of one, and
-- Money remains the authoritative representation (§3).
--
-- 1. trades_planned_risk_state_check — contract rows only, and the state and
--    the amount must agree: Defined carries an amount, No Defined Risk carries
--    none. A historical contract row has NULL state and keeps its amount, so
--    it satisfies this check untouched.
-- 2. trades_contract_open_risk_check — an Open contract Trade used to require
--    `planned_risk_minor`. It now requires an explicit risk DECISION instead:
--    an amount (every row written before this migration, and every Defined
--    Risk after it) or an explicit No Defined Risk.
ALTER TABLE "trades" ADD COLUMN "planned_risk_state" text;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_planned_risk_state_check" CHECK ("trades"."planned_risk_state" IS NULL OR (
        "trades"."recording_contract" IS NOT NULL
        AND (
          ("trades"."planned_risk_state" = 'defined' AND "trades"."planned_risk_minor" IS NOT NULL)
          OR ("trades"."planned_risk_state" = 'no_defined' AND "trades"."planned_risk_minor" IS NULL)
        )
      ));--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_contract_open_risk_check";--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_contract_open_risk_check" CHECK ("trades"."recording_contract" IS NULL OR (
        "trades"."status" <> 'planned'
        AND (
          "trades"."status" <> 'open'
          OR "trades"."planned_risk_minor" IS NOT NULL
          OR "trades"."planned_risk_state" = 'no_defined'
        )
      ));
