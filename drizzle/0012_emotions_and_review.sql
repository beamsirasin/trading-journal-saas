CREATE TABLE "emotion_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emotion_types_sort_order_check" CHECK ("emotion_types"."sort_order" >= 0),
	CONSTRAINT "emotion_types_key_not_blank_check" CHECK (btrim("emotion_types"."key") <> ''),
	CONSTRAINT "emotion_types_label_not_blank_check" CHECK (btrim("emotion_types"."label") <> ''),
	CONSTRAINT "emotion_types_tenancy_check" CHECK (("emotion_types"."is_system" AND "emotion_types"."workspace_id" IS NULL) OR (NOT "emotion_types"."is_system" AND "emotion_types"."workspace_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "trade_emotions" (
	"trade_id" uuid NOT NULL,
	"emotion_type_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_emotions_trade_id_emotion_type_id_pk" PRIMARY KEY("trade_id","emotion_type_id")
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "review_notes" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "emotions_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emotion_types" ADD CONSTRAINT "emotion_types_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_emotions" ADD CONSTRAINT "trade_emotions_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_emotions" ADD CONSTRAINT "trade_emotions_emotion_type_id_emotion_types_id_fk" FOREIGN KEY ("emotion_type_id") REFERENCES "public"."emotion_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_emotions" ADD CONSTRAINT "trade_emotions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_emotions" ADD CONSTRAINT "trade_emotions_trade_workspace_fk" FOREIGN KEY ("trade_id","workspace_id") REFERENCES "public"."trades"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emotion_types_workspace_archived_idx" ON "emotion_types" USING btree ("workspace_id","is_archived");--> statement-breakpoint
CREATE UNIQUE INDEX "emotion_types_system_key_idx" ON "emotion_types" USING btree ("key") WHERE "emotion_types"."is_system";--> statement-breakpoint
CREATE UNIQUE INDEX "emotion_types_workspace_key_idx" ON "emotion_types" USING btree ("workspace_id","key") WHERE NOT "emotion_types"."is_system";--> statement-breakpoint
CREATE INDEX "trade_emotions_workspace_idx" ON "trade_emotions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "trade_emotions_emotion_type_idx" ON "trade_emotions" USING btree ("emotion_type_id");
--> statement-breakpoint
-- A shared system Emotion has NULL workspace_id; a future custom Emotion must
-- belong to the same Workspace as the link. A plain composite FK cannot
-- express both cases, so this mirrors trade_mistakes_workspace_scope_check.
CREATE FUNCTION "trade_emotions_workspace_scope_check"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	emotion_workspace_id uuid;
BEGIN
	SELECT "workspace_id" INTO emotion_workspace_id FROM "emotion_types" WHERE "id" = NEW."emotion_type_id";
	IF emotion_workspace_id IS NOT NULL AND emotion_workspace_id <> NEW."workspace_id" THEN
		RAISE EXCEPTION 'trade emotion references an emotion type belonging to another workspace'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trade_emotions_workspace_scope_trigger"
BEFORE INSERT OR UPDATE ON "trade_emotions"
FOR EACH ROW
EXECUTE FUNCTION "trade_emotions_workspace_scope_check"();
--> statement-breakpoint
-- Canonical Phase 13D system taxonomy. Fixed ids keep every environment and
-- disposable migration path deterministic; the partial-index conflict target
-- makes a seed replay harmless.
INSERT INTO "emotion_types" ("id", "workspace_id", "key", "label", "is_system", "is_archived", "sort_order")
VALUES
	('019b6d40-7a00-7000-8000-000000000001', NULL, 'calm', 'Calm', true, false, 0),
	('019b6d40-7a00-7000-8000-000000000002', NULL, 'focused', 'Focused', true, false, 1),
	('019b6d40-7a00-7000-8000-000000000003', NULL, 'fearful', 'Fearful', true, false, 2),
	('019b6d40-7a00-7000-8000-000000000004', NULL, 'fomo', 'FOMO', true, false, 3),
	('019b6d40-7a00-7000-8000-000000000005', NULL, 'greedy', 'Greedy', true, false, 4),
	('019b6d40-7a00-7000-8000-000000000006', NULL, 'hesitant', 'Hesitant', true, false, 5),
	('019b6d40-7a00-7000-8000-000000000007', NULL, 'revenge', 'Revenge', true, false, 6),
	('019b6d40-7a00-7000-8000-000000000008', NULL, 'excited', 'Excited', true, false, 7),
	('019b6d40-7a00-7000-8000-000000000009', NULL, 'tired', 'Tired', true, false, 8),
	('019b6d40-7a00-7000-8000-00000000000a', NULL, 'frustrated', 'Frustrated', true, false, 9)
ON CONFLICT ("key") WHERE "is_system" DO NOTHING;
