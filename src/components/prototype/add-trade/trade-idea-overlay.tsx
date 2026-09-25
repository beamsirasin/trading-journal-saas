'use client';

import { Check, ChevronLeft, ChevronRight, ImageIcon, Link2, Upload } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useIsDesktopViewport } from '@/hooks/use-is-desktop-viewport';

import { PROTOTYPE_STRATEGIES } from '../fixtures';
import { AdaptiveOverlay, OverlayActions } from './adaptive-overlay';
import { Field } from './form-primitives';
import type { ChartAttachment, PlanDraft } from './journal-editors';

type View = 'idea' | 'strategy' | 'chart';
type MobileStrategyPane = 'strategies' | 'setups';

type StrategyChoice =
  | { readonly kind: 'unselected' }
  | { readonly kind: 'none' }
  | { readonly kind: 'strategy'; readonly name: string; readonly setup: string | null };

const NO_STRATEGY_VALUE = '__no_strategy__';
const NOT_SELECTED_VALUE = '__not_selected__';
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * The Still-open Trade idea owns one adaptive overlay and changes only its
 * contents. Strategy/Setup and Chart are routes inside this editing session,
 * never nested focus traps, and only the outer Done crosses the draft boundary.
 */
export function TradeIdeaOverlay({
  open,
  onOpenChange,
  draft,
  onChange,
  onDone,
  onCancel,
  reasonPrompt,
  ideaDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  onDone: () => void;
  onCancel: () => void;
  /** Keeps the shared editor truthful in both live and retrospective flows. */
  reasonPrompt: string;
  /** The same lifecycle-aware tense for the editor's introductory sentence. */
  ideaDescription: string;
}) {
  const isDesktop = useIsDesktopViewport();
  const [view, setView] = useState<View>('idea');
  const [mobilePane, setMobilePane] = useState<MobileStrategyPane>('strategies');
  const [strategyChoice, setStrategyChoice] = useState<StrategyChoice>(() => choiceFrom(draft));
  const [link, setLink] = useState('');
  const [chartError, setChartError] = useState<string | null>(null);

  const strategyLauncherRef = useRef<HTMLButtonElement>(null);
  const chartLauncherRef = useRef<HTMLButtonElement>(null);
  const firstStrategyRef = useRef<HTMLInputElement>(null);
  const setupBackRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const uploadGeneration = useRef(0);
  const wasOpen = useRef(open);

  // Reopening always begins at Trade idea, even if Escape dismissed a subview.
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setView('idea');
      setMobilePane('strategies');
      setChartError(null);
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || view === 'idea') return;
    const frame = requestAnimationFrame(() => {
      if (view === 'chart') linkRef.current?.focus();
      else if (!isDesktop && mobilePane === 'setups') setupBackRef.current?.focus();
      else firstStrategyRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isDesktop, mobilePane, open, view]);

  const patch = (next: Partial<PlanDraft>) => onChange({ ...draft, ...next });

  function openStrategyPicker() {
    setStrategyChoice(choiceFrom(draft));
    setMobilePane('strategies');
    setView('strategy');
  }

  function openChartAttachment() {
    setLink(draft.chart?.kind === 'link' ? draft.chart.url : '');
    setChartError(null);
    setView('chart');
  }

  function returnToIdea(focus: 'strategy' | 'chart') {
    uploadGeneration.current += 1;
    setView('idea');
    requestAnimationFrame(() => {
      (focus === 'strategy' ? strategyLauncherRef : chartLauncherRef).current?.focus();
    });
  }

  function dismiss() {
    uploadGeneration.current += 1;
    onCancel();
    onOpenChange(false);
  }

  function finish() {
    uploadGeneration.current += 1;
    onDone();
    onOpenChange(false);
  }

  function applyStrategyChoice() {
    if (strategyChoice.kind === 'strategy') {
      patch({
        noStrategy: false,
        strategy: strategyChoice.name,
        setup: strategyChoice.setup,
      });
    } else {
      patch({
        noStrategy: strategyChoice.kind === 'none',
        strategy: null,
        setup: null,
      });
    }
    returnToIdea('strategy');
  }

  function attachLink() {
    const normalized = normalizeChartLink(link);
    if (normalized === null) {
      setChartError('Enter a complete http or https chart link.');
      linkRef.current?.focus();
      return;
    }
    patch({ chart: { kind: 'link', url: normalized } });
    returnToIdea('chart');
  }

  function attachUpload(file: File | undefined) {
    if (file === undefined) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setChartError('Choose a PNG, JPG, JPEG, or WebP image.');
      return;
    }

    const generation = ++uploadGeneration.current;
    const reader = new FileReader();
    reader.onerror = () => {
      if (uploadGeneration.current === generation) {
        setChartError('This image could not be read. Choose another image.');
      }
    };
    reader.onload = () => {
      if (uploadGeneration.current !== generation || typeof reader.result !== 'string') return;
      patch({ chart: { kind: 'upload', name: file.name, dataUrl: reader.result } });
      returnToIdea('chart');
    };
    reader.readAsDataURL(file);
  }

  const title =
    view === 'idea'
      ? 'Trade idea'
      : view === 'chart'
        ? 'Attach chart'
        : isDesktop
          ? 'Strategy & setup'
          : mobilePane === 'strategies'
            ? 'Choose strategy'
            : 'Choose setup';

  const description =
    view === 'idea'
      ? ideaDescription
      : view === 'chart'
        ? 'Paste a chart link or upload an image from this device.'
        : isDesktop
          ? 'Choose a trading method and, when it has one, an optional setup.'
          : mobilePane === 'strategies'
            ? 'Choose the main trading method for this trade.'
            : strategyChoice.kind === 'strategy'
              ? strategyChoice.name
              : 'Choose an optional setup.';

  return (
    <AdaptiveOverlay
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
      returnFocusTo='[data-journal-area="idea"]'
      title={title}
      description={description}
      className="sm:max-w-[50rem]"
      footer={
        view === 'idea' ? (
          <OverlayActions
            secondary={
              <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={dismiss}>
                Cancel
              </Button>
            }
            primary={
              <Button type="button" className="w-full sm:w-auto" onClick={finish}>
                Done
              </Button>
            }
          />
        ) : view === 'strategy' ? (
          <OverlayActions
            secondary={
              <Button
                type="button"
                variant="ghost"
                className="w-full sm:w-auto"
                onClick={() => returnToIdea('strategy')}
              >
                Back to Trade idea
              </Button>
            }
            primary={
              <Button type="button" className="w-full sm:w-auto" onClick={applyStrategyChoice}>
                Use selection
              </Button>
            }
          />
        ) : (
          <OverlayActions
            secondary={
              <Button
                type="button"
                variant="ghost"
                className="w-full sm:w-auto"
                onClick={() => returnToIdea('chart')}
              >
                Back to Trade idea
              </Button>
            }
            primary={
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={link.trim() === ''}
                onClick={attachLink}
              >
                Attach link
              </Button>
            }
          />
        )
      }
    >
      {view === 'idea' ? (
        <TradeIdeaView
          draft={draft}
          onChange={onChange}
          reasonPrompt={reasonPrompt}
          onOpenStrategy={openStrategyPicker}
          onOpenChart={openChartAttachment}
          strategyLauncherRef={strategyLauncherRef}
          chartLauncherRef={chartLauncherRef}
        />
      ) : view === 'chart' ? (
        <ChartAttachmentView
          link={link}
          onLinkChange={(value) => {
            setLink(value);
            setChartError(null);
          }}
          onUpload={attachUpload}
          error={chartError}
          linkRef={linkRef}
        />
      ) : isDesktop ? (
        <DesktopStrategyPicker
          choice={strategyChoice}
          onChange={setStrategyChoice}
          firstStrategyRef={firstStrategyRef}
        />
      ) : mobilePane === 'strategies' ? (
        <MobileStrategyPicker
          choice={strategyChoice}
          onChange={(choice) => {
            setStrategyChoice(choice);
            if (choice.kind === 'strategy') setMobilePane('setups');
          }}
          firstStrategyRef={firstStrategyRef}
        />
      ) : (
        <MobileSetupPicker
          choice={strategyChoice}
          onChange={setStrategyChoice}
          onBack={() => setMobilePane('strategies')}
          backRef={setupBackRef}
        />
      )}
    </AdaptiveOverlay>
  );
}

function TradeIdeaView({
  draft,
  onChange,
  reasonPrompt,
  onOpenStrategy,
  onOpenChart,
  strategyLauncherRef,
  chartLauncherRef,
}: {
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  reasonPrompt: string;
  onOpenStrategy: () => void;
  onOpenChart: () => void;
  strategyLauncherRef: React.RefObject<HTMLButtonElement | null>;
  chartLauncherRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Field label={reasonPrompt}>
        {(id) => (
          <textarea
            id={id}
            rows={4}
            value={draft.reason}
            onChange={(event) => onChange({ ...draft, reason: event.target.value })}
            placeholder="What you saw, and why it was worth risking money on."
            className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
          />
        )}
      </Field>

      <div className="flex min-w-0 flex-col gap-2">
        <button
          ref={strategyLauncherRef}
          type="button"
          onClick={onOpenStrategy}
          className="border-border bg-muted/20 hover:bg-accent/50 focus-visible:ring-ring flex min-h-16 w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none focus-visible:ring-2"
        >
          <span className="min-w-0 flex-1">
            <span className="text-muted-foreground mb-0.5 block text-xs">Strategy &amp; setup</span>
            <span className="text-foreground block truncate text-sm font-medium">
              {draft.noStrategy ? 'No strategy' : (draft.strategy ?? 'Not selected')}
            </span>
            {draft.strategy === null ? null : (
              <span className="text-muted-foreground block truncate text-xs">
                {draft.setup ?? 'No setup'}
              </span>
            )}
          </span>
          <ChevronRight className="text-subtle-foreground size-4 shrink-0" aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-foreground text-sm font-medium">Chart</h3>
        {draft.chart === null ? (
          <button
            ref={chartLauncherRef}
            type="button"
            onClick={onOpenChart}
            className="border-border bg-muted/20 hover:bg-accent/50 focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left outline-none focus-visible:ring-2"
          >
            <span className="text-muted-foreground min-w-0 flex-1 text-sm">No chart attached</span>
            <span className="text-primary-text text-sm font-medium">Attach</span>
            <ChevronRight className="text-subtle-foreground size-4 shrink-0" aria-hidden="true" />
          </button>
        ) : (
          <AttachedChartSummary
            chart={draft.chart}
            onViewReplacement={onOpenChart}
            onRemove={() => onChange({ ...draft, chart: null })}
            launcherRef={chartLauncherRef}
          />
        )}
      </div>
    </div>
  );
}

function AttachedChartSummary({
  chart,
  onViewReplacement,
  onRemove,
  launcherRef,
}: {
  chart: ChartAttachment;
  onViewReplacement: () => void;
  onRemove: () => void;
  launcherRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const label = chart.kind === 'upload' ? 'Uploaded image' : chartLabel(chart.url);
  const href = chart.kind === 'upload' ? chart.dataUrl : chart.url;

  return (
    <div className="border-border bg-muted/20 flex min-w-0 items-center gap-3 rounded-xl border p-3">
      {chart.kind === 'upload' ? (
        // A data URL is local prototype state, so no remote-image policy is involved.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={chart.dataUrl}
          alt=""
          width={72}
          height={48}
          className="border-border h-12 w-[4.5rem] shrink-0 rounded-md border object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="bg-primary/10 text-primary-text flex size-12 shrink-0 items-center justify-center rounded-lg"
        >
          <Link2 className="size-5" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm font-medium">{label}</p>
        {chart.kind === 'upload' ? (
          <p className="text-muted-foreground truncate text-xs">{chart.name}</p>
        ) : null}
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary-text focus-visible:ring-ring relative rounded-sm text-xs font-medium underline-offset-4 outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] hover:underline focus-visible:ring-2"
          >
            View
          </a>
          <button
            ref={launcherRef}
            type="button"
            onClick={onViewReplacement}
            className="text-primary-text focus-visible:ring-ring relative rounded-sm text-xs font-medium underline-offset-4 outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] hover:underline focus-visible:ring-2"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring relative rounded-sm text-xs font-medium underline-offset-4 outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] hover:underline focus-visible:ring-2"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function ChartAttachmentView({
  link,
  onLinkChange,
  onUpload,
  error,
  linkRef,
}: {
  link: string;
  onLinkChange: (value: string) => void;
  onUpload: (file: File | undefined) => void;
  error: string | null;
  linkRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Field label="Chart link" hint="TradingView and direct chart-image links are supported.">
        {(id) => (
          <input
            ref={linkRef}
            id={id}
            type="url"
            inputMode="url"
            value={link}
            onChange={(event) => onLinkChange(event.target.value)}
            placeholder="Paste TradingView chart link…"
            aria-invalid={error === null ? undefined : true}
            aria-describedby={error === null ? undefined : 'trade-idea-chart-link-error'}
            className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
          />
        )}
      </Field>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="border-border h-px flex-1 border-t" />
        <span className="text-subtle-foreground text-xs uppercase">or</span>
        <span className="border-border h-px flex-1 border-t" />
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor="trade-idea-chart-upload" className="text-foreground text-sm font-medium">
          Upload image
        </label>
        <div className="border-border bg-muted/20 rounded-xl border p-3">
          <div className="mb-2 flex items-center gap-2">
            <span
              className="bg-primary/10 text-primary-text flex size-9 shrink-0 items-center justify-center rounded-lg"
              aria-hidden="true"
            >
              <Upload className="size-4" />
            </span>
            <p className="text-muted-foreground text-xs">PNG, JPG, JPEG, or WebP</p>
          </div>
          <input
            id="trade-idea-chart-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            onChange={(event) => onUpload(event.target.files?.[0])}
            className="border-input bg-background text-foreground file:bg-secondary file:text-secondary-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-11 w-full min-w-0 rounded-md border text-sm file:mr-3 file:min-h-11 file:border-0 file:px-3 file:text-sm file:font-medium focus-visible:ring-[3px] focus-visible:outline-none"
          />
        </div>
      </div>

      {error === null ? null : (
        <p id="trade-idea-chart-link-error" role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function DesktopStrategyPicker({
  choice,
  onChange,
  firstStrategyRef,
}: {
  choice: StrategyChoice;
  onChange: (choice: StrategyChoice) => void;
  firstStrategyRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="border-border grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] overflow-hidden rounded-xl border">
      <StrategyList choice={choice} onChange={onChange} firstStrategyRef={firstStrategyRef} />
      <div className="border-border min-w-0 border-l p-3 sm:p-4">
        <SetupList choice={choice} onChange={onChange} />
      </div>
    </div>
  );
}

function MobileStrategyPicker({
  choice,
  onChange,
  firstStrategyRef,
}: {
  choice: StrategyChoice;
  onChange: (choice: StrategyChoice) => void;
  firstStrategyRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <StrategyList choice={choice} onChange={onChange} firstStrategyRef={firstStrategyRef} drillIn />
  );
}

function MobileSetupPicker({
  choice,
  onChange,
  onBack,
  backRef,
}: {
  choice: StrategyChoice;
  onChange: (choice: StrategyChoice) => void;
  onBack: () => void;
  backRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Button ref={backRef} type="button" variant="ghost" className="-ml-3 w-fit" onClick={onBack}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        Strategies
      </Button>
      <SetupList choice={choice} onChange={onChange} />
    </div>
  );
}

function StrategyList({
  choice,
  onChange,
  firstStrategyRef,
  drillIn = false,
}: {
  choice: StrategyChoice;
  onChange: (choice: StrategyChoice) => void;
  firstStrategyRef: React.RefObject<HTMLInputElement | null>;
  drillIn?: boolean;
}) {
  const selectedValue =
    choice.kind === 'strategy'
      ? choice.name
      : choice.kind === 'none'
        ? NO_STRATEGY_VALUE
        : NOT_SELECTED_VALUE;

  function choose(value: string) {
    if (value === NOT_SELECTED_VALUE) onChange({ kind: 'unselected' });
    else if (value === NO_STRATEGY_VALUE) onChange({ kind: 'none' });
    else {
      onChange({
        kind: 'strategy',
        name: value,
        setup: choice.kind === 'strategy' && choice.name === value ? choice.setup : null,
      });
    }
  }

  return (
    <fieldset className="min-w-0 p-3 sm:p-4">
      <legend className="text-label text-muted-foreground px-1 uppercase">Strategy</legend>
      <div className="mt-2 flex min-w-0 flex-col gap-1">
        {PROTOTYPE_STRATEGIES.map((strategy, index) => (
          <SelectionRow
            key={strategy.name}
            {...(index === 0 ? { inputRef: firstStrategyRef } : {})}
            name="trade-idea-strategy"
            value={strategy.name}
            checked={selectedValue === strategy.name}
            onChange={choose}
            trailing={drillIn ? <ChevronRight className="size-4" aria-hidden="true" /> : undefined}
          >
            {strategy.name}
          </SelectionRow>
        ))}
        <div className="border-border my-1 border-t" />
        <SelectionRow
          name="trade-idea-strategy"
          value={NOT_SELECTED_VALUE}
          checked={selectedValue === NOT_SELECTED_VALUE}
          onChange={choose}
        >
          Not selected
        </SelectionRow>
        <SelectionRow
          name="trade-idea-strategy"
          value={NO_STRATEGY_VALUE}
          checked={selectedValue === NO_STRATEGY_VALUE}
          onChange={choose}
        >
          No strategy
        </SelectionRow>
      </div>
    </fieldset>
  );
}

function SetupList({
  choice,
  onChange,
}: {
  choice: StrategyChoice;
  onChange: (choice: StrategyChoice) => void;
}) {
  if (choice.kind !== 'strategy') {
    return (
      <div className="min-w-0">
        <p className="text-label text-muted-foreground px-1 uppercase">Setup</p>
        <div className="flex min-h-40 min-w-0 flex-col items-center justify-center px-3 text-center">
          <ImageIcon className="text-subtle-foreground mb-2 size-5" aria-hidden="true" />
          <p className="text-foreground text-sm font-medium">
            {choice.kind === 'none' ? 'No strategy selected' : 'Choose a strategy'}
          </p>
          <p className="text-muted-foreground mt-1 max-w-56 text-xs">
            {choice.kind === 'none'
              ? 'This trade will not use a defined strategy or setup.'
              : 'Its setup options will appear here.'}
          </p>
        </div>
      </div>
    );
  }

  const strategy = PROTOTYPE_STRATEGIES.find((item) => item.name === choice.name);
  const setups = strategy?.setups ?? [];

  if (setups.length === 0) {
    return (
      <div className="min-w-0">
        <p className="text-label text-muted-foreground px-1 uppercase">Setup</p>
        <div className="flex min-h-40 min-w-0 flex-col items-center justify-center px-3 text-center">
          <p className="text-foreground text-sm font-medium">No setups yet</p>
          <p className="text-muted-foreground mt-1 max-w-56 text-xs">
            You can use this strategy without a setup.
          </p>
        </div>
      </div>
    );
  }

  return (
    <fieldset className="min-w-0">
      <legend className="text-label text-muted-foreground px-1 uppercase">Setup</legend>
      <div className="mt-2 flex min-w-0 flex-col gap-1">
        <SelectionRow
          name="trade-idea-setup"
          value=""
          checked={choice.setup === null}
          onChange={() => onChange({ ...choice, setup: null })}
        >
          No setup
        </SelectionRow>
        {setups.map((setup) => (
          <SelectionRow
            key={setup}
            name="trade-idea-setup"
            value={setup}
            checked={choice.setup === setup}
            onChange={() => onChange({ ...choice, setup })}
          >
            {setup}
          </SelectionRow>
        ))}
      </div>
    </fieldset>
  );
}

function SelectionRow({
  children,
  name,
  value,
  checked,
  onChange,
  trailing,
  inputRef,
}: {
  children: React.ReactNode;
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  trailing?: React.ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <label
      className={cn(
        'hover:bg-accent/50 focus-within:ring-ring flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none focus-within:ring-2',
        checked && 'bg-primary/10 text-foreground',
      )}
    >
      <input
        ref={inputRef}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="border-input text-primary-text focus-visible:ring-ring size-4 shrink-0 accent-current focus-visible:ring-2"
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked ? (
        <Check className="text-primary-text size-4 shrink-0" aria-hidden="true" />
      ) : (
        trailing
      )}
    </label>
  );
}

function choiceFrom(draft: PlanDraft): StrategyChoice {
  if (draft.noStrategy) return { kind: 'none' };
  if (draft.strategy === null) return { kind: 'unselected' };
  return { kind: 'strategy', name: draft.strategy, setup: draft.setup };
}

function normalizeChartLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function chartLabel(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().includes('tradingview')
      ? 'TradingView chart'
      : 'Chart link';
  } catch {
    return 'Chart link';
  }
}
