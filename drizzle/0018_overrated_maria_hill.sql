ALTER TABLE "trades" DROP CONSTRAINT "trades_system_status_consistency_check";--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_system_status_consistency_check" CHECK ((
        "trades"."system_status" = 'pending'
        AND "trades"."system_cost_r" IS NULL
        AND "trades"."system_resolution_kind" IS NULL
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_gross_r_input" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" IS NULL
        AND "trades"."system_resolved_at" IS NULL
        AND "trades"."system_gross_r" IS NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
        AND "trades"."system_dependency_snapshot" IS NULL
      ) OR (
        "trades"."system_status" = 'cannot_determine'
        AND "trades"."system_cost_r" IS NULL
        AND "trades"."system_resolution_kind" IS NULL
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_gross_r_input" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" IS NULL
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_gross_r" IS NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
      ) OR (
        "trades"."system_status" = 'resolved'
        AND "trades"."system_exit_reason" IS NOT NULL
        AND "trades"."system_exit_reason" <> 'setup_invalidated'
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_resolution_kind" IS NOT NULL
        AND "trades"."system_gross_r" IS NOT NULL
        AND (
          "trades"."system_exit_reason" <> 'time_exit'
          OR "trades"."system_exited_at" IS NOT NULL
        )
        AND (
          (
            "trades"."system_cost_r" IS NOT NULL
            AND "trades"."system_r" IS NOT NULL
            AND "trades"."system_outcome" IS NOT NULL
            AND "trades"."system_r" = "trades"."system_gross_r" - "trades"."system_cost_r"
            AND (
              ("trades"."system_r" > 0.0500 AND "trades"."system_outcome" = 'win')
              OR ("trades"."system_r" < -0.0500 AND "trades"."system_outcome" = 'loss')
              OR (
                "trades"."system_r" BETWEEN -0.0500 AND 0.0500
                AND "trades"."system_outcome" = 'break_even'
              )
            )
          ) OR (
            "trades"."system_cost_r" IS NULL
            AND "trades"."system_r" IS NULL
            AND "trades"."system_outcome" IS NULL
          )
        )
        AND (
          (
            "trades"."system_resolution_kind" = 'price_exit'
            AND "trades"."system_exit_price" IS NOT NULL
            AND "trades"."system_gross_r_input" IS NULL
          ) OR (
            "trades"."system_resolution_kind" = 'money_target'
            AND "trades"."system_exit_price" IS NULL
            AND "trades"."system_gross_r_input" IS NOT NULL
            AND "trades"."system_gross_r_input" = "trades"."system_gross_r"
            AND "trades"."system_exit_reason" = 'target_hit'
          ) OR (
            "trades"."system_resolution_kind" = 'money_stop'
            AND "trades"."system_exit_price" IS NULL
            AND "trades"."system_gross_r_input" IS NOT NULL
            AND "trades"."system_gross_r_input" = -1
            AND "trades"."system_gross_r" = "trades"."system_gross_r_input"
            AND "trades"."system_exit_reason" = 'stop_hit'
          ) OR (
            "trades"."system_resolution_kind" = 'money_break_even'
            AND "trades"."system_exit_price" IS NULL
            AND "trades"."system_gross_r_input" IS NOT NULL
            AND "trades"."system_gross_r_input" = 0
            AND "trades"."system_gross_r" = "trades"."system_gross_r_input"
            AND "trades"."system_exit_reason" = 'break_even_rule'
          ) OR (
            "trades"."system_resolution_kind" = 'money_custom'
            AND "trades"."system_exit_price" IS NULL
            AND "trades"."system_gross_r_input" IS NOT NULL
            AND "trades"."system_gross_r" = "trades"."system_gross_r_input"
            AND "trades"."system_exit_reason" = 'manual_system_valid_exit'
          )
        )
      ) OR (
        "trades"."system_status" = 'no_trade'
        AND "trades"."system_cost_r" IS NULL
        AND "trades"."system_resolution_kind" IS NULL
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_gross_r_input" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" = 'setup_invalidated'
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_gross_r" IS NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
      ));