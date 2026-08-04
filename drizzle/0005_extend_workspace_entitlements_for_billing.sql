ALTER TABLE "workspace_entitlements" DROP CONSTRAINT "workspace_entitlements_status_check";--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "current_period_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "billing_currency" text;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "billing_interval" text;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "pending_plan_key" text;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "pending_plan_effective_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "provider_kind" text;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "provider_customer_id" text;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD COLUMN "provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_billing_currency_check" CHECK ("workspace_entitlements"."billing_currency" IS NULL OR "workspace_entitlements"."billing_currency" IN ('THB', 'USD'));--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_billing_interval_check" CHECK ("workspace_entitlements"."billing_interval" IS NULL OR "workspace_entitlements"."billing_interval" = 'monthly');--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_pending_plan_key_check" CHECK ("workspace_entitlements"."pending_plan_key" IS NULL OR "workspace_entitlements"."pending_plan_key" IN ('starter', 'trader', 'professional'));--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_period_order_check" CHECK ("workspace_entitlements"."current_period_started_at" IS NULL OR "workspace_entitlements"."current_period_ends_at" IS NULL OR "workspace_entitlements"."current_period_started_at" <= "workspace_entitlements"."current_period_ends_at");--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_cancel_period_check" CHECK (NOT "workspace_entitlements"."cancel_at_period_end" OR "workspace_entitlements"."current_period_ends_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_pending_plan_pair_check" CHECK (("workspace_entitlements"."pending_plan_key" IS NULL AND "workspace_entitlements"."pending_plan_effective_at" IS NULL) OR ("workspace_entitlements"."pending_plan_key" IS NOT NULL AND "workspace_entitlements"."pending_plan_effective_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_status_check" CHECK ("workspace_entitlements"."status" IN ('trialing', 'active', 'past_due', 'expired', 'canceled'));