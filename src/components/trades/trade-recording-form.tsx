'use client';

import type { RecordingTiming } from '@/lib/trades/recording-timing';
import type { TradeCreateOptions } from '@/server/dal/trades';

import { TradeAfterTradeForm } from './trade-after-trade-form';
import { TradeAtEntryForm } from './trade-at-entry-form';

export interface TradeRecordingFormProps {
  options: TradeCreateOptions;
  timing: RecordingTiming;
  activeTradingAccountId?: string | null;
  timezone: string;
}

/**
 * THE PRODUCTION RECORDING-MODE BOUNDARY.
 *
 * The mode was chosen on the previous step and travels in the URL, so it is a
 * fixed input here. Each lifecycle has its own linear form — At Entry for a
 * trade that is still open, After Trade for one that has finished — drawn from
 * the same shared parts (`trade-recording-primitives`). Changing the mode is a
 * navigation back to the choice, which unmounts the form and discards the draft.
 */
export function TradeRecordingForm({
  options,
  timing,
  activeTradingAccountId = null,
  timezone,
}: TradeRecordingFormProps) {
  if (timing === 'after_trade') {
    return (
      <TradeAfterTradeForm
        options={options}
        activeTradingAccountId={activeTradingAccountId}
        timezone={timezone}
      />
    );
  }
  return (
    <TradeAtEntryForm
      options={options}
      activeTradingAccountId={activeTradingAccountId}
      timezone={timezone}
    />
  );
}
