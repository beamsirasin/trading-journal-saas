import type { DemoEquityPoint } from '@/lib/demo';

/** The cumulative-R chart's equivalent data table for non-visual access. */
export function CumulativeRTable({ points }: { points: readonly DemoEquityPoint[] }) {
  return (
    <table>
      <caption>Cumulative R by week, system compared with actual</caption>
      <thead>
        <tr>
          <th scope="col">Week</th>
          <th scope="col">System cumulative R</th>
          <th scope="col">Actual cumulative R</th>
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
