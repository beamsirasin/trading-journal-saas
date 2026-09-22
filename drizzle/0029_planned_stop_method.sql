-- Planned Stop Method (Add Trade contract §4, decision 53; UX Rules §20.4).
--
-- Additive only; nothing is read, rewritten or backfilled.
--
-- HOW THE TRADER PLANNED TO PROTECT THE TRADE, as a plan fact recorded before
-- entry beside Risk at Entry, the Target and the Exit Plan:
--
--   NULL        Unanswered — nobody said. It is NOT "no defined stop".
--   'broker'    A stop order resting with the broker.
--   'mental'    A planned manual stop, with no broker-side order.
--   'no_stop'   An explicit answer that there was no defined stop approach.
--
-- IT IS NEVER INFERRED. `context_stop_price` stays Price Context: an SL price
-- says where a stop would sit, never whether one was placed, so a row may hold
-- either, both or neither. No System Result, risk amount or adherence figure
-- is derived from this column in this slice.
--
-- Contract rows only, like every other Add Trade contract column.
ALTER TABLE "trades" ADD COLUMN "planned_stop_method" text;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_planned_stop_method_check" CHECK ("trades"."planned_stop_method" IS NULL OR (
        "trades"."recording_contract" IS NOT NULL
        AND "trades"."planned_stop_method" IN ('broker', 'mental', 'no_stop')
      ));
