'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { cn } from '@/lib/utils';
import {
  changeVatConfigurationAction,
  type VatConfigurationActionCode,
  type VatConfigurationActionResult,
} from '@/server/actions/admin/vat';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { adminCopy } from './admin-copy';

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

function ActionFeedback({ result }: { result: VatConfigurationActionResult | null }) {
  const c = adminCopy.vat;
  if (result === null) return null;
  if (result.ok) {
    return (
      <p className="text-positive text-sm" role="status">
        {result.changed ? c.successLabel : c.noopLabel}
      </p>
    );
  }
  const message: string =
    c.errors[result.code as VatConfigurationActionCode] ?? c.errors.unexpected;
  return (
    <p className="text-negative text-sm" role="alert">
      {message}
    </p>
  );
}

/**
 * The Phase 11F Admin VAT change form — immediate changes only, matching
 * `admin-subscription-support.tsx`'s `GrantComplimentaryDialog` shape
 * exactly (`AlertDialog` + type-to-confirm, since this is a high-risk
 * commercial-boundary mutation). No effective-date picker exists: the
 * server always uses its own transaction time, never a browser-submitted
 * value (see `changeVatConfigurationAction`).
 */
export function AdminVatSupport({
  currentEnabled,
  currentRatePercent,
}: {
  currentEnabled: boolean;
  currentRatePercent: string;
}) {
  const c = adminCopy.vat;
  const router = useRouter();
  const fieldId = useId();
  const [enabled, setEnabled] = useState(currentEnabled);
  const [ratePercent, setRatePercent] = useState(currentRatePercent);
  const [reasonCode, setReasonCode] = useState<'configuration_change' | 'other'>(
    'configuration_change',
  );
  const [note, setNote] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<VatConfigurationActionResult | null>(null);

  function handleOpenChange(open: boolean) {
    if (open) {
      setEnabled(currentEnabled);
      setRatePercent(currentRatePercent);
      setConfirmText('');
      setResult(null);
    }
  }

  function submit() {
    setResult(null);
    startTransition(async () => {
      const response = await changeVatConfigurationAction({
        enabled,
        ratePercent,
        reasonCode,
        ...(note.trim() === '' ? {} : { reasonNote: note.trim() }),
        confirmation: confirmText,
      });
      setResult(response);
      if (response.ok) router.refresh();
    });
  }

  return (
    <AlertDialog onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">{c.changeTriggerLabel}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{c.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>{c.dialogDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-enabled`}>{c.enabledLabel}</Label>
            <FormSelect
              id={`${fieldId}-enabled`}
              value={enabled ? 'enabled' : 'disabled'}
              disabled={pending}
              onChange={(event) => setEnabled(event.target.value === 'enabled')}
            >
              <option value="enabled">{c.statusEnabled}</option>
              <option value="disabled">{c.statusDisabled}</option>
            </FormSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-rate`}>{c.rateInputLabel}</Label>
            <Input
              id={`${fieldId}-rate`}
              inputMode="decimal"
              value={ratePercent}
              disabled={pending}
              onChange={(event) => setRatePercent(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">{c.rateInputHint}</p>
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
          <ActionFeedback result={result} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{c.cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || confirmText !== c.confirmPhrase || ratePercent.trim() === ''}
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
