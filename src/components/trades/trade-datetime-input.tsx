'use client';

import { useEffect, useState } from 'react';

import { FormInput } from '@/components/trades/trade-action-form';
import { instantToDatetimeLocal } from '@/components/trades/trade-form-values';

export function TradeDateTimeInput({
  id,
  name,
  timezone,
  instant,
  required,
}: {
  id: string;
  name: string;
  timezone: string;
  /** A stored UTC instant, or null to populate the current instant after hydration. */
  instant: string | null;
  required?: boolean;
}) {
  const [value, setValue] = useState(() => instantToDatetimeLocal(instant, timezone));

  useEffect(() => {
    if (instant !== null) return;
    const timeout = window.setTimeout(() => {
      setValue(instantToDatetimeLocal(new Date().toISOString(), timezone));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [instant, timezone]);

  return (
    <FormInput
      id={id}
      name={name}
      type="datetime-local"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      required={required}
    />
  );
}
