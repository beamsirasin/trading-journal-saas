import { useTranslations } from 'next-intl';

import type { DemoEquityPoint } from '@/lib/demo';

/** The cumulative-R chart's equivalent data table for non-visual access. */
export function CumulativeRTable({ points }: { points: readonly DemoEquityPoint[] }) {
  const t = useTranslations('charts.cumulativeRTable');

  return (
    <table>
      <caption>{t('caption')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('week')}</th>
          <th scope="col">{t('systemColumn')}</th>
          <th scope="col">{t('actualColumn')}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.label}>
            <th scope="row">{point.label}</th>
            <td>{point.systemR}</td>
            <td>{point.actualR}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
