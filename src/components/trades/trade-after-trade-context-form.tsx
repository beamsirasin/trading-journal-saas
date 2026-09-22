'use client';

import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';

import { generateId } from '@/lib/identifiers';
import { isValidTradingViewUrl } from '@/lib/trades/validation';
import { recordAfterTradeContextAction } from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

import { canDeselectEmotion } from './after-trade-draft';
import type { EmotionsDraft } from './at-entry-draft';
import {
  loadAfterTradeContextTask,
  removeAfterTradeContextTask,
  saveAfterTradeContextTask,
  type AfterTradeContextAnswers,
  type CloseDraftScope,
  type CloseDraftSubmission,
} from './close-trade-draft-storage';
import { afterTradeContextIds, TradeAfterTradeContextStep } from './trade-after-trade-context-step';
import { InlineAction, Notice } from './trade-at-entry-controls';

const ID_PREFIX = 'stage6';
const IDS = afterTradeContextIds(ID_PREFIX);

interface Answers {
  readonly note: string;
  readonly tradingviewUrl: string;
  readonly emotions: EmotionsDraft;
}

function answersOf(trade: TradeDetail): Answers {
  return {
    note: trade.afterTradeNote ?? '',
    tradingviewUrl: trade.afterTradeTradingviewUrl ?? '',
    emotions:
      trade.postTradeEmotionsRecordedAt === null
        ? { answer: 'unanswered', keys: [] }
        : trade.postTradeEmotions.length === 0
          ? { answer: 'none', keys: [] }
          : { answer: 'selected', keys: trade.postTradeEmotions.map((emotion) => emotion.key) },
  };
}

function emotionKeysOf(emotions: EmotionsDraft): readonly string[] | null {
  if (emotions.answer === 'unanswered') return null;
  return emotions.answer === 'none' ? [] : [...emotions.keys].sort();
}

function toStored(answers: Answers): AfterTradeContextAnswers {
  return {
    note: answers.note,
    tradingviewUrl: answers.tradingviewUrl,
    postTradeEmotionKeys: emotionKeysOf(answers.emotions),
  };
}

function fromStored(stored: AfterTradeContextAnswers): Answers {
  const keys = stored.postTradeEmotionKeys;
  return {
    note: stored.note,
    tradingviewUrl: stored.tradingviewUrl,
    emotions:
      keys === null
        ? { answer: 'unanswered', keys: [] }
        : keys.length === 0
          ? { answer: 'none', keys: [] }
          : { answer: 'selected', keys },
  };
}

/**
 * The three-way patch against what is saved: a field the trader left as it
 * was is left out (unchanged); emptied, it is cleared (`null`); otherwise it
 * is set. An empty patch is never sent — there is nothing to save.
 */
function patchOf(answers: Answers, saved: Answers) {
  const patch: {
    afterTradeNote?: string | null;
    afterTradeTradingviewUrl?: string | null;
    postTradeEmotionKeys?: readonly string[] | null;
  } = {};
  const note = answers.note.trim();
  if (note !== saved.note.trim()) patch.afterTradeNote = note === '' ? null : note;
  const url = answers.tradingviewUrl.trim();
  if (url !== saved.tradingviewUrl.trim()) patch.afterTradeTradingviewUrl = url === '' ? null : url;
  const keys = emotionKeysOf(answers.emotions);
  if (JSON.stringify(keys) !== JSON.stringify(emotionKeysOf(saved.emotions))) {
    patch.postTradeEmotionKeys = keys;
  }
  return patch;
}

/**
 * STAGE 6 FOR A CLOSED TRADE — After-Trade Context, on its own page after the
 * Final Close, or reopened later from the Trade (UX Rules §20.5).
 *
 * THE TRADE IS ALREADY CLOSED. When the Final Close brought the trader here,
 * the page says so first; nothing on it can undo or repeat the close. Every
 * answer is optional: "Skip for now" leaves the Trade as it is, and the
 * answers stay in the Close Trade draft to be resumed later.
 *
 * SAVE sends only what changed, through \`recordAfterTradeContextAction\`,
 * under Stage 6's own Save key — kept in the Close Trade draft (version 2)
 * with its answers, so a retry after a reload replays instead of writing
 * twice. With nothing changed there is nothing to send. Saved or skipped, the
 * trader then chooses Review Trade or Done.
 */
export function TradeAfterTradeContextForm({
  trade,
  draftScope,
  fromClose,
}: {
  trade: TradeDetail;
  draftScope: CloseDraftScope | null;
  fromClose: boolean;
}) {
  const s = useTranslations('trades.stage6');
  const tErrors = useTranslations('trades.errors');
  const router = useRouter();
  const saved = answersOf(trade);
  const [answers, setAnswers] = useState<Answers>(saved);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<'none' | 'restored' | 'stale'>('none');
  const [outcome, setOutcome] = useState<'saved' | 'skipped' | null>(null);
  const [hydrated, setHydrated] = useState(draftScope === null);
  const [pending, startTransition] = useTransition();
  const lastSubmission = useRef<CloseDraftSubmission | null>(null);
  const completion = useRef<HTMLHeadingElement>(null);
  const tradeHref = `/app/trades?trade=${trade.tradeId}`;

  // Restore once, after hydration: the server cannot read this browser's draft.
  const tradeKey = draftScope?.tradeKey;
  useEffect(() => {
    if (draftScope === null) return;
    const task = loadAfterTradeContextTask(draftScope, new Date());
    if (task !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnswers(fromStored(task.answers));
      lastSubmission.current = task.submission;
      setNotice(task.basis.status === trade.status ? 'restored' : 'stale');
    }
    setHydrated(true);
    // Once per Trade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeKey]);

  function persist(next: Answers, submission: CloseDraftSubmission | null) {
    if (draftScope === null) return;
    const now = new Date();
    if (Object.keys(patchOf(next, saved)).length === 0 && submission === null) {
      removeAfterTradeContextTask(draftScope, now);
      return;
    }
    saveAfterTradeContextTask(
      draftScope,
      { basis: { status: trade.status }, answers: toStored(next), submission },
      { symbol: trade.symbol, now },
    );
  }

  useEffect(() => {
    if (!hydrated || outcome !== null) return;
    persist(answers, lastSubmission.current);
    // Written on every answer change; `persist` reads refs and props only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, hydrated]);

  useEffect(() => {
    if (outcome !== null) completion.current?.focus();
  }, [outcome]);

  function change(update: (current: Answers) => Answers) {
    setAnswers(update);
    setFormMessage(null);
  }

  function save() {
    setFormMessage(null);
    if (notice === 'stale') {
      setFormMessage(s('page.stale'));
      return;
    }
    const url = answers.tradingviewUrl.trim();
    if (url !== '' && !isValidTradingViewUrl(url)) {
      setUrlError(s('errors.invalidTradingViewUrl'));
      requestAnimationFrame(() => document.getElementById(IDS.tradingviewUrl)?.focus());
      return;
    }
    const patch = patchOf(answers, saved);
    // Nothing changed: there is nothing to save, and no empty patch is sent.
    if (Object.keys(patch).length === 0) {
      if (draftScope !== null) removeAfterTradeContextTask(draftScope, new Date());
      const anyRecorded =
        saved.note !== '' || saved.tradingviewUrl !== '' || saved.emotions.answer !== 'unanswered';
      setOutcome(anyRecorded ? 'saved' : 'skipped');
      return;
    }
    const body = JSON.stringify(patch);
    const key =
      lastSubmission.current !== null && lastSubmission.current.body === body
        ? lastSubmission.current.key
        : generateId();
    lastSubmission.current = { key, body };
    // Stored before sending: a reload mid-flight re-sends under the same key.
    persist(answers, lastSubmission.current);
    startTransition(async () => {
      const result = await recordAfterTradeContextAction({
        tradeId: trade.tradeId,
        mutationKey: key,
        ...patch,
      });
      if (result.ok) {
        if (draftScope !== null) removeAfterTradeContextTask(draftScope, new Date());
        lastSubmission.current = null;
        setOutcome('saved');
        router.refresh();
        return;
      }
      const code = result.error.code;
      if (code === 'mutation_replay_conflict') {
        setFormMessage(s('page.conflict'));
        return;
      }
      if (code === 'validation_error' && result.error.fieldErrors?.afterTradeTradingviewUrl) {
        setUrlError(s('errors.invalidTradingViewUrl'));
        requestAnimationFrame(() => document.getElementById(IDS.tradingviewUrl)?.focus());
        return;
      }
      setFormMessage(tErrors(code));
    });
  }

  if (outcome !== null) {
    return (
      <section
        data-after-trade-context-done={outcome}
        aria-labelledby="stage6-done-heading"
        className="bg-card border-border shadow-card flex w-full min-w-0 flex-col gap-4 rounded-xl border px-5 py-6 sm:px-7"
      >
        <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-1">
          <h2
            id="stage6-done-heading"
            ref={completion}
            tabIndex={-1}
            className="text-foreground text-xl font-semibold outline-none"
          >
            {s('page.savedTitle')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {s('page.savedDescription', { symbol: trade.symbol })}{' '}
            {outcome === 'saved' ? s('page.savedContext') : s('page.savedSkipped')}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12"
            onClick={() => router.push(`/app/trades?trade=${trade.tradeId}&tab=review`)}
          >
            {s('page.review')}
          </Button>
          <Button
            type="button"
            size="lg"
            className="min-h-12"
            onClick={() => router.push(tradeHref)}
          >
            {s('page.finish')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form
      noValidate
      data-after-trade-context-form=""
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex min-w-0 flex-1 flex-col gap-4"
    >
      {fromClose ? (
        // THE TRADE IS CLOSED FIRST. Said before anything optional is asked.
        <div
          role="status"
          data-trade-closed=""
          className="border-border bg-muted/30 flex min-w-0 items-start gap-3 rounded-lg border p-4"
        >
          <CheckCircle2 className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-foreground text-sm font-semibold">{s('page.closedTitle')}</p>
            <p className="text-muted-foreground text-sm">
              {s('page.closedDescription', { symbol: trade.symbol })}
            </p>
          </div>
        </div>
      ) : null}

      {notice === 'none' ? null : (
        <div data-after-trade-draft={notice} className="flex min-w-0 flex-col gap-2">
          <Notice>{notice === 'stale' ? s('page.stale') : s('page.restored')}</Notice>
          {notice === 'stale' ? (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 px-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setNotice('none')}>
                {s('page.keep')}
              </Button>
              <InlineAction
                onClick={() => {
                  if (draftScope !== null) removeAfterTradeContextTask(draftScope, new Date());
                  lastSubmission.current = null;
                  setAnswers(saved);
                  setNotice('none');
                }}
              >
                {s('page.discard')}
              </InlineAction>
            </div>
          ) : null}
        </div>
      )}

      <TradeAfterTradeContextStep
        idPrefix={ID_PREFIX}
        emotions={answers.emotions}
        catalog={trade.emotionCatalog}
        note={answers.note}
        tradingviewUrl={answers.tradingviewUrl}
        errors={{ tradingviewUrl: urlError ?? undefined }}
        canDeselectEmotion={(key) => canDeselectEmotion(answers.emotions, key)}
        onToggleEmotion={(key) =>
          change((current) => {
            const selected = current.emotions.answer === 'selected' ? current.emotions.keys : [];
            const keys = selected.includes(key)
              ? selected.filter((item) => item !== key)
              : [...selected, key];
            return { ...current, emotions: { answer: 'selected', keys } };
          })
        }
        onNoEmotions={() =>
          change((current) => ({ ...current, emotions: { answer: 'none', keys: [] } }))
        }
        onRemoveEmotions={() =>
          change((current) => ({ ...current, emotions: { answer: 'unanswered', keys: [] } }))
        }
        onNote={(note) => change((current) => ({ ...current, note }))}
        onTradingviewUrl={(tradingviewUrl) => {
          setUrlError(null);
          change((current) => ({ ...current, tradingviewUrl }));
        }}
      />

      <div
        data-after-trade-context-actions=""
        className="border-border bg-background sticky bottom-0 z-10 -mx-4 mt-auto flex min-w-0 flex-col gap-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-t-0 sm:px-0"
      >
        <p aria-live="polite" role="status" className="text-sm empty:hidden">
          {formMessage !== null ? (
            <span className="text-destructive inline-flex items-center gap-1.5">
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              {formMessage}
            </span>
          ) : urlError !== null ? (
            <span className="text-destructive inline-flex items-center gap-1.5">
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              {s('page.attention', { count: 1 })}
            </span>
          ) : (
            ''
          )}
        </p>
        <div className="flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {/* Skipping is always allowed: the Trade stays Closed, and this can be resumed. */}
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-h-12"
            onClick={() => setOutcome('skipped')}
          >
            {s('page.skip')}
          </Button>
          <Button type="submit" size="lg" className="min-h-12" disabled={pending}>
            {pending ? s('page.saving') : s('page.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}
