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
                AND "trades"."actual_initial_risk_minor" IS NOT NULL
                AND "trades"."net_pnl_minor" IS NOT NULL
              )
            )
          )
        )
      ) OR (
        "trades"."status" = 'canceled'
      ));