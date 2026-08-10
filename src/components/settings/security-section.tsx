'use client';

import { CircleAlert, KeyRound, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState, useTransition, type FormEvent } from 'react';

import { evaluatePasswordPolicy, PASSWORD_MAX_LENGTH } from '@/lib/auth/password-policy';
import { ChangePasswordSchema } from '@/lib/settings/schemas';
import {
  changePasswordAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  type ChangePasswordActionErrorCode,
  type SessionSecurityActionErrorCode,
} from '@/server/actions/account-security';
import type {
  AccountSecurityView,
  ActiveSessionView,
  SessionAgentLabel,
} from '@/server/auth/account-security-dal';
import { PasswordRequirements } from '@/components/auth/password-requirements';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/navigation';

type PasswordField = 'currentPassword' | 'newPassword' | 'confirmNewPassword';
type PasswordErrors = Partial<Record<PasswordField, string>>;

function providerKey(provider: AccountSecurityView['providers'][number]) {
  return `providers.${provider}` as const;
}

function agentKey(agent: SessionAgentLabel) {
  return `sessions.agents.${agent}` as const;
}

function firstFieldErrors(
  fieldErrors?: Readonly<Record<string, readonly string[]>>,
): PasswordErrors {
  const result: PasswordErrors = {};
  const currentPassword = fieldErrors?.currentPassword?.[0];
  const newPassword = fieldErrors?.newPassword?.[0];
  const confirmNewPassword = fieldErrors?.confirmNewPassword?.[0];
  if (currentPassword !== undefined) result.currentPassword = currentPassword;
  if (newPassword !== undefined) result.newPassword = newPassword;
  if (confirmNewPassword !== undefined) result.confirmNewPassword = confirmNewPassword;
  return result;
}

function PasswordFieldError({ id, message }: { id: string; message: string }) {
  const t = useTranslations('settings.security.password.fieldErrors');
  const known = ['required', 'password_policy', 'same_as_current', 'password_mismatch'].includes(
    message,
  );
  return (
    <p id={id} role="alert" className="text-destructive flex items-start gap-2 text-sm">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {t(known ? message : 'validation')}
    </p>
  );
}

function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const t = useTranslations('settings.security.password');
  const router = useRouter();
  const baseId = useId();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [status, setStatus] = useState<ChangePasswordActionErrorCode | 'changed' | null>(null);
  const [isPending, startTransition] = useTransition();
  const policy = useMemo(() => evaluatePasswordPolicy(newPassword), [newPassword]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { currentPassword, newPassword, confirmNewPassword };
    const parsed = ChangePasswordSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(firstFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>));
      setStatus('validation_error');
      return;
    }

    setErrors({});
    setStatus(null);
    startTransition(async () => {
      const result = await changePasswordAction(input);
      if (!result.ok) {
        setErrors(firstFieldErrors(result.error.fieldErrors));
        setStatus(result.error.code);
        router.refresh();
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setStatus('changed');
      onChanged();
      router.refresh();
    });
  }

  const fields: Array<{
    name: PasswordField;
    value: string;
    label: string;
    autocomplete: 'current-password' | 'new-password';
    setValue: (value: string) => void;
  }> = [
    {
      name: 'currentPassword',
      value: currentPassword,
      label: t('currentPassword'),
      autocomplete: 'current-password',
      setValue: setCurrentPassword,
    },
    {
      name: 'newPassword',
      value: newPassword,
      label: t('newPassword'),
      autocomplete: 'new-password',
      setValue: setNewPassword,
    },
    {
      name: 'confirmNewPassword',
      value: confirmNewPassword,
      label: t('confirmNewPassword'),
      autocomplete: 'new-password',
      setValue: setConfirmNewPassword,
    },
  ];

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
      <div>
        <h3 className="text-card-title flex items-center gap-2">
          <KeyRound className="text-primary size-5" aria-hidden="true" />
          {t('title')}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t('description')}</p>
      </div>
      {fields.map((field) => {
        const inputId = `${baseId}-${field.name}`;
        const errorId = `${inputId}-error`;
        const requirementsId = `${baseId}-requirements`;
        const error = errors[field.name];
        return (
          <div key={field.name} className="flex flex-col gap-2">
            <Label htmlFor={inputId}>{field.label}</Label>
            <Input
              id={inputId}
              name={field.name}
              type="password"
              value={field.value}
              autoComplete={field.autocomplete}
              maxLength={PASSWORD_MAX_LENGTH}
              required
              disabled={isPending}
              aria-invalid={error !== undefined}
              aria-describedby={
                field.name === 'newPassword'
                  ? `${requirementsId}${error === undefined ? '' : ` ${errorId}`}`
                  : error === undefined
                    ? undefined
                    : errorId
              }
              onChange={(event) => {
                field.setValue(event.target.value);
                setErrors((current) => ({ ...current, [field.name]: undefined }));
                setStatus(null);
              }}
            />
            {field.name === 'newPassword' ? (
              <PasswordRequirements policy={policy} id={requirementsId} />
            ) : null}
            {error === undefined ? null : <PasswordFieldError id={errorId} message={error} />}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-11" disabled={isPending}>
          {isPending ? t('changing') : t('submit')}
        </Button>
        <p aria-live="polite" role="status" className="text-muted-foreground text-sm">
          {status === 'changed'
            ? t('changed')
            : status !== null && status !== 'validation_error'
              ? t(`errors.${status}`)
              : ''}
        </p>
      </div>
    </form>
  );
}

function SessionRow({
  session,
  formatDate,
  onRevoked,
}: {
  session: ActiveSessionView;
  formatDate: (value: string) => string;
  onRevoked: (sessionId: string) => Promise<void>;
}) {
  const t = useTranslations('settings.security');
  const [pending, setPending] = useState(false);

  async function revoke() {
    setPending(true);
    try {
      await onRevoked(session.sessionId);
    } finally {
      setPending(false);
    }
  }

  const label = t(agentKey(session.agentLabel));
  return (
    <li className="border-border flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <MonitorSmartphone className="text-primary size-5 shrink-0" aria-hidden="true" />
          <p className="text-foreground font-medium break-words">{label}</p>
          {session.isCurrent ? <Badge variant="positive">{t('sessions.current')}</Badge> : null}
        </div>
        <dl className="text-muted-foreground mt-2 flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:flex-wrap sm:gap-x-5">
          <div className="flex min-w-0 flex-wrap gap-1">
            <dt>{t('sessions.created')}</dt>
            <dd>{formatDate(session.createdAt)}</dd>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1">
            <dt>{t('sessions.expires')}</dt>
            <dd>{formatDate(session.expiresAt)}</dd>
          </div>
        </dl>
      </div>
      {session.isCurrent ? null : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="min-h-11 w-full shrink-0 sm:w-auto">
              {t('sessions.revoke')}
              <span className="sr-only">: {label}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('sessions.revokeConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('sessions.revokeConfirmDescription', { session: label })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('sessions.cancel')}</AlertDialogCancel>
              <AlertDialogAction disabled={pending} onClick={() => void revoke()}>
                {t('sessions.revoke')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  );
}

export function SecuritySection({
  security,
  timezone,
}: {
  security: AccountSecurityView;
  timezone: string;
}) {
  const t = useTranslations('settings.security');
  const locale = useLocale();
  const router = useRouter();
  const [sessionStatus, setSessionStatus] = useState<
    SessionSecurityActionErrorCode | 'revoked' | 'allRevoked' | null
  >(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [hiddenSessionIds, setHiddenSessionIds] = useState<ReadonlySet<string>>(new Set());
  const visibleSessions = security.sessions.filter(
    (session) => !hiddenSessionIds.has(session.sessionId),
  );
  const otherSessions = visibleSessions.filter((session) => !session.isCurrent);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }),
    [locale, timezone],
  );

  async function revokeOne(sessionId: string) {
    setSessionStatus(null);
    const result = await revokeSessionAction({ sessionId });
    if (!result.ok) {
      setSessionStatus(result.error.code);
      // Canonical revocation may have succeeded before a later readback/audit
      // failure. Never leave a stale session list claiming it is still active.
      router.refresh();
      return;
    }
    setSessionStatus('revoked');
    setHiddenSessionIds((current) => new Set([...current, sessionId]));
    router.refresh();
  }

  async function revokeAll() {
    setBulkPending(true);
    setSessionStatus(null);
    try {
      const result = await revokeOtherSessionsAction({});
      if (!result.ok) {
        setSessionStatus(result.error.code);
        // Better Auth revokes other rows independently; a partial failure is
        // non-atomic, so always reconcile the UI with a canonical server read.
        router.refresh();
        return;
      }
      setSessionStatus('allRevoked');
      setHiddenSessionIds(
        (current) => new Set([...current, ...otherSessions.map((session) => session.sessionId)]),
      );
      router.refresh();
    } finally {
      setBulkPending(false);
    }
  }

  return (
    <div className="bg-card border-border flex min-w-0 flex-col gap-8 rounded-lg border p-5 sm:p-6">
      <div>
        <h3 className="text-card-title flex items-center gap-2">
          <ShieldCheck className="text-primary size-5" aria-hidden="true" />
          {t('methods.title')}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">{t('methods.description')}</p>
        <ul className="mt-3 flex min-w-0 flex-wrap gap-2">
          {security.providers.map((provider) => (
            <li key={provider}>
              <Badge variant="neutral" className="max-w-full whitespace-normal">
                {t(providerKey(provider))}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t pt-6">
        {security.canChangePassword ? (
          <PasswordForm
            onChanged={() =>
              setHiddenSessionIds(
                (current) =>
                  new Set([...current, ...otherSessions.map((session) => session.sessionId)]),
              )
            }
          />
        ) : (
          <div>
            <h3 className="text-card-title flex items-center gap-2">
              <KeyRound className="text-primary size-5" aria-hidden="true" />
              {t('password.title')}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {t('password.unavailable')}
            </p>
          </div>
        )}
      </div>

      <div className="border-t pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-card-title">{t('sessions.title')}</h3>
            <p className="text-muted-foreground mt-1 text-sm">{t('sessions.description')}</p>
          </div>
          {otherSessions.length === 0 ? null : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="min-h-11 w-full shrink-0 sm:w-auto">
                  {t('sessions.revokeAll')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('sessions.revokeAllConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('sessions.revokeAllConfirmDescription')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('sessions.cancel')}</AlertDialogCancel>
                  <AlertDialogAction disabled={bulkPending} onClick={() => void revokeAll()}>
                    {t('sessions.revokeAll')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <ul className="mt-4 flex min-w-0 flex-col gap-3">
          {visibleSessions.map((session) => (
            <SessionRow
              key={session.sessionId}
              session={session}
              formatDate={(value) => formatter.format(new Date(value))}
              onRevoked={revokeOne}
            />
          ))}
        </ul>
        {otherSessions.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">{t('sessions.none')}</p>
        ) : null}
        <p aria-live="polite" role="status" className="text-muted-foreground mt-4 text-sm">
          {sessionStatus === 'revoked'
            ? t('sessions.revoked')
            : sessionStatus === 'allRevoked'
              ? t('sessions.allRevoked')
              : sessionStatus !== null
                ? t(`sessions.errors.${sessionStatus}`)
                : ''}
        </p>
      </div>
    </div>
  );
}
