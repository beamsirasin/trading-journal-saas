'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { cn } from '@/lib/utils';
import {
  extendTrialAction,
  grantComplimentaryPlanAction,
  revokeComplimentaryPlanAction,
  type AdminSubscriptionActionCode,
  type AdminSubscriptionActionResult,
} from '@/server/actions/admin/subscription-support';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { adminCopy } from './admin-copy';

const PLAN_OPTIONS = ['starter', 'trader', 'professional'] as const;

function FormSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full min-w-0 rounded-md border px-3 text-base outline-none focus-visible:ring-[3px] disabled:opacity-60',
        props.className,
      )}
    />
  );
}

function ActionFeedback({
  result,
  successLabel,
  noopLabel,
}: {
  result: AdminSubscriptionActionResult | null;
  successLabel: string;
  noopLabel: string;
}) {
  if (result === null) return null;
  if (result.ok) {
    return (
      <p className="text-positive text-sm" role="status">
        {result.changed ? successLabel : noopLabel}
      </p>
    );
  }
  const errors = adminCopy.workspaces.detail.subscriptionSupport.errors;
  const message: string = errors[result.code as AdminSubscriptionActionCode] ?? errors.unexpected;
  return (
    <p className="text-negative text-sm" role="alert">
      {message}
    </p>
  );
}

function toUtcInputValue(iso: string | null): string {
  if (iso === null) return '';
  return iso.slice(0, 16);
}

// ---------------------------------------------------------------------------
// Extend Trial
// ---------------------------------------------------------------------------

function ExtendTrialDialog({
  workspaceId,
  currentTrialEndsAt,
}: {
  workspaceId: string;
  currentTrialEndsAt: string | null;
}) {
  const c = adminCopy.workspaces.detail.subscriptionSupport.extendTrial;
  const router = useRouter();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [newEnd, setNewEnd] = useState('');
  const [reasonCode, setReasonCode] = useState<
    'trial_extension_goodwill' | 'support_adjustment' | 'other'
  >('trial_extension_goodwill');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AdminSubscriptionActionResult | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setNewEnd(toUtcInputValue(currentTrialEndsAt));
      setResult(null);
    }
  }

  function submit() {
    setResult(null);
    startTransition(async () => {
      const isoValue = newEnd.length === 16 ? `${newEnd}:00.000Z` : newEnd;
      const response = await extendTrialAction({
        workspaceId,
        newTrialEndsAt: isoValue,
        reasonCode,
        ...(note.trim() === '' ? {} : { reasonNote: note.trim() }),
      });
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">{c.triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={adminCopy.workspaces.detail.subscriptionSupport.cancelLabel}>
        <DialogHeader>
          <DialogTitle>{c.dialogTitle}</DialogTitle>
          <DialogDescription>{c.dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div>
            <Label>{c.currentEndLabel}</Label>
            <p className="text-muted-foreground mt-1 text-sm">
              {currentTrialEndsAt === null ? '—' : currentTrialEndsAt}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-new-end`}>{c.newEndLabel}</Label>
            <Input
              id={`${fieldId}-new-end`}
              type="datetime-local"
              value={newEnd}
              disabled={pending}
              onChange={(event) => setNewEnd(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-reason`}>{c.reasonLabel}</Label>
            <FormSelect
              id={`${fieldId}-reason`}
              value={reasonCode}
              disabled={pending}
              onChange={(event) => setReasonCode(event.target.value as typeof reasonCode)}
            >
              {Object.entries(c.reasonOptions).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-note`}>{c.noteLabel}</Label>
            <Textarea
              id={`${fieldId}-note`}
              value={note}
              disabled={pending}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <ActionFeedback result={result} successLabel={c.successLabel} noopLabel={c.noopLabel} />
        </div>
        <DialogFooter>
          <Button type="button" disabled={pending || newEnd === ''} onClick={submit}>
            {pending ? c.submittingLabel : c.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Grant / Change Complimentary Plan
// ---------------------------------------------------------------------------

function GrantComplimentaryDialog({
  workspaceId,
  isChange,
}: {
  workspaceId: string;
  isChange: boolean;
}) {
  const c = adminCopy.workspaces.detail.subscriptionSupport.grantComplimentary;
  const router = useRouter();
  const fieldId = useId();
  const [planKey, setPlanKey] = useState<(typeof PLAN_OPTIONS)[number]>('starter');
  const [reasonCode, setReasonCode] = useState<
    'complimentary_access' | 'support_adjustment' | 'other'
  >('complimentary_access');
  const [note, setNote] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AdminSubscriptionActionResult | null>(null);

  function submit() {
    setResult(null);
    startTransition(async () => {
      const response = await grantComplimentaryPlanAction({
        workspaceId,
        planKey,
        reasonCode,
        ...(note.trim() === '' ? {} : { reasonNote: note.trim() }),
      });
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">{isChange ? c.changeTriggerLabel : c.triggerLabel}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{c.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>{c.dialogDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-plan`}>{c.planLabel}</Label>
            <FormSelect
              id={`${fieldId}-plan`}
              value={planKey}
              disabled={pending}
              onChange={(event) => setPlanKey(event.target.value as typeof planKey)}
            >
              {PLAN_OPTIONS.map((plan) => (
                <option key={plan} value={plan}>
                  {adminCopy.subscriptionLabels.plan[plan]}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-reason`}>{c.reasonLabel}</Label>
            <FormSelect
              id={`${fieldId}-reason`}
              value={reasonCode}
              disabled={pending}
              onChange={(event) => setReasonCode(event.target.value as typeof reasonCode)}
            >
              {Object.entries(c.reasonOptions).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-note`}>{c.noteLabel}</Label>
            <Textarea
              id={`${fieldId}-note`}
              value={note}
              disabled={pending}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-confirm`}>{c.confirmLabel}</Label>
            <Input
              id={`${fieldId}-confirm`}
              value={confirmText}
              disabled={pending}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
            />
          </div>
          <ActionFeedback result={result} successLabel={c.successLabel} noopLabel={c.noopLabel} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {adminCopy.workspaces.detail.subscriptionSupport.cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || confirmText !== c.confirmPhrase}
            onClick={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {pending ? c.submittingLabel : c.submitLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Revoke Complimentary Plan
// ---------------------------------------------------------------------------

function RevokeComplimentaryDialog({ workspaceId }: { workspaceId: string }) {
  const c = adminCopy.workspaces.detail.subscriptionSupport.revokeComplimentary;
  const router = useRouter();
  const fieldId = useId();
  const [reasonCode, setReasonCode] = useState<'access_revoke' | 'support_adjustment' | 'other'>(
    'access_revoke',
  );
  const [note, setNote] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AdminSubscriptionActionResult | null>(null);

  function submit() {
    setResult(null);
    startTransition(async () => {
      const response = await revokeComplimentaryPlanAction({
        workspaceId,
        reasonCode,
        ...(note.trim() === '' ? {} : { reasonNote: note.trim() }),
      });
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">{c.triggerLabel}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{c.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>{c.dialogDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-reason`}>{c.reasonLabel}</Label>
            <FormSelect
              id={`${fieldId}-reason`}
              value={reasonCode}
              disabled={pending}
              onChange={(event) => setReasonCode(event.target.value as typeof reasonCode)}
            >
              {Object.entries(c.reasonOptions).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </FormSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-note`}>{c.noteLabel}</Label>
            <Textarea
              id={`${fieldId}-note`}
              value={note}
              disabled={pending}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-confirm`}>{c.confirmLabel}</Label>
            <Input
              id={`${fieldId}-confirm`}
              value={confirmText}
              disabled={pending}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
            />
          </div>
          <ActionFeedback result={result} successLabel={c.successLabel} noopLabel={c.noopLabel} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {adminCopy.workspaces.detail.subscriptionSupport.cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending || confirmText !== c.confirmPhrase}
            onClick={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {pending ? c.submittingLabel : c.submitLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function AdminSubscriptionSupport({
  workspaceId,
  source,
  trialEndsAt,
}: {
  workspaceId: string;
  source: 'trial' | 'paid' | 'complimentary' | null;
  trialEndsAt: string | null;
}) {
  const c = adminCopy.workspaces.detail.subscriptionSupport;

  return (
    <section
      aria-labelledby="admin-workspace-subscription-support-heading"
      className="border-border bg-card rounded-xl border p-5 sm:p-6"
    >
      <h2 id="admin-workspace-subscription-support-heading" className="text-card-title mb-4">
        {c.title}
      </h2>
      {source === 'paid' ? (
        <p className="text-muted-foreground text-sm">{c.paidNotice}</p>
      ) : source === 'trial' ? (
        <div className="flex flex-wrap gap-3">
          <ExtendTrialDialog workspaceId={workspaceId} currentTrialEndsAt={trialEndsAt} />
          <GrantComplimentaryDialog workspaceId={workspaceId} isChange={false} />
        </div>
      ) : source === 'complimentary' ? (
        <div className="flex flex-wrap gap-3">
          <GrantComplimentaryDialog workspaceId={workspaceId} isChange />
          <RevokeComplimentaryDialog workspaceId={workspaceId} />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{c.unavailableNotice}</p>
      )}
    </section>
  );
}
