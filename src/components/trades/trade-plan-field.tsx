'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

/** Shared label/optional-marker/error wrapper for every Plan-step field (create form + its quick-select variants). */
export function PlanField({
  id,
  label,
  optional,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean | undefined;
  /** Non-error helper text (e.g. a currency hint) — always muted, never `role="alert"`. See {@link error} for the destructive variant. */
  hint?: string | undefined;
  error?: string | undefined;
  /** How much of a grid row this field takes — width is the caller's call, not the field's. */
  className?: string | undefined;
  children: ReactNode;
}) {
  const t = useTranslations('trades');
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <Label htmlFor={id}>
        {label}
        {/*
          OPTIONAL IS SAID IN COLOUR, NOT IN PARENTHESES. "(optional)" spends
          two brackets and a word of the same weight as the label itself on
          every non-required field, and a form with a dozen of them reads as a
          list of caveats. The muted marker carries the same information at a
          glance without competing with the thing it qualifies. It is a
          separate message from `common.optional` because that string is still
          rendered inline in prose elsewhere, where the brackets belong.
        */}
        {optional ? (
          <span className="text-muted-foreground text-xs font-normal">
            {' '}
            {t('common.optionalMarker')}
          </span>
        ) : null}
      </Label>
      {children}
      {hint === undefined ? null : <p className="text-muted-foreground text-xs">{hint}</p>}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
