import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { parseRecordingTiming } from '@/lib/trades/recording-timing';
import { cn } from '@/lib/utils';
import {
  getActiveTradingAccount,
  getActiveWorkspaceContext,
  getCurrentUserPreferences,
  getWorkspaceEntitlement,
} from '@/server/auth/dal';
import { getTradeCreateOptions } from '@/server/dal/trades';
import { recordingDraftScopeKeys } from '@/server/services/recording-draft-scope';
import { TradeCreateGate } from '@/components/trades/trade-create-gate';
import { RecordingDraftResumeNotice } from '@/components/trades/trade-recording-draft-status';
import { TradeRecordingModeSelection } from '@/components/trades/trade-recording-mode-selection';
import { WizardShell } from '@/components/trades/trade-wizard-shell';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { timing?: string | string[] | undefined };

/**
 * HOW LONG THIS FLOW IS, stated once.
 *
 * Two: choose the recording situation, then fill the form. Each form's own
 * numbered sections are NOT route steps — they belong to one form and none is
 * gated on another, so counting them here would promise a reader a gate that
 * does not exist.
 */
const RECORDING_FLOW_STEPS = 2;
const CHOICE_STEP = 1;

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'trades' });
  return {
    title: t('create.pageTitle'),
    description: t('create.pageDescription'),
    alternates: localizedAlternates(appLocale, '/app/trades/new'),
    openGraph: {
      title: t('create.pageTitle'),
      description: t('create.pageDescription'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/trades/new'),
    },
  };
}

/**
 * LOG A TRADE — one route, two steps, one frame.
 *
 * Both steps render in `WizardShell`: progress at the top, two quiet exits,
 * and the step's own subject as the page's `<h1>`. The form step used to keep
 * the ordinary product-page frame instead — `Container`, `PageHeader`, a boxed
 * "Back to Trades" — which made step two look like a different destination
 * rather than the second half of the thing the reader had just started. A flow
 * that changes its chrome halfway through reads as two features.
 *
 * WIDTH IS THE ONE DIFFERENCE, and it is a prop. The choice is 42.5rem — a
 * reading measure for one question. The form is `max-w-6xl`, the same width
 * the page container gave it before, because its field grids need the room and
 * narrowing them was never part of this.
 *
 * WHAT THE FORM STEP'S HEADING SAYS. Not "Log a trade", which the eyebrow
 * already says, but the recording mode itself — "At Entry" or "After Trade".
 * That is the answer the reader gave on step one, and repeating the flow's
 * name in the `<h1>` while the mode hid in a subtitle and again in a card
 * below it meant three lines saying one thing. The sentence under the heading,
 * and the way back to the choice, come from the form (`TradeRecordingForm`)
 * because the "Change" control needs to know whether the form is dirty.
 *
 * ONE ROUTE, TWO STEPS. `?timing=` decides which: absent or unrecognised shows
 * the recording-mode choice, and a valid value shows the form in that mode.
 * Putting the mode in the URL rather than in component state is what makes a
 * refresh keep it, a deep link land on it, browser Back return to the choice,
 * and a hand-edited value fail safely back to the choice instead of guessing
 * at which situation the trader is in. `TradeRecordingForm` is the production
 * mode boundary: a linear At Entry form for a trade still open, and a linear
 * historical form for After Trade.
 */
export default async function NewTradePage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('trades');
  const timing = parseRecordingTiming(query.timing);
  const [options, entitlement, preferences, activeAccount, workspaceContext] = await Promise.all([
    getTradeCreateOptions(),
    getWorkspaceEntitlement(),
    getCurrentUserPreferences(),
    /*
      THE ACTIVE ACCOUNT IS A DEFAULT HERE, NOT AN OWNER.

      The form keeps its own Trading Account field — it is the field that says
      which Account the new Trade will belong to, and on a multi-account
      workspace that is a real decision the writer has to be able to see and
      change. What was missing was a sensible starting value: the field
      defaulted to empty unless the workspace happened to have exactly one
      Account, so a reader who had just chosen an Account in the header arrived
      at a blank select.

      This seeds it with the same persisted active Account the rest of the app
      scopes by, re-validated server-side by `getActiveTradingAccount`. It
      changes no ownership semantics: the field is still editable, the id still
      travels through the server action's own workspace verification, and
      nothing here is trusted as authorization.
    */
    getActiveTradingAccount(),
    getActiveWorkspaceContext(),
  ]);
  // The Recording Draft belongs to this user in this workspace, and only here.
  const draftScope = recordingDraftScopeKeys(workspaceContext.userId, workspaceContext.workspaceId);
  const authorization = authorizeWorkspaceMutation(entitlement, 'ordinary_write');

  /*
    STEP ONE: the question. Exactly one of the two branches renders, so the
    page still has exactly one `<h1>` — this one returns early.
  */
  if (timing === null) {
    return (
      <WizardShell
        step={CHOICE_STEP}
        totalSteps={RECORDING_FLOW_STEPS}
        eyebrow={t('create.pageTitle')}
        title={t('create.mode.question')}
        description={t('create.mode.helper')}
        exitHref="/app/trades"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <RecordingDraftResumeNotice draftScope={draftScope} />
          <TradeRecordingModeSelection />
        </div>
      </WizardShell>
    );
  }

  /*
    BOTH RECORDING FORMS ARE CAPTURE WORKSPACES, NOT WIZARD STEPS. "Record an
    open trade" is a long form with a sticky save panel beside it; "Record a
    closed trade" is its own five-step flow with a step rail beside it on a
    wide screen. Both take a compact flow header and the workspace width
    instead of the centred step frame. The way back to the recording choice is
    the "Change" each form renders.
  */
  const copy = timing === 'at_entry' ? 'contractEntry' : 'contractAfter';
  /*
    AFTER TRADE IS A STEP FLOW, SO ITS PAGE CHROME GIVES WAY TO THE STEP. On a
    phone the flow's own heading is the question being answered; this title and
    its Back link stay, smaller and closer together, so the active step starts
    near the top of the screen instead of below a block of page furniture. The
    wider screen keeps the full header, and At Entry is untouched.
  */
  const stepFlow = timing === 'after_trade';
  const backLabel = t(`create.recording.${copy}.back`);
  return (
    <div
      className={cn(
        'mx-auto flex w-full min-w-0 flex-col px-4 sm:px-6 lg:px-8 lg:pb-16',
        stepFlow ? 'max-w-[76rem] pt-3 lg:pt-8' : 'max-w-[70rem] pt-4 pb-10 lg:pt-8',
        /*
          THE STEP FLOW OWNS THE REST OF THE SCREEN ON A PHONE. Its action bar
          is docked to the bottom of the step, so unless the step is as tall as
          what is left of the viewport the bar stops wherever the content
          happens to end and leaves a band of empty page under it — a bar that
          is neither in the flow nor at the bottom of the screen. Claiming the
          remaining height puts it where a phone expects a primary action, and
          costs nothing on a step long enough to scroll. The page's own bottom
          padding goes with it: the bar carries the safe-area inset itself.

          THE EXPRESSION IS THE SHELL'S, DELIBERATELY. `ShellFrame`'s workspace
          column sizes itself with `--shell-header-height` at every width, even
          though the header is `--shell-header-height-mobile` on a phone, so on
          a phone that column runs about 4px past the viewport. Deriving this
          height from the TRUE mobile header instead left the bar ending 4px
          above the screen's bottom — correct arithmetic, visibly wrong result,
          because the column it sits in is the thing the reader scrolls to the
          end of. Matching the shell keeps the two edges together; whether the
          shell should use the mobile var is a shell question, and moving it
          would shift the minimum height of every page in the app.
        */
        stepFlow ? 'min-h-[calc(100dvh-var(--shell-header-height))] lg:min-h-0 lg:pb-16' : null,
      )}
    >
      {/*
        THE WAY OUT AND THE TASK'S NAME, ON ONE LINE IN THE STEP FLOW. Stacked,
        they cost a phone two rows before the step's own context even begins,
        and "Record a closed trade" above "After trade · Step 1 of 5" above
        "Trade details" is three headings for one screen. Side by side the
        exit keeps its 44px target and its label, and the first answer moves up
        the viewport. At Entry keeps the stacked header it was designed with.
      */}
      <header
        className={cn(
          'flex min-w-0 gap-1',
          stepFlow ? 'items-center gap-x-1 sm:flex-col sm:items-start' : 'flex-col items-start',
        )}
      >
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-3 shrink-0">
          <Link href="/app/trades">
            <ArrowLeft aria-hidden="true" />
            {/*
              The label is what makes the exit unambiguous on a wide screen. On
              a phone in the step flow it shares its row with the task name, so
              the arrow carries it alone and the accessible name stays on the
              link — the same trade `WizardShell` already makes for this flow's
              first step.
            */}
            <span className={stepFlow ? 'sr-only sm:not-sr-only' : undefined}>{backLabel}</span>
          </Link>
        </Button>
        <h1
          className={cn(
            'text-foreground min-w-0 font-semibold tracking-tight text-balance sm:text-[1.75rem]',
            stepFlow ? 'text-base sm:text-2xl' : 'text-2xl',
          )}
        >
          {t(`create.recording.${copy}.title`)}
        </h1>
      </header>
      <div className={cn('mt-2 min-w-0', stepFlow && 'flex flex-1 flex-col')}>
        <TradeCreateGate
          options={options}
          canWrite={authorization.allowed}
          writeBlockReason={authorization.allowed ? null : authorization.code}
          timing={timing}
          activeTradingAccountId={activeAccount?.id ?? null}
          timezone={preferences.timezone}
          draftScope={draftScope}
        />
      </div>
    </div>
  );
}
