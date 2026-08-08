'use client';

import type { ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function TradeField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormInput(props: React.ComponentProps<typeof Input>) {
  return <Input {...props} className={`min-h-11 ${props.className ?? ''}`} />;
}

export function FormTextarea(props: React.ComponentProps<typeof Textarea>) {
  return <Textarea {...props} className={`min-h-24 ${props.className ?? ''}`} />;
}

export function NativeSelect(props: React.ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={`border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-11 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`}
    />
  );
}

export function ActionFeedback({
  message,
  success,
}: {
  message: string | null;
  success?: boolean;
}) {
  if (message === null) return null;
  return (
    <p
      role={success ? 'status' : 'alert'}
      className={success ? 'text-success text-sm' : 'text-destructive text-sm'}
    >
      {message}
    </p>
  );
}

export interface TradeActionFailure {
  readonly ok: false;
  readonly error: { readonly code: string };
}

export function actionErrorCode(result: unknown): string | null {
  if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== false) {
    return null;
  }
  const error = 'error' in result ? result.error : null;
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'unexpected_error';
  return typeof error.code === 'string' ? error.code : 'unexpected_error';
}
