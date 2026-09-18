-- Add Trade contract v1 — After Trade (docs/product-contracts/add-trade.md §5, §8–§13).
--
-- Additive and corrective only: no existing row changes meaning, and nothing
-- legacy becomes contract-era evidence.
--   * trader_outcome_selected_at — a Trader Outcome the trader chose. Every
--     existing stored outcome stays derived (NULL here), i.e. legacy provenance.
--   * trades_status_consistency_check — one new closed shape for contract rows,
--     where the outcome is Unanswered or selected and independent of P&L and R.
--     The legacy shapes are unchanged.
--   * trades_planned_money_check — on a contract row a Target Profit may exist
--     without a Risk at Entry (both are optional in After Trade). Unchanged for
--     legacy rows.
--   * trade_exits — an explicit `unknown` scope and a valid reason-only exit.
--   * trade_setup_condition_checks — an explicit `unknown` ("Don't remember").
--   * trade_emotions.phase — Post-Trade Emotion beside Entry Emotion. Every
--     existing row is backfilled by the column default to `entry`.
--
-- Hand-edited: drizzle-kit emitted the new primary key before the `phase`
-- column it names existed; the column is added first here.
ALTER TABLE "trades" DROP CONSTRAINT "trades_planned_money_check";--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_status_consistency_check";--> statement-breakpoint
ALTER TABLE "trade_exits" DROP CONSTRAINT "trade_exits_scope_check";--> statement-breakpoint
ALTER TABLE "trade_exits" DROP CONSTRAINT "trade_exits_evidence_present_check";--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" DROP CONSTRAINT "trade_setup_condition_checks_status_check";--> statement-breakpoint
ALTER TABLE "trade_emotions" ADD COLUMN "phase" text DEFAULT 'entry' NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_emotions" DROP CONSTRAINT "trade_emotions_trade_id_emotion_type_id_pk";--> statement-breakpoint
ALTER TABLE "trade_emotions" ADD CONSTRAINT "trade_emotions_trade_id_emotion_type_id_phase_pk" PRIMARY KEY("trade_id","emotion_type_id","phase");--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "post_trade_emotions_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "trader_outcome_selected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_trader_outcome_selection_check" CHECK ("trades"."trader_outcome_selected_at" IS NULL OR (
        "trades"."recording_contract" IS NOT NULL
        AND "trades"."trader_outcome" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_post_trade_emotions_check" CHECK ("trades"."post_trade_emotions_recorded_at" IS NULL OR "trades"."recording_contract" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_planned_money_check" CHECK (("trades"."planned_risk_minor" IS NULL OR "trades"."planned_risk_minor" > 0)
        AND ("trades"."planned_reward_minor" IS NULL OR "trades"."planned_reward_minor" >= 0)
        AND (
          "trades"."planned_reward_minor" IS NULL
          OR "trades"."planned_risk_minor" IS NOT NULL
          OR "trades"."recording_contract" IS NOT NULL
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
        AND ("trades"."entered_at" IS NOT NULL OR "trades"."recording_contract" IS NOT NULL)
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
            AND (
              "trades"."actual_initial_risk_minor" IS NOT NULL
              OR ("trades"."recording_contract" IS NOT NULL AND "trades"."planned_risk_minor" IS NOT NULL)
            )
          )
        )
      ) OR (
        "trades"."status" = 'closed'
        AND (
          (
            "trades"."actual_r" IS NULL
            AND "trades"."trader_outcome" IS NULL
          ) OR (
            "trades"."actual_result_mode" = 'money'
            AND "trades"."actual_initial_risk_minor" IS NULL
            AND "trades"."net_pnl_minor" IS NOT NULL
            AND "trades"."actual_r" IS NULL
            AND (
              ("trades"."net_pnl_minor" > 0 AND "trades"."trader_outcome" = 'win')
              OR ("trades"."net_pnl_minor" < 0 AND "trades"."trader_outcome" = 'loss')
              OR ("trades"."net_pnl_minor" = 0 AND "trades"."trader_outcome" = 'break_even')
            )
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
                AND (
                  "trades"."actual_initial_risk_minor" IS NOT NULL
                  OR ("trades"."recording_contract" IS NOT NULL AND "trades"."planned_risk_minor" IS NOT NULL)
                )
                AND "trades"."net_pnl_minor" IS NOT NULL
              )
            )
          ) OR (
            "trades"."recording_contract" IS NOT NULL
            AND ("trades"."trader_outcome" IS NULL OR "trades"."trader_outcome_selected_at" IS NOT NULL)
            AND "trades"."actual_result_mode" IS NOT DISTINCT FROM 'money'
            AND (
              "trades"."actual_r" IS NULL
              OR ("trades"."net_pnl_minor" IS NOT NULL AND "trades"."planned_risk_minor" IS NOT NULL)
            )
          )
        )
      ) OR (
        "trades"."status" = 'canceled'
      ));--> statement-breakpoint
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_scope_check" CHECK ("trade_exits"."exit_scope" IS NULL OR "trade_exits"."exit_scope" IN ('part', 'all_remaining', 'unknown'));--> statement-breakpoint
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_evidence_present_check" CHECK ("trade_exits"."exit_scope" IS NOT NULL
        OR "trade_exits"."closed_bps" IS NOT NULL
        OR "trade_exits"."exited_at" IS NOT NULL
        OR "trade_exits"."exit_price" IS NOT NULL
        OR "trade_exits"."realized_pnl_minor" IS NOT NULL
        OR "trade_exits"."exit_reason" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD CONSTRAINT "trade_setup_condition_checks_status_check" CHECK ("trade_setup_condition_checks"."check_status" IN ('met', 'not_met', 'unknown'));--> statement-breakpoint
ALTER TABLE "trade_emotions" ADD CONSTRAINT "trade_emotions_phase_check" CHECK ("trade_emotions"."phase" IN ('entry', 'post_trade'));