ALTER TABLE "trades" DROP CONSTRAINT "trades_planned_price_direction_check";--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_confidence_check";--> statement-breakpoint
-- Confidence backfill: 1-5 -> exactly one of 0/25/50/75/100 (Founder-UAT
-- Confidence redesign). Migration 0010 has not been committed/merged yet,
-- so this backfill was updated IN PLACE rather than superseded by a new
-- migration -- this replaces an earlier uncommitted draft that mapped to a
-- continuous 10/30/50/70/90 midpoint scheme; that mapping is superseded and
-- must not be reintroduced. Must run while no CHECK constrains "confidence"
-- (the old 1-5 check was just dropped above; the new five-step check is
-- added at the end of this migration), and before the new check is added,
-- so this is never momentarily invalid under either constraint.
UPDATE "trades" SET "confidence" = CASE "confidence"
  WHEN 1 THEN 0
  WHEN 2 THEN 25
  WHEN 3 THEN 50
  WHEN 4 THEN 75
  WHEN 5 THEN 100
  ELSE "confidence"
END
WHERE "confidence" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "planned_entry" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "planned_stop" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "chart_attachment_storage_key" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "chart_attachment_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "planned_risk_minor" bigint;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "planned_reward_minor" bigint;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_planned_price_shape_check" CHECK ((
        "trades"."planned_entry" IS NULL AND "trades"."planned_stop" IS NULL AND "trades"."planned_target" IS NULL
      ) OR (
        "trades"."planned_entry" IS NOT NULL AND "trades"."planned_stop" IS NOT NULL
        AND (
          (
            "trades"."direction" = 'long'
            AND "trades"."planned_stop" < "trades"."planned_entry"
            AND ("trades"."planned_target" IS NULL OR "trades"."planned_target" > "trades"."planned_entry")
          ) OR (
            "trades"."direction" = 'short'
            AND "trades"."planned_stop" > "trades"."planned_entry"
            AND ("trades"."planned_target" IS NULL OR "trades"."planned_target" < "trades"."planned_entry")
          )
        )
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_planned_money_check" CHECK (("trades"."planned_risk_minor" IS NULL OR "trades"."planned_risk_minor" > 0)
        AND ("trades"."planned_reward_minor" IS NULL OR "trades"."planned_reward_minor" >= 0)
        AND ("trades"."planned_reward_minor" IS NULL OR "trades"."planned_risk_minor" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_plan_minimum_check" CHECK (("trades"."planned_entry" IS NOT NULL AND "trades"."planned_stop" IS NOT NULL)
        OR "trades"."planned_risk_minor" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_chart_attachment_check" CHECK ((
        "trades"."chart_attachment_storage_key" IS NULL
        AND "trades"."chart_attachment_uploaded_at" IS NULL
      ) OR (
        "trades"."chart_attachment_storage_key" IS NOT NULL
        AND "trades"."chart_attachment_uploaded_at" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_confidence_check" CHECK ("trades"."confidence" IS NULL OR "trades"."confidence" IN (0, 25, 50, 75, 100));