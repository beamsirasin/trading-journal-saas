CREATE TABLE "billing_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"plan_key" text NOT NULL,
	"billing_currency" text NOT NULL,
	"billing_interval" text NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"vat_enabled" boolean NOT NULL,
	"applied_vat_rate_basis_points" integer NOT NULL,
	"vat_amount_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"tax_mode" text NOT NULL,
	"tax_jurisdiction" text,
	"vat_registration_number" text,
	"provider_kind" text,
	"provider_checkout_id" text,
	"provider_payment_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "billing_transactions_plan_key_check" CHECK ("billing_transactions"."plan_key" IN ('starter', 'trader', 'professional')),
	CONSTRAINT "billing_transactions_billing_currency_check" CHECK ("billing_transactions"."billing_currency" IN ('THB', 'USD')),
	CONSTRAINT "billing_transactions_billing_interval_check" CHECK ("billing_transactions"."billing_interval" = 'monthly'),
	CONSTRAINT "billing_transactions_status_check" CHECK ("billing_transactions"."status" IN ('created', 'pending', 'processing', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "billing_transactions_subtotal_check" CHECK ("billing_transactions"."subtotal_minor" >= 0),
	CONSTRAINT "billing_transactions_vat_amount_check" CHECK ("billing_transactions"."vat_amount_minor" >= 0),
	CONSTRAINT "billing_transactions_total_check" CHECK ("billing_transactions"."total_minor" >= 0),
	CONSTRAINT "billing_transactions_vat_rate_check" CHECK ("billing_transactions"."applied_vat_rate_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "billing_transactions_total_consistency_check" CHECK ("billing_transactions"."total_minor" = "billing_transactions"."subtotal_minor" + "billing_transactions"."vat_amount_minor"),
	CONSTRAINT "billing_transactions_vat_consistency_check" CHECK ((
        NOT "billing_transactions"."vat_enabled"
        AND "billing_transactions"."applied_vat_rate_basis_points" = 0
        AND "billing_transactions"."vat_amount_minor" = 0
        AND "billing_transactions"."tax_mode" = 'disabled'
      ) OR (
        "billing_transactions"."vat_enabled"
        AND "billing_transactions"."tax_mode" = 'exclusive'
      ))
);
--> statement-breakpoint
ALTER TABLE "billing_transactions" ADD CONSTRAINT "billing_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_transactions_workspace_created_idx" ON "billing_transactions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_transactions_workspace_idempotency_idx" ON "billing_transactions" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_transactions_provider_checkout_idx" ON "billing_transactions" USING btree ("provider_checkout_id") WHERE "billing_transactions"."provider_checkout_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_transactions_provider_payment_idx" ON "billing_transactions" USING btree ("provider_payment_id") WHERE "billing_transactions"."provider_payment_id" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION "billing_transactions_protect_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
		OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
		OR NEW."plan_key" IS DISTINCT FROM OLD."plan_key"
		OR NEW."billing_currency" IS DISTINCT FROM OLD."billing_currency"
		OR NEW."billing_interval" IS DISTINCT FROM OLD."billing_interval"
		OR NEW."subtotal_minor" IS DISTINCT FROM OLD."subtotal_minor"
		OR NEW."vat_enabled" IS DISTINCT FROM OLD."vat_enabled"
		OR NEW."applied_vat_rate_basis_points" IS DISTINCT FROM OLD."applied_vat_rate_basis_points"
		OR NEW."vat_amount_minor" IS DISTINCT FROM OLD."vat_amount_minor"
		OR NEW."total_minor" IS DISTINCT FROM OLD."total_minor"
		OR NEW."tax_mode" IS DISTINCT FROM OLD."tax_mode"
		OR NEW."tax_jurisdiction" IS DISTINCT FROM OLD."tax_jurisdiction"
		OR NEW."vat_registration_number" IS DISTINCT FROM OLD."vat_registration_number"
	THEN
		RAISE EXCEPTION 'billing transaction commercial snapshot fields are immutable'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "billing_transactions_protect_snapshot_trigger"
BEFORE UPDATE ON "billing_transactions"
FOR EACH ROW
EXECUTE FUNCTION "billing_transactions_protect_snapshot"();
