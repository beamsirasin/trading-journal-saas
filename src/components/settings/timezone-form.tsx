'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type FormEvent } from 'react';

import { UpdateTimezoneSchema } from '@/lib/settings/schemas';
import { listSupportedTimeZones } from '@/lib/time/timezone';
import { updateTimezonePreferenceAction } from '@/server/actions/preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/navigation';

export function TimezoneForm({ initialTimezone }: { initialTimezone: string }) {
  const t = useTranslations('settings.preferences');
  const router = useRouter();
  const inputId = useId();
  const listId = `${inputId}-options`;
  const [timeZones] = useState(() => listSupportedTimeZones() ?? []);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [error, setError] = useState<
    'invalid_timezone' | 'unauthenticated' | 'unexpected_error' | null
  >(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = UpdateTimezoneSchema.safeParse({ timezone });
    if (!parsed.success) {
      setError('invalid_timezone');
      setSaved(false);
      return;
    }

    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateTimezonePreferenceAction({ timezone });
      if (!result.ok) {
        setError(
          result.error.code === 'invalid_timezone' || result.error.code === 'unauthenticated'
            ? result.error.code
            : 'unexpected_error',
        );
        return;
      }
      setTimezone(parsed.data.timezone);
      setSaved(true);
      router.refresh();
    });
  }

  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>{t('timezone')}</Label>
        <Input
          id={inputId}
          list={listId}
          value={timezone}
          onChange={(event) => {
            setTimezone(event.target.value);
            setError(null);
            setSaved(false);
          }}
          aria-invalid={error !== null}
          aria-describedby={error === null ? helpId : `${helpId} ${errorId}`}
          autoComplete="off"
          disabled={isPending}
          className="min-h-11"
        />
        <datalist id={listId}>
          {timeZones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <p id={helpId} className="text-muted-foreground text-xs leading-relaxed">
          {t('timezoneHelp')}
        </p>
        {error === null ? null : (
          <p id={errorId} role="alert" className="text-destructive flex items-start gap-2 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t(`errors.${error}`)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-11" disabled={isPending}>
          {isPending ? t('saving') : t('saveTimezone')}
        </Button>
        <p aria-live="polite" role="status" className="text-muted-foreground text-sm">
          {saved ? t('timezoneSaved') : ''}
        </p>
      </div>
    </form>
  );
}
