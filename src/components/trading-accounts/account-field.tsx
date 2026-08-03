'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';

/**
 * A labelled form field wrapper shared by every trading-account field form —
 * the onboarding wizard (`src/components/onboarding/onboarding-wizard.tsx`)
 * and the Phase 3B create/edit form (`account-fields-form.tsx`) render the
 * exact same fields, so this (and the `onboarding` translation namespace's
 * `optionalSuffix` key it reads) is shared rather than duplicated.
 */
export function AccountField({
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
  const t = useTranslations('onboarding');
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
