-- Stage 6 After-Trade Context (Add Trade contract §9, UX Rules §20.5).
--
-- Additive only; nothing is read, rewritten or backfilled.
--
-- 1. trades.after_trade_note / trades.after_trade_tradingview_url: what the
--    trader noted and linked AFTER the Trade closed. Distinct from the entry
--    notes, the before-entry tradingview_url and the legacy review_notes.
--    NULL is Unanswered; a note is never blank; only a Closed contract Trade
--    may carry either (a legacy row, or any Trade not Closed, holds neither).
-- 2. trade_after_trade_context_saves: one row per accepted Stage 6 Save, its
--    own Save key (unique per workspace, never the Final Close's key) and the
--    SHA-256 of what the Save said, so an exact replay answers without
--    writing and the same key with different content is a replay conflict.
CREATE TABLE "trade_after_trade_context_saves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"mutation_key" uuid NOT NULL,
	"mutation_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "after_trade_note" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "after_trade_tradingview_url" text;--> statement-breakpoint
ALTER TABLE "trade_after_trade_context_saves" ADD CONSTRAINT "trade_after_trade_context_saves_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_after_trade_context_saves" ADD CONSTRAINT "trade_after_trade_context_saves_trade_workspace_fk" FOREIGN KEY ("trade_id","workspace_id") REFERENCES "public"."trades"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_after_trade_context_saves_workspace_key_idx" ON "trade_after_trade_context_saves" USING btree ("workspace_id","mutation_key");--> statement-breakpoint
CREATE INDEX "trade_after_trade_context_saves_trade_idx" ON "trade_after_trade_context_saves" USING btree ("workspace_id","trade_id");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_after_trade_note_not_blank_check" CHECK ("trades"."after_trade_note" IS NULL OR btrim("trades"."after_trade_note") <> '');--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_after_trade_context_check" CHECK (("trades"."after_trade_note" IS NULL AND "trades"."after_trade_tradingview_url" IS NULL)
        OR ("trades"."recording_contract" IS NOT NULL AND "trades"."status" = 'closed'));