'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type FormEvent } from 'react';

import { DISPLAY_NAME_MAX_LENGTH, UpdateDisplayNameSchema } from '@/lib/settings/schemas';
import { updateDisplayNameAction } from '@/server/actions/profile';
import type { LinkedAuthProvider, SelfProfile } from '@/server/auth/settings-dal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/navigation';

type NameError = 'required' | 'too_long' | 'invalid_characters' | 'validation';

function mapNameError(message: string | undefined): NameError {
  if (message === 'required' || message === 'too_long' || message === 'invalid_characters') {
    return message;
  }
  return 'validation';
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

function providerKey(provider: LinkedAuthProvider): `providers.${LinkedAuthProvider}` {
  return `providers.${provider}`;
}

export function ProfileForm({ profile }: { profile: SelfProfile }) {
  const t = useTranslations('settings.profile');
  const router = useRouter();
  const inputId = useId();
  const [name, setName] = useState(profile.name);
  const [nameError, setNameError] = useState<NameError | null>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'unauthenticated'>('idle');
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = UpdateDisplayNameSchema.safeParse({ name });
    if (!parsed.success) {
      setNameError(mapNameError(parsed.error.flatten().fieldErrors.name?.[0]));
      setStatus('error');
      return;
    }

    setNameError(null);
    setStatus('idle');
    startTransition(async () => {
      const result = await updateDisplayNameAction({ name });
      if (!result.ok) {
        setNameError(
          result.error.fieldErrors?.name === undefined
            ? null
            : mapNameError(result.error.fieldErrors.name[0]),
        );
        setStatus(result.error.code === 'unauthenticated' ? 'unauthenticated' : 'error');
        return;
      }
      setName(result.data.name);
      setStatus('saved');
      router.refresh();
    });
  }

  const errorId = `${inputId}-error`;
  const statusId = `${inputId}-status`;

  return (
    <div className="bg-card border-border flex flex-col gap-6 rounded-lg border p-5 sm:p-6">
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        {profile.image === null ? (
          <span
            aria-label={t('initialsAlt', { name: profile.name })}
            className="bg-accent text-foreground flex size-16 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
          >
            {initials(profile.name)}
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- provider-hosted user avatar; no editable URL is accepted here
          <img
            src={profile.image}
            alt={t('avatarAlt', { name: profile.name })}
            className="size-16 shrink-0 rounded-full object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-semibold break-words">{profile.name}</p>
          <p className="text-muted-foreground text-sm break-all">{profile.email}</p>
        </div>
      </div>

      <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId}>{t('displayName')}</Label>
          <Input
            id={inputId}
            name="name"
            value={name}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
              setStatus('idle');
            }}
            aria-invalid={nameError !== null}
            aria-describedby={nameError === null ? statusId : `${errorId} ${statusId}`}
            autoComplete="name"
            disabled={isPending}
            required
          />
          {nameError === null ? null : (
            <p
              id={errorId}
              role="alert"
              className="text-destructive flex items-start gap-2 text-sm"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t(`fieldErrors.${nameError}`)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" className="min-h-11" disabled={isPending}>
            {isPending ? t('saving') : t('save')}
          </Button>
          <p
            id={statusId}
            aria-live="polite"
            role="status"
            className="text-muted-foreground text-sm"
          >
            {status === 'saved'
              ? t('saved')
              : status === 'unauthenticated'
                ? t('errors.unauthenticated')
                : status === 'error' && nameError === null
                  ? t('errors.unexpected_error')
                  : ''}
          </p>
        </div>
      </form>

      <dl className="grid gap-5 border-t pt-5 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('email')}
          </dt>
          <dd className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-foreground text-sm break-all">{profile.email}</span>
            <Badge variant={profile.emailVerified ? 'positive' : 'warning'}>
              {profile.emailVerified ? t('verified') : t('unverified')}
            </Badge>
          </dd>
          <p className="text-muted-foreground mt-1 text-xs">{t('emailReadOnly')}</p>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('linkedMethods')}
          </dt>
          <dd className="mt-2">
            <ul className="flex flex-wrap gap-2" aria-label={t('linkedMethods')}>
              {profile.providers.map((provider) => (
                <li key={provider}>
                  <Badge variant="neutral" className="max-w-full whitespace-normal">
                    {t(providerKey(provider))}
                  </Badge>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </div>
  );
}
