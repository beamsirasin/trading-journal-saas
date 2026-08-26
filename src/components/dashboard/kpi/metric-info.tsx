'use client';

import { InfoIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * A compact definition affordance for one metric.
 *
 * Deliberately not a hover-only tooltip. The trigger is a real button, so it
 * is reachable by pointer, touch, and keyboard alike, and the definition it
 * reveals is text — never colour, never an icon shape. The 32px target clears
 * the WCAG 2.5.8 AA minimum (24px) without turning a quiet KPI card header
 * into a control strip.
 *
 * `triggerLabel` names the metric rather than saying "more info", so a screen
 * reader announces "About Profit Factor", not five identical buttons.
 */
export function MetricInfo({
  triggerLabel,
  title,
  description,
  children,
}: {
  triggerLabel: string;
  title: string;
  description?: string;
  /** Richer content — a definition list for a whole card, say — under the description. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        data-slot="metric-info-trigger"
        aria-label={triggerLabel}
        className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring data-[state=open]:text-foreground data-[state=open]:bg-muted -mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
      >
        <InfoIcon className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" data-slot="metric-info-content">
        <p className="text-foreground text-sm font-semibold">{title}</p>
        {description === undefined ? null : (
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{description}</p>
        )}
        {children}
      </PopoverContent>
    </Popover>
  );
}
