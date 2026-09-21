CREATE TABLE "saved_symbols" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_symbols_symbol_trimmed_check" CHECK ("saved_symbols"."symbol" = btrim("saved_symbols"."symbol") AND "saved_symbols"."symbol" <> '')
);
--> statement-breakpoint
ALTER TABLE "saved_symbols" ADD CONSTRAINT "saved_symbols_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_symbols_workspace_symbol_ci_idx" ON "saved_symbols" USING btree ("workspace_id",upper("symbol"));--> statement-breakpoint
CREATE INDEX "saved_symbols_workspace_created_idx" ON "saved_symbols" USING btree ("workspace_id","created_at");