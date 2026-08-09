'use client';

import { CircleAlert, LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type FormEvent } from 'react';

import { UpdateWorkspaceNameSchema, WORKSPACE_NAME_MAX_LENGTH } from '@/lib/settings/schemas';
import { updateWorkspaceNameAction } from '@/server/actions/workspace';
import type { SettingsWorkspaceSummary } from '@/server/auth/settings-dal';
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

export function WorkspaceForm({ workspace }: { workspace: SettingsWorkspaceSummary }) {
  const t = useTranslations('settings.workspace');
  const router = useRouter();
  const inputId = useId();
  const [name, setName] = useState(workspace.name);
  const [nameError, setNameError] = useState<NameError | null>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'unauthenticated'>('idle');
  const [isPending, startTransition] = useTransition();
  const editable = workspace.renameAvailability === 'available';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;
    const parsed = UpdateWorkspaceNameSchema.safeParse({ name });
    if (!parsed.success) {
      setNameError(mapNameError(parsed.error.flatten().fieldErrors.name?.[0]));
      setStatus('error');
      return;
    }

    setNameError(null);
    setStatus('idle');
    startTransition(async () => {
      const result = await updateWorkspaceNameAction({ name });
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
  const blockedId = `${inputId}-blocked`;

  return (
    <div className="bg-card border-border flex min-w-0 flex-col gap-6 rounded-lg border p-5 sm:p-6">
      <dl className="flex min-w-0 flex-wrap gap-x-8 gap-y-4">
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('type')}
          </dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
            {t('personal')}
            <Badge variant="neutral">{t(`role.${workspace.role}`)}</Badge>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('access')}
          </dt>
          <dd className="mt-1 text-sm font-semibold">{t(`accessMode.${workspace.accessMode}`)}</dd>
        </div>
      </dl>

      <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId}>{t('name')}</Label>
          <Input
            id={inputId}
            name="name"
            value={name}
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
              setStatus('idle');
            }}
            aria-invalid={nameError !== null}
            aria-describedby={
              nameError !== null
                ? `${errorId} ${statusId}`
                : editable
                  ? statusId
                  : `${blockedId} ${statusId}`
            }
            disabled={!editable || isPending}
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
          {editable ? null : (
            <p id={blockedId} className="text-muted-foreground flex items-start gap-2 text-sm">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t(`blocked.${workspace.renameAvailability}`)}
            </p>
          )}
        </div>
        {editable ? (
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
        ) : (
          <p id={statusId} aria-live="polite" role="status" className="sr-only" />
        )}
      </form>
    </div>
  );
}
