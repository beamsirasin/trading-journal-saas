'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';

/** Shared label/optional-marker/error wrapper for every Plan-step field (create form + its quick-select variants). */
export function PlanField({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean | undefined;
  /** Non-error helper text (e.g. a currency hint) — always muted, never `role="alert"`. See {@link error} for the destructive variant. */
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  const t = useTranslations('trades');
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <span className="text-muted-foreground font-normal"> {t('common.optional')}</span>
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
