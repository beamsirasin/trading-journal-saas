'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';

/**
 * A labelled form field wrapper for the Strategy/Setup/Rule forms — the same
 * shape as `src/components/trading-accounts/account-field.tsx`, kept as its
 * own copy rather than shared because that one reads the `onboarding`
 * translation namespace for its "(optional)" suffix; this domain has its own.
 */
export function StrategyField({
  id,
  label,
  optional = false,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string | undefined;
  children: ReactNode;
}) {
  const t = useTranslations('strategies');
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <span className="text-muted-foreground ml-1 font-normal"> {t('optionalSuffix')}</span>
        ) : null}
      </Label>
      {children}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
