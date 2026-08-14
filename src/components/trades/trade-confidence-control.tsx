'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';

import {
  CONFIDENCE_LEVELS,
  confidenceLevelKey,
  type ConfidenceLevelKey,
} from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

/** Increasing fill intensity of the same brand hue, left to right — confidence is not an outcome, so it deliberately never borrows the Direction/Outcome red-green vocabulary. */
const ZONE_FILL: Record<ConfidenceLevelKey, string> = {
  veryLow: 'bg-brand/10',
  low: 'bg-brand/30',
  neutral: 'bg-brand/50',
  high: 'bg-brand/70',
  veryHigh: 'bg-brand/90',
};

const KEYBOARD_STEP = 1;
const KEYBOARD_PAGE_STEP = 10;

/**
 * A true continuous 0–100 Confidence control (Founder-UAT Trade Plan UX
 * correction slice §8 — `trades.confidence` is a `smallint` widened from
 * 1–5 to 0–100 by migration 0010, and every integer in that range is a
 * genuinely reachable, distinct stored value; this control never quantizes
 * back down to five discrete steps). The five background zones are purely
 * visual/qualitative labelling (`CONFIDENCE_LEVELS`,
 * `src/lib/trades/constants.ts` — the same table `TradeDetail`'s read-side
 * rendering uses) — they never constrain where the thumb can land.
 *
 * A single-thumb custom slider (`role="slider"` on the thumb, not the
 * track): click-to-position anywhere on the track, drag (pointer capture),
 * and full keyboard operation (arrow keys ±1, Page Up/Down ±10, Home = 0,
 * End = 100). `null` (unset) remains representable — Confidence is
 * optional — communicated via `aria-valuetext` since ARIA's slider role has
 * no native "unset" state.
 */
export function TradeConfidenceControl({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const t = useTranslations('trades');
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  function valueFromClientX(clientX: number): number {
    const el = trackRef.current;
    if (el === null) return value ?? 50;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return value ?? 50;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * 100);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const current = value ?? 50;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      onChange(Math.min(100, current + KEYBOARD_STEP));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      onChange(Math.max(0, current - KEYBOARD_STEP));
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      onChange(Math.min(100, current + KEYBOARD_PAGE_STEP));
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      onChange(Math.max(0, current - KEYBOARD_PAGE_STEP));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(100);
    }
  }

  const level = value === null ? null : confidenceLevelKey(value);
  const valueText =
    value === null ? t('common.notSet') : `${value}/100 · ${t(`create.confidence.level.${level}`)}`;
  const thumbPosition = value ?? 50;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor={id}>
          {label} <span className="text-muted-foreground font-normal">{t('common.optional')}</span>
        </Label>
        <span className="text-sm font-medium">
          {value === null ? <span className="text-muted-foreground">{valueText}</span> : valueText}
        </span>
      </div>

      <div
        ref={trackRef}
        className="border-border relative flex h-9 touch-none overflow-hidden rounded-md border"
        onPointerDown={(event) => {
          onChange(valueFromClientX(event.clientX));
          thumbRef.current?.focus();
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) return;
          onChange(valueFromClientX(event.clientX));
        }}
      >
        <div className="flex flex-1" aria-hidden="true">
          {CONFIDENCE_LEVELS.map((zone) => (
            <div key={zone.key} className={cn('flex-1', ZONE_FILL[zone.key])} />
          ))}
        </div>
        <div
          id={id}
          ref={thumbRef}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value ?? 50}
          aria-valuetext={valueText}
          onKeyDown={handleKeyDown}
          className="border-background bg-brand focus-visible:ring-ring absolute top-0 h-full w-3 -translate-x-1/2 rounded border-2 shadow focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
          style={{ left: `${thumbPosition}%` }}
        />
      </div>
      <div className="text-muted-foreground flex justify-between text-[11px]">
        <span>{t('create.confidence.level.veryLow')}</span>
        <span>{t('create.confidence.level.veryHigh')}</span>
      </div>
      {value === null ? null : (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-muted-foreground hover:text-foreground self-start text-xs underline-offset-4 hover:underline"
        >
          {t('create.confidence.clear')}
        </button>
      )}
    </div>
  );
}
