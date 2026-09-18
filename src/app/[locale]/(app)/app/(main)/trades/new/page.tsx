import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { parseRecordingTiming } from '@/lib/trades/recording-timing';
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
    open trade" and "Record a closed trade" are long forms with a sticky save
    panel beside them, so they take a compact flow header and the workspace
    width instead of the centred step frame. The way back to the recording
    choice is the "Change" each form renders.
  */
  const copy = timing === 'at_entry' ? 'contractEntry' : 'contractAfter';
  return (
    <div className="mx-auto w-full max-w-[70rem] min-w-0 px-4 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-8 lg:pb-16">
      <header className="flex min-w-0 flex-col items-start gap-1">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-3">
          <Link href="/app/trades">
            <ArrowLeft aria-hidden="true" />
            {t(`create.recording.${copy}.back`)}
          </Link>
        </Button>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
          {t(`create.recording.${copy}.title`)}
        </h1>
      </header>
      <div className="mt-2 min-w-0">
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
