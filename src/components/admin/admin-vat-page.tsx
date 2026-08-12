import { Percent } from 'lucide-react';

import { formatUtcDateTime } from '@/lib/admin/format';
import type { VatConfigurationReadModel } from '@/server/services/admin/vat';
import { EmptyState } from '@/components/product/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroller,
} from '@/components/ui/table';

import { adminCopy } from './admin-copy';
import { AdminVatSupport } from './admin-vat-support';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className="text-foreground mt-1 text-sm font-semibold break-words">{value}</dd>
    </div>
  );
}

/**
 * The Phase 11F `/admin/vat` page — read model plus the single high-risk
 * mutation dialog (`AdminVatSupport`). "Current" always comes from
 * `readModel.current`, resolved through the SAME canonical resolver every
 * commercial operation uses — never re-derived from the bounded history
 * list below it, which exists purely for operator visibility and may
 * legitimately omit rows the current-config query still sees (a wider
 * change history than the fixed-size list shows).
 */
export function AdminVatPage({ readModel }: { readModel: VatConfigurationReadModel }) {
  const c = adminCopy.vat;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title">{c.title}</h1>
        <p className="text-muted-foreground text-sm">{c.description}</p>
      </div>

      <section
        aria-labelledby="admin-vat-current-heading"
        className="border-border bg-card flex flex-col gap-5 rounded-xl border p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="admin-vat-current-heading" className="text-card-title">
            {c.currentTitle}
          </h2>
          <AdminVatSupport
            currentEnabled={readModel.current.enabled}
            currentRatePercent={readModel.current.ratePercent}
          />
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact
            label={c.statusLabel}
            value={readModel.current.enabled ? c.statusEnabled : c.statusDisabled}
          />
          <Fact label={c.rateLabel} value={`${readModel.current.ratePercent}%`} />
          <Fact
            label={c.effectiveSinceLabel}
            value={formatUtcDateTime(readModel.current.effectiveAt)}
          />
        </dl>
      </section>

      <section aria-labelledby="admin-vat-history-heading" className="flex flex-col gap-4">
        <h2 id="admin-vat-history-heading" className="text-card-title">
          {c.historyTitle}
        </h2>
        {readModel.history.length === 0 ? (
          <EmptyState
            icon={Percent}
            title={c.historyEmpty}
            description={c.historyEmptyDescription}
            action={null}
          />
        ) : (
          <TableScroller label={c.historyTitle}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.historyColumns.effectiveAt}</TableHead>
                  <TableHead>{c.historyColumns.status}</TableHead>
                  <TableHead>{c.historyColumns.rate}</TableHead>
                  <TableHead>{c.historyColumns.reason}</TableHead>
                  <TableHead>{c.historyColumns.actor}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readModel.history.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="numeric text-muted-foreground whitespace-nowrap">
                      {formatUtcDateTime(entry.effectiveAt)}
                      {entry.isFuture ? (
                        <Badge variant="warning" className="ml-2">
                          {c.futureLabel}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.enabled ? 'positive' : 'neutral'}>
                        {entry.enabled ? c.statusEnabled : c.statusDisabled}
                      </Badge>
                    </TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      {entry.ratePercent}%
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.reasonOptions[entry.reasonCode as keyof typeof c.reasonOptions] ??
                        entry.reasonCode}
                      {entry.reasonNote === null ? null : (
                        <p className="text-muted-foreground mt-1 max-w-xs text-xs break-words">
                          {entry.reasonNote}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.actor.kind === 'system'
                        ? c.systemActor
                        : (entry.actor.name ?? entry.actor.email ?? c.systemActor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroller>
        )}
      </section>
    </div>
  );
}

export function AdminVatPageSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-8 w-24 rounded-md" />
        <div className="bg-muted h-4 w-96 max-w-full rounded-md" />
      </div>
      <div className="bg-card border-border h-40 rounded-lg border" />
      <div className="bg-card border-border h-64 rounded-lg border" />
    </div>
  );
}
