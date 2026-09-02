import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { parseRecordingTiming } from '@/lib/trades/recording-timing';
import {
  getActiveTradingAccount,
  getCurrentUserPreferences,
  getWorkspaceEntitlement,
} from '@/server/auth/dal';
import { getTradeCreateOptions } from '@/server/dal/trades';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { TradeCreateGate } from '@/components/trades/trade-create-gate';
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
 * Two: choose the recording situation, then fill the form. The form's own
 * panels (three At Entry, four After Trade) are NOT steps — every one of them
 * is reachable at any time and none is gated on another, so counting them here
 * would promise a reader a gate that does not exist.
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
 * LOG A TRADE — one route, two steps, two deliberately different frames.
 *
 * The choice step renders in `WizardShell`: centred, narrow, progress at the
 * top, the question as the page's `<h1>`. The form step keeps the ordinary
 * product-page frame it has always had — `Container` at the app's standard
 * `default` width, `PageHeader`, and the Back action — because the form is a
 * place you work rather than a question you answer. See the comment above the
 * branch itself for why the shell stops at the choice.
 *
 * WIDTH ON THE FORM STEP. It once rendered a `max-w-3xl` form centred inside a
 * `wide` (100rem) container, so the header ran to one edge and the form floated
 * in the middle of a column twice its width. `default` puts the header and the
 * form on one left edge and gives the two-column field grids real room without
 * stretching a text input across a 100rem monitor.
 *
 * ONE ROUTE, TWO STEPS. `?timing=` decides which: absent or unrecognised shows
 * the recording-mode choice, and a valid value shows the form in that mode.
 * Putting the mode in the URL rather than in component state is what makes a
 * refresh keep it, a deep link land on it, browser Back return to the choice,
 * and a hand-edited value fail safely back to the choice instead of guessing
 * at which situation the trader is in. The form itself is not duplicated —
 * `TradeRecordingForm` remains the one implementation and simply receives the
 * mode.
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
  const [options, entitlement, preferences, activeAccount] = await Promise.all([
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
  ]);
  const authorization = authorizeWorkspaceMutation(entitlement, 'ordinary_write');

  /*
    THE CHOICE STEP IS NOT AN ORDINARY PRODUCT PAGE, AND STOPPED PRETENDING TO
    BE ONE. It rendered inside the same `Container` + `PageHeader` frame as
    every destination in the app: a left-aligned title that named the route
    rather than asking the question, the question itself demoted to an `<h2>`
    beneath it, and a boxed "Back to Trades" button sitting where a page's
    actions go. That frame is right for a place and wrong for a decision.

    `WizardShell` inverts it — progress, two quiet exits, then the question
    centred as the page's `<h1>`. Only ONE of the two frames ever renders, so
    the page still has exactly one `<h1>`: this branch returns early, and the
    form below keeps the header it has always had.

    THE FORM STEP IS DELIBERATELY NOT IN THE SHELL. 42.5rem is a reading
    measure for one question; the form needs the app's standard page width for
    its two-column field grids, and it carries its own recording-mode banner,
    sticky submit bar and panel navigation. Folding it in is a separate
    decision, not a consequence of this one.
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
        <TradeRecordingModeSelection />
      </WizardShell>
    );
  }

  return (
    <Container width="default" className="flex min-w-0 flex-col gap-8 py-8">
      <PageHeader
        title={t('create.pageTitle')}
        description={t(`create.mode.${timing}.headerDescription`)}
        actions={
          <Button asChild variant="outline">
            <Link href="/app/trades">
              <ArrowLeft aria-hidden="true" />
              {t('create.backToTrades')}
            </Link>
          </Button>
        }
      />
      <TradeCreateGate
        options={options}
        canWrite={authorization.allowed}
        writeBlockReason={authorization.allowed ? null : authorization.code}
        timing={timing}
        activeTradingAccountId={activeAccount?.id ?? null}
        timezone={preferences.timezone}
      />
    </Container>
  );
}
