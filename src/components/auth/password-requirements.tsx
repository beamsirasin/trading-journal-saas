import { Check, Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { PasswordPolicyResult } from '@/lib/auth/password-policy';
import { cn } from '@/lib/utils';

/**
 * Real-time password checklist shown under the password field. Never the
 * only signal of a requirement's state: each item pairs a distinct icon
 * (filled check vs. hollow circle, not merely a color swap on one icon)
 * with visible text and an `aria-label` stating met/not-met explicitly, so
 * the state survives for screen-reader users and anyone who cannot
 * distinguish the color alone.
 */
export function PasswordRequirements({ policy, id }: { policy: PasswordPolicyResult; id: string }) {
  const t = useTranslations('auth');

  const requirements: { key: keyof PasswordPolicyResult; labelKey: string }[] = [
    { key: 'minimumLength', labelKey: 'passwordRequirementMinLength' },
    { key: 'lowercase', labelKey: 'passwordRequirementLowercase' },
    { key: 'uppercase', labelKey: 'passwordRequirementUppercase' },
    { key: 'number', labelKey: 'passwordRequirementNumber' },
    { key: 'special', labelKey: 'passwordRequirementSpecial' },
  ];

  return (
    <div id={id}>
      <p className="text-muted-foreground text-xs font-medium">{t('passwordRequirementsLabel')}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {requirements.map(({ key, labelKey }) => {
          const met = policy[key];
          const stateLabel = met ? t('passwordRequirementMet') : t('passwordRequirementNotMet');
          return (
            <li
              key={key}
              aria-label={`${t(labelKey)}: ${stateLabel}`}
              className={cn(
                'flex items-center gap-2 text-xs',
                met ? 'text-positive' : 'text-muted-foreground',
              )}
            >
              {met ? (
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span aria-hidden="true">{t(labelKey)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
