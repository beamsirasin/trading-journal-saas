import type { Metadata } from 'next';

import { AtEntryPilot } from '@/components/prototype/design-pilot/at-entry-pilot';
import {
  PILOT_STATES,
  type PilotState,
} from '@/components/prototype/design-pilot/at-entry-pilot-model';

export const metadata: Metadata = { title: 'Design pilot · At Entry' };

/**
 * AT ENTRY VISUAL PILOT — design validation for DESIGN.md, development only
 * (the `(prototype)` layout 404s in production). Not the production At Entry
 * route, and wired to nothing.
 *
 * `?state=` opens a named review state (untouched, partial, no-target,
 * inherited, customized, validation, analytical); `?figures=mono` renders
 * figures in the current monospace stack for the typography comparison.
 */
export default async function AtEntryPilotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawState = typeof params['state'] === 'string' ? params['state'] : 'untouched';
  const state: PilotState = (PILOT_STATES as readonly string[]).includes(rawState)
    ? (rawState as PilotState)
    : 'untouched';
  const figures = params['figures'] === 'mono' ? 'mono' : 'tabular';

  return <AtEntryPilot key={`${state}-${figures}`} initialState={state} figures={figures} />;
}
