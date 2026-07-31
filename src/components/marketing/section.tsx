import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Container } from '@/components/shell/container';

/**
 * A landing-page section.
 *
 * Vertical rhythm is a property of the section, not of whatever happens to be
 * inside it. Centralising the padding here is what stops the page acquiring
 * eleven slightly different gaps as sections are added.
 *
 * `tone="surface"` paints the alternating band. `surface` is one step off the
 * page canvas — lifted in dark, tinted in light — which is enough to separate
 * sections without drawing a line under every one of them.
 */
export function Section({
  id,
  labelledBy,
  tone = 'default',
  width = 'default',
  className,
  children,
}: {
  id?: string;
  /** The id of the section's heading, for `aria-labelledby`. */
  labelledBy?: string;
  tone?: 'default' | 'surface';
  width?: 'default' | 'wide' | 'prose';
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      {...(id === undefined ? {} : { id })}
      {...(labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy })}
      className={cn(
        'scroll-mt-20 py-16 sm:py-20 lg:py-24',
        tone === 'surface' ? 'bg-surface border-border border-y' : '',
        className,
      )}
    >
      <Container width={width}>{children}</Container>
    </section>
  );
}

/**
 * The eyebrow-plus-heading-plus-lede block a section opens with.
 *
 * The eyebrow is `aria-hidden`: it is a visual orientation cue, and a screen
 * reader announcing "The problem" immediately before the heading that says
 * the same thing is redundant.
 */
export function SectionIntro({
  eyebrow,
  title,
  titleId,
  description,
  align = 'start',
  className,
}: {
  eyebrow?: string;
  title: string;
  titleId: string;
  description?: string;
  align?: 'start' | 'center';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        align === 'center' ? 'items-center text-center' : 'items-start',
        className,
      )}
    >
      {eyebrow === undefined ? null : (
        <span className="text-brand text-label uppercase" aria-hidden="true">
          {eyebrow}
        </span>
      )}

      <h2 id={titleId} className="text-section-title max-w-3xl text-balance">
        {title}
      </h2>

      {description === undefined ? null : (
        <p
          className={cn(
            'text-muted-foreground max-w-2xl leading-relaxed text-pretty',
            align === 'center' ? 'mx-auto' : '',
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}
