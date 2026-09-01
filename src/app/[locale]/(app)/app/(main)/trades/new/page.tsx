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
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { timing?: string | string[] | undefined };

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
 * LOG A TRADE — the same page it has always been, in the current visual system.
 *
 * WIDTH IS THE ONE STRUCTURAL CHANGE. It rendered a `max-w-3xl` form centred
 * inside a `wide` (100rem) container, so the header ran to one edge and the
 * form floated in the middle of a column twice its width. It now uses the app's
 * standard `default` page width and the form fills it, which puts the header
 * and the form on one left edge and gives the two-column field grids real room
 * — without stretching a text input across a 100rem monitor.
 *
 * The application shell, the `PageHeader` hierarchy and the Back action are
 * unchanged: this is an ordinary product page, not a full-screen environment
 * of its own.
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
    The choice step is narrower than the form step, deliberately. `prose`
    (48rem) keeps two decision cards as one focused region that the header sits
    directly on top of, rather than a pair of cards adrift under a 72rem
    heading; the form then gets the standard `default` page width it needs for
    its two-column field grids. Both are existing container widths.
  */
  return (
    <Container
      width={timing === null ? 'prose' : 'default'}
      className="flex min-w-0 flex-col gap-8 py-8"
    >
      <PageHeader
        title={t('create.pageTitle')}
        description={
          timing === null
            ? t('create.pageDescription')
            : t(`create.mode.${timing}.headerDescription`)
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/app/trades">
              <ArrowLeft aria-hidden="true" />
              {t('create.backToTrades')}
            </Link>
          </Button>
        }
      />
      {timing === null ? (
        <TradeRecordingModeSelection />
      ) : (
        <TradeCreateGate
          options={options}
          canWrite={authorization.allowed}
          writeBlockReason={authorization.allowed ? null : authorization.code}
          timing={timing}
          activeTradingAccountId={activeAccount?.id ?? null}
          timezone={preferences.timezone}
        />
      )}
    </Container>
  );
}
