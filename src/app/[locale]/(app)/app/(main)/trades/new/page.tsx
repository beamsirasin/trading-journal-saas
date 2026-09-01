import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import {
  getActiveTradingAccount,
  getCurrentUserPreferences,
  getWorkspaceEntitlement,
} from '@/server/auth/dal';
import { getTradeCreateOptions } from '@/server/dal/trades';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { TradeCreateGate } from '@/components/trades/trade-create-gate';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

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
 */
export default async function NewTradePage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('trades');
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

  return (
    <Container width="default" className="flex min-w-0 flex-col gap-8 py-8">
      <PageHeader
        title={t('create.pageTitle')}
        description={t('create.pageDescription')}
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
        activeTradingAccountId={activeAccount?.id ?? null}
        timezone={preferences.timezone}
      />
    </Container>
  );
}
