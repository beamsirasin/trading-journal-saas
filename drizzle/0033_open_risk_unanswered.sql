-- Risk is Required for completion, not for saving an Open Trade (Add Trade
-- contract decision 59).
--
-- Decision 54 made Record Open refuse a Save until the trader answered the
-- risk decision, and two constraints enforced it: the Open Money shape of
-- trades_status_consistency_check and trades_contract_open_risk_check.
-- Decision 59 separates saving from completing: an Open contract Trade may be
-- saved with Risk Unanswered (planned_risk_state and planned_risk_minor both
-- NULL), and the Risk decision is asked again before Final Close.
--
-- One clause is added to each constraint for exactly that state. A Defined
-- Risk still needs its amount (trades_planned_risk_state_check, unchanged),
-- No Defined Risk still has none, and every other shape is recreated exactly
-- as migration 0031 left it. Nothing is read, rewritten or backfilled.
ALTER TABLE "trades" DROP CONSTRAINT "trades_status_consistency_check";--> statement-breakpoint
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
              OR ("trades"."recording_contract" IS NOT NULL AND "trades"."planned_risk_state" = 'no_defined')
              OR ("trades"."recording_contract" IS NOT NULL AND "trades"."planned_risk_state" IS NULL AND "trades"."planned_risk_minor" IS NULL)
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
ALTER TABLE "trades" DROP CONSTRAINT "trades_contract_open_risk_check";--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_contract_open_risk_check" CHECK ("trades"."recording_contract" IS NULL OR (
        "trades"."status" <> 'planned'
        AND (
          "trades"."status" <> 'open'
          OR "trades"."planned_risk_minor" IS NOT NULL
          OR "trades"."planned_risk_state" = 'no_defined'
          OR ("trades"."planned_risk_state" IS NULL AND "trades"."planned_risk_minor" IS NULL)
        )
      ));
