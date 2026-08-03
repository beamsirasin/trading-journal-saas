CREATE TABLE "trading_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"broker_name" text,
	"platform_name" text,
	"account_mode" text NOT NULL,
	"base_currency" text NOT NULL,
	"starting_balance" numeric(20, 10) NOT NULL,
	"timezone" text NOT NULL,
	"risk_per_trade_percent" numeric(12, 4),
	"maximum_daily_loss_percent" numeric(12, 4),
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_accounts_account_mode_check" CHECK ("trading_accounts"."account_mode" IN ('live', 'demo', 'prop', 'backtest')),
	CONSTRAINT "trading_accounts_base_currency_check" CHECK ("trading_accounts"."base_currency" ~ '^[A-Z0-9]{2,10}$'),
	CONSTRAINT "trading_accounts_starting_balance_check" CHECK ("trading_accounts"."starting_balance" >= 0),
	CONSTRAINT "trading_accounts_risk_per_trade_percent_check" CHECK ("trading_accounts"."risk_per_trade_percent" IS NULL OR ("trading_accounts"."risk_per_trade_percent" > 0 AND "trading_accounts"."risk_per_trade_percent" <= 100)),
	CONSTRAINT "trading_accounts_maximum_daily_loss_percent_check" CHECK ("trading_accounts"."maximum_daily_loss_percent" IS NULL OR ("trading_accounts"."maximum_daily_loss_percent" > 0 AND "trading_accounts"."maximum_daily_loss_percent" <= 100))
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "active_trading_account_id" uuid;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trading_accounts_workspace_idx" ON "trading_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "trading_accounts_workspace_archived_idx" ON "trading_accounts" USING btree ("workspace_id","is_archived");--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("active_trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE set null ON UPDATE no action;