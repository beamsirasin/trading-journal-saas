-- An explicit No Defined Risk opens a Trade (Add Trade contract decision 54).
--
-- Migration 0030 let an Open contract Trade exist without `planned_risk_minor`
-- when the trader answered No Defined Risk, in `trades_contract_open_risk_check`.
-- A second constraint still said the opposite: the Open Money shape of
-- `trades_status_consistency_check` demanded a 1R (`actual_initial_risk_minor`,
-- or a contract row's `planned_risk_minor`). A No Defined Risk At Entry Save
-- therefore reached the database and was refused there.
--
-- One clause is added to the Open Money shape: a contract row whose trader
-- explicitly answered No Defined Risk. Unanswered (NULL) is not that answer
-- and stays refused. Every other shape is recreated exactly as migration 0023
-- left it. Nothing is read, rewritten or backfilled.
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
      ));
