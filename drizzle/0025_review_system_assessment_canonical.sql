-- Review & System Assessment R1 — the canonical persisted model
-- (docs/product-contracts/review-system-assessment.md §2–§22).
--
-- Additive only. No existing row changes meaning and nothing is backfilled:
--   * trades.review_* — the Review lifecycle (not_reviewed | reviewed) with
--     first / last Finish time and finish count, and the two reflection
--     prompts. Every existing Trade, including one with legacy `review_notes`,
--     starts `not_reviewed` (contract §22).
--   * trades.no_mistake_identified_at — the explicit "No mistake identified".
--     Existing Trades, with or without mistake links, get NULL: an empty
--     selection stays Unanswered, never "none" (contract §6).
--   * trades.exit_plan_adherence (+ deviation type / reason, and a
--     trigger-maintained revision for optimistic concurrency) — the one
--     canonical Exit Plan Adherence answer. Legacy `plan_adherence` is untouched
--     and never copied here (contract §7).
--   * trade_rule_checks.answer_model — NULL keeps every existing row in the
--     historical four-value model (a contract row's historical `not_checked`
--     reads as Unanswered, decision 42); `review_v1` marks a canonical answer,
--     which may also be `unanswered` or `unknown` (contract §5).
--   * trade_system_assessments — the canonical System Assessment, one row per
--     Add Trade v1 Trade, written only by Confirm. Legacy `trades.system_*`
--     evidence stays where it is and is never read as canonical (contract §22).
--
-- Hand-edited: the unique index `trades_id_workspace_contract_idx` must exist
-- before the foreign key that references it (drizzle-kit emitted it after), and
-- the triggers at the end are hand-authored (Drizzle has no trigger DDL).
CREATE TABLE "trade_system_assessments" (
	"trade_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recording_contract" text DEFAULT 'add_trade_v1' NOT NULL,
	"finding" text NOT NULL,
	"exit_mechanism" text,
	"result_basis" text,
	"system_result_minor" bigint,
	"system_result_r" numeric(12, 4),
	"result_comparability" text,
	"result_helper" text,
	"rules_in_place_claim" text,
	"dependency_snapshot" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"revised_at" timestamp with time zone,
	"dependencies_confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_system_assessments_recording_contract_check" CHECK ("trade_system_assessments"."recording_contract" = 'add_trade_v1'),
	CONSTRAINT "trade_system_assessments_finding_check" CHECK ("trade_system_assessments"."finding" IN ('assessed', 'no_trade', 'cannot_determine')),
	CONSTRAINT "trade_system_assessments_exit_mechanism_check" CHECK ("trade_system_assessments"."exit_mechanism" IS NULL OR "trade_system_assessments"."exit_mechanism" IN (
        'fixed_target', 'initial_sl', 'break_even_rule', 'trailing_exit',
        'time_session_exit', 'other_predefined_rule', 'allowed_discretion'
      )),
	CONSTRAINT "trade_system_assessments_rules_in_place_claim_check" CHECK ("trade_system_assessments"."rules_in_place_claim" IS NULL OR "trade_system_assessments"."rules_in_place_claim" IN ('yes', 'no', 'unknown')),
	CONSTRAINT "trade_system_assessments_result_shape_check" CHECK ((
        "trade_system_assessments"."finding" IN ('no_trade', 'cannot_determine')
        AND "trade_system_assessments"."exit_mechanism" IS NULL
        AND "trade_system_assessments"."result_basis" IS NULL
        AND "trade_system_assessments"."system_result_minor" IS NULL
        AND "trade_system_assessments"."system_result_r" IS NULL
        AND "trade_system_assessments"."result_comparability" IS NULL
        AND "trade_system_assessments"."result_helper" IS NULL
      ) OR (
        "trade_system_assessments"."finding" = 'assessed'
        AND "trade_system_assessments"."result_comparability" IS NOT NULL
        AND "trade_system_assessments"."result_comparability" IN ('net', 'gross_only')
        AND (
          (
            "trade_system_assessments"."result_basis" IS NOT DISTINCT FROM 'money'
            AND "trade_system_assessments"."system_result_minor" IS NOT NULL
            AND "trade_system_assessments"."system_result_r" IS NULL
          ) OR (
            "trade_system_assessments"."result_basis" IS NOT DISTINCT FROM 'r'
            AND "trade_system_assessments"."system_result_r" IS NOT NULL
            AND "trade_system_assessments"."system_result_minor" IS NULL
          )
        )
      )),
	CONSTRAINT "trade_system_assessments_result_helper_check" CHECK ("trade_system_assessments"."result_helper" IS NULL OR (
        "trade_system_assessments"."result_helper" = 'initial_sl'
        AND "trade_system_assessments"."exit_mechanism" IS NOT DISTINCT FROM 'initial_sl'
        AND (
          ("trade_system_assessments"."result_basis" IS NOT DISTINCT FROM 'r' AND "trade_system_assessments"."system_result_r" IS NOT DISTINCT FROM -1)
          OR ("trade_system_assessments"."result_basis" IS NOT DISTINCT FROM 'money' AND "trade_system_assessments"."system_result_minor" IS NOT NULL AND "trade_system_assessments"."system_result_minor" < 0)
        )
      ) OR (
        "trade_system_assessments"."result_helper" = 'target'
        AND "trade_system_assessments"."exit_mechanism" IS NOT DISTINCT FROM 'fixed_target'
        AND (
          ("trade_system_assessments"."result_basis" IS NOT DISTINCT FROM 'r' AND "trade_system_assessments"."system_result_r" IS NOT NULL AND "trade_system_assessments"."system_result_r" > 0)
          OR ("trade_system_assessments"."result_basis" IS NOT DISTINCT FROM 'money' AND "trade_system_assessments"."system_result_minor" IS NOT NULL AND "trade_system_assessments"."system_result_minor" > 0)
        )
      )),
	CONSTRAINT "trade_system_assessments_dependency_snapshot_check" CHECK (jsonb_typeof("trade_system_assessments"."dependency_snapshot") = 'object'
        AND "trade_system_assessments"."dependency_snapshot" @> '{"kind": "system_assessment_dependencies", "version": 2}'::jsonb),
	CONSTRAINT "trade_system_assessments_revision_check" CHECK ((
        "trade_system_assessments"."revision" = 1 AND "trade_system_assessments"."revised_at" IS NULL
      ) OR (
        "trade_system_assessments"."revision" > 1
        AND "trade_system_assessments"."revised_at" IS NOT NULL
        AND "trade_system_assessments"."revised_at" >= "trade_system_assessments"."confirmed_at"
      )),
	CONSTRAINT "trade_system_assessments_dependencies_confirmed_at_check" CHECK ("trade_system_assessments"."dependencies_confirmed_at" >= "trade_system_assessments"."confirmed_at")
);
--> statement-breakpoint
ALTER TABLE "trade_rule_checks" DROP CONSTRAINT "trade_rule_checks_check_status_check";--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "review_status" text DEFAULT 'not_reviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "review_first_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "review_last_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "review_finish_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "review_reflection_repeat" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "review_reflection_change" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "no_mistake_identified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_adherence" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_deviation_type" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_deviation_reason" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_adherence_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD COLUMN "answer_model" text;--> statement-breakpoint
ALTER TABLE "trade_system_assessments" ADD CONSTRAINT "trade_system_assessments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trades_id_workspace_contract_idx" ON "trades" USING btree ("id","workspace_id","recording_contract");--> statement-breakpoint
ALTER TABLE "trade_system_assessments" ADD CONSTRAINT "trade_system_assessments_contract_trade_fk" FOREIGN KEY ("trade_id","workspace_id","recording_contract") REFERENCES "public"."trades"("id","workspace_id","recording_contract") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trade_system_assessments_workspace_idx" ON "trade_system_assessments" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_review_status_check" CHECK ("trades"."review_status" IN ('not_reviewed', 'reviewed'));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_review_lifecycle_check" CHECK ((
        "trades"."review_status" = 'not_reviewed'
        AND "trades"."review_first_finished_at" IS NULL
        AND "trades"."review_last_finished_at" IS NULL
        AND "trades"."review_finish_count" = 0
        AND "trades"."review_reflection_repeat" IS NULL
        AND "trades"."review_reflection_change" IS NULL
        AND "trades"."no_mistake_identified_at" IS NULL
      ) OR (
        "trades"."review_status" = 'reviewed'
        AND "trades"."review_first_finished_at" IS NOT NULL
        AND "trades"."review_last_finished_at" IS NOT NULL
        AND "trades"."review_last_finished_at" >= "trades"."review_first_finished_at"
        AND "trades"."review_finish_count" >= 1
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_review_reflection_check" CHECK (("trades"."review_reflection_repeat" IS NULL OR btrim("trades"."review_reflection_repeat") <> '')
        AND ("trades"."review_reflection_change" IS NULL OR btrim("trades"."review_reflection_change") <> ''));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_plan_adherence_check" CHECK ((
        "trades"."exit_plan_adherence" IS NULL OR "trades"."exit_plan_adherence" IN (
          'followed', 'partly_followed', 'not_followed', 'unknown', 'not_applicable'
        )
      ) AND (
        ("trades"."exit_plan_deviation_type" IS NULL AND "trades"."exit_plan_deviation_reason" IS NULL)
        OR (
          "trades"."exit_plan_adherence" IS NOT NULL
          AND "trades"."exit_plan_adherence" IN ('partly_followed', 'not_followed')
        )
      )
        AND ("trades"."exit_plan_deviation_type" IS NULL OR btrim("trades"."exit_plan_deviation_type") <> '')
        AND ("trades"."exit_plan_deviation_reason" IS NULL OR btrim("trades"."exit_plan_deviation_reason") <> '')
        AND "trades"."exit_plan_adherence_revision" >= 0);--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_answer_model_check" CHECK (("trade_rule_checks"."answer_model" IS NULL AND "trade_rule_checks"."check_status" IN (
          'followed', 'violated', 'not_applicable', 'not_checked'
        )) OR ("trade_rule_checks"."answer_model" IS NOT NULL AND "trade_rule_checks"."answer_model" = 'review_v1'));--> statement-breakpoint
ALTER TABLE "trade_rule_checks" ADD CONSTRAINT "trade_rule_checks_check_status_check" CHECK ("trade_rule_checks"."check_status" IN (
        'unanswered', 'followed', 'violated', 'not_applicable', 'not_checked', 'unknown'
      ));--> statement-breakpoint
-- A Reviewed Trade never returns to Not Reviewed (contract §2), its first
-- Finish time never moves, and its finish count never goes down. Enforced here
-- rather than trusted to every future writer.
CREATE FUNCTION "trades_review_lifecycle_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."review_status" = 'reviewed' AND NEW."review_status" <> 'reviewed' THEN
		RAISE EXCEPTION 'a reviewed trade never returns to not_reviewed'
			USING ERRCODE = '23514', CONSTRAINT = 'trades_review_lifecycle_guard';
	END IF;
	IF OLD."review_first_finished_at" IS NOT NULL
		AND NEW."review_first_finished_at" IS DISTINCT FROM OLD."review_first_finished_at" THEN
		RAISE EXCEPTION 'review_first_finished_at never changes once set'
			USING ERRCODE = '23514', CONSTRAINT = 'trades_review_lifecycle_guard';
	END IF;
	IF NEW."review_finish_count" < OLD."review_finish_count" THEN
		RAISE EXCEPTION 'review_finish_count never decreases'
			USING ERRCODE = '23514', CONSTRAINT = 'trades_review_lifecycle_guard';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trades_review_lifecycle_guard_trigger"
BEFORE UPDATE ON "trades"
FOR EACH ROW
WHEN (
	OLD."review_status" IS DISTINCT FROM NEW."review_status"
	OR OLD."review_first_finished_at" IS DISTINCT FROM NEW."review_first_finished_at"
	OR OLD."review_finish_count" IS DISTINCT FROM NEW."review_finish_count"
)
EXECUTE FUNCTION "trades_review_lifecycle_guard"();
--> statement-breakpoint
-- Optimistic concurrency for the one Exit Plan Adherence answer (contract
-- §7.3). The revision is owned by the database: +1 whenever the answer group
-- (answer, Deviation Type, Deviation Reason) changes, and unchanged — whatever
-- the writer sent — otherwise. A commit compares its draft's base revision with
-- the stored one (`... WHERE exit_plan_adherence_revision = <base>`); timestamps
-- are never the concurrency evidence.
CREATE FUNCTION "trades_exit_plan_adherence_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."exit_plan_adherence" IS DISTINCT FROM OLD."exit_plan_adherence"
		OR NEW."exit_plan_deviation_type" IS DISTINCT FROM OLD."exit_plan_deviation_type"
		OR NEW."exit_plan_deviation_reason" IS DISTINCT FROM OLD."exit_plan_deviation_reason" THEN
		NEW."exit_plan_adherence_revision" := OLD."exit_plan_adherence_revision" + 1;
	ELSE
		NEW."exit_plan_adherence_revision" := OLD."exit_plan_adherence_revision";
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trades_exit_plan_adherence_revision_trigger"
BEFORE UPDATE ON "trades"
FOR EACH ROW
WHEN (
	NEW."exit_plan_adherence" IS DISTINCT FROM OLD."exit_plan_adherence"
	OR NEW."exit_plan_deviation_type" IS DISTINCT FROM OLD."exit_plan_deviation_type"
	OR NEW."exit_plan_deviation_reason" IS DISTINCT FROM OLD."exit_plan_deviation_reason"
	OR NEW."exit_plan_adherence_revision" IS DISTINCT FROM OLD."exit_plan_adherence_revision"
)
EXECUTE FUNCTION "trades_exit_plan_adherence_revision"();
--> statement-breakpoint
-- "No mistake identified" and a selected mistake never coexist (contract §6).
-- Both sides lock the Trade row, so two concurrent writers serialize and the
-- second one sees the first one's committed answer.
CREATE FUNCTION "trade_mistakes_no_mistake_exclusive"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	none_answered_at timestamptz;
BEGIN
	SELECT "no_mistake_identified_at" INTO none_answered_at
		FROM "trades" WHERE "id" = NEW."trade_id" FOR SHARE;
	IF none_answered_at IS NOT NULL THEN
		RAISE EXCEPTION 'a trade answered "no mistake identified" cannot have a selected mistake'
			USING ERRCODE = '23514', CONSTRAINT = 'trade_mistakes_no_mistake_exclusive';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trade_mistakes_no_mistake_exclusive_trigger"
BEFORE INSERT OR UPDATE OF "trade_id" ON "trade_mistakes"
FOR EACH ROW
EXECUTE FUNCTION "trade_mistakes_no_mistake_exclusive"();
--> statement-breakpoint
CREATE FUNCTION "trades_no_mistake_exclusive"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (SELECT 1 FROM "trade_mistakes" WHERE "trade_id" = NEW."id") THEN
		RAISE EXCEPTION 'a trade with a selected mistake cannot be answered "no mistake identified"'
			USING ERRCODE = '23514', CONSTRAINT = 'trades_no_mistake_exclusive';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "trades_no_mistake_exclusive_trigger"
BEFORE UPDATE OF "no_mistake_identified_at" ON "trades"
FOR EACH ROW
WHEN (NEW."no_mistake_identified_at" IS NOT NULL)
EXECUTE FUNCTION "trades_no_mistake_exclusive"();
