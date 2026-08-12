import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * A small, generic label+count table — shared by the subscription-status,
 * plan-distribution, and entitlement-source breakdowns. No percentages
 * (Phase 11C's own "no divide-by-zero because this phase requires no
 * percentages" instruction) — counts only, zero is a valid, ordinary value.
 */
export function AdminCountTable({
  caption,
  labelHeading,
  countHeading,
  rows,
}: {
  caption: string;
  labelHeading: string;
  countHeading: string;
  rows: readonly { readonly key: string; readonly label: string; readonly count: number }[];
}) {
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{labelHeading}</TableHead>
          <TableHead className="text-right">{countHeading}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell className="numeric text-right">{row.count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
