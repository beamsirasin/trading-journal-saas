import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DEMO_TRADES } from '@/lib/demo';
import { DemoBadge } from '@/components/product/demo-badge';
import { MetricLabel } from '@/components/product/metric';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'strategies' });
  return { title: t('title') };
}

/**
 * Strategy playbooks.
 *
 * The preview exists mainly to make immutable versioning visible before it is
 * built. A trade references the version of a playbook that was live when it
 * was taken (assumption A6), which is what stops a rule change silently
 * rewriting the history of every past trade — the single most important
 * property of this screen, and the easiest to leave out.
 *
 * Trade counts are derived from the fixture list by counting rows, which is
 * grouping, not a performance calculation.
 *
 * Strategy name/summary/rules are fixture content, not UI chrome — the same
 * treatment as a trade's symbol or a demo account's nickname elsewhere in
 * this product, so they are not run through the message catalog.
 */

interface StrategyPreview {
  readonly name: string;
  readonly version: string;
  readonly status: 'active' | 'retired';
  readonly summary: string;
  readonly rules: readonly string[];
}

const STRATEGIES: readonly StrategyPreview[] = [
  {
    name: 'London breakout',
    version: 'v3',
    status: 'active',
    summary: 'Range break on the London open, with a fixed 1.5R first target.',
    rules: [
      'Only after 07:00 London, only on the first clean break',
      'Stop below the range low, never tightened before the first target',
      'Exit fully at 3R or on the session close, whichever comes first',
    ],
  },
  {
    name: 'New York reversal',
    version: 'v2',
    status: 'active',
    summary: 'Fade the first extreme of the New York session on a failed continuation.',
    rules: [
      'Requires a failed break of the London high or low',
      'Stop beyond the failed extreme',
      'No entry inside ten minutes of a scheduled release',
    ],
  },
  {
    name: 'Momentum continuation',
    version: 'v4',
    status: 'active',
    summary: 'Pullback entry in an established trend on the higher timeframe.',
    rules: [
      'Higher timeframe trend must be unambiguous',
      'Entry on the first pullback to the moving average',
      'Stop under the pullback low',
    ],
  },
  {
    name: 'Asia range fade',
    version: 'v1',
    status: 'retired',
    summary: 'Faded the Asia session range. Retired after the edge failed to hold up.',
    rules: [
      'Entry at the range extreme, no confirmation required',
      'Fixed 1R target',
      'Retired — kept so its trades stay scored against the rules that were live',
    ],
  },
];

function tradeCount(strategy: string): number {
  return DEMO_TRADES.filter((trade) => trade.strategy === strategy).length;
}

export default async function StrategiesPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('strategies');

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader
        title={t('title')}
        description={t('description')}
        meta={<DemoBadge />}
        actions={
          <Button className="min-h-11" disabled aria-describedby="new-strategy-note">
            <Plus className="size-4" aria-hidden="true" />
            {t('newStrategy')}
          </Button>
        }
      />

      <p id="new-strategy-note" className="text-muted-foreground -mt-4 text-sm">
        {t('newStrategyNote')}
      </p>

      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {STRATEGIES.map((strategy) => (
          <li
            key={strategy.name}
            className="bg-card border-border flex flex-col gap-4 rounded-lg border p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-card-title">{strategy.name}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">{strategy.summary}</p>
              </div>
              <Badge variant={strategy.status === 'active' ? 'positive' : 'neutral'}>
                {strategy.status === 'active' ? t('active') : t('retired')}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-1">
                <MetricLabel>{t('version')}</MetricLabel>
                <span className="numeric text-foreground text-sm font-semibold">
                  {strategy.version}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <MetricLabel>{t('tradesShown')}</MetricLabel>
                <span className="numeric text-foreground text-sm font-semibold">
                  {tradeCount(strategy.name)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <MetricLabel>{t('rules')}</MetricLabel>
              <ul className="flex flex-col gap-1.5">
                {strategy.rules.map((rule) => (
                  <li
                    key={rule}
                    className="text-muted-foreground flex gap-2 text-sm leading-relaxed"
                  >
                    <span aria-hidden="true" className="text-brand">
                      ·
                    </span>
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </Container>
  );
}
