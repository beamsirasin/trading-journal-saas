import { useTranslations } from 'next-intl';

import type { PasswordStrength } from '@/lib/auth/password-policy';
import { cn } from '@/lib/utils';

const STRENGTH_ORDER: readonly PasswordStrength[] = ['insufficient', 'weak', 'medium', 'strong'];

const STRENGTH_BAR_COLOR: Record<PasswordStrength, string> = {
  insufficient: 'bg-border',
  weak: 'bg-destructive',
  medium: 'bg-warning',
  strong: 'bg-positive',
};

const STRENGTH_LABEL_KEY: Record<PasswordStrength, string> = {
  insufficient: 'passwordStrengthInsufficient',
  weak: 'passwordStrengthWeak',
  medium: 'passwordStrengthMedium',
  strong: 'passwordStrengthStrong',
};

/**
 * Informational strength meter — never a substitute for `PasswordRequirements`'s
 * mandatory checklist, and its label never claims to guarantee security
 * (CLAUDE.md-style honesty: this is a heuristic, not a promise). Announces
 * changes via a polite live region so it does not interrupt typing, the way
 * a hint should behave rather than an error.
 */
export function PasswordStrengthMeter({
  strength,
  password,
}: {
  strength: PasswordStrength;
  password: string;
}) {
  const t = useTranslations('auth');
  const filledBars = STRENGTH_ORDER.indexOf(strength) + 1;

  if (password.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex gap-1"
        role="img"
        aria-label={`${t('passwordStrengthLabel')}: ${t(STRENGTH_LABEL_KEY[strength])}`}
      >
        {STRENGTH_ORDER.map((tier, index) => (
          <span
            key={tier}
            aria-hidden="true"
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              index < filledBars ? STRENGTH_BAR_COLOR[strength] : 'bg-border',
            )}
          />
        ))}
      </div>
      <p aria-live="polite" className="text-muted-foreground text-xs">
        {t(STRENGTH_LABEL_KEY[strength])}
      </p>
    </div>
  );
}
