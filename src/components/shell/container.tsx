import type { ElementType, HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Render as a different element, e.g. `section`. Defaults to `div`. */
  as?: ElementType;
  /** `wide` for analytics surfaces, `prose` for reading. Default `default`. */
  width?: 'default' | 'wide' | 'prose';
}

const WIDTHS = {
  default: 'max-w-[90rem]',
  wide: 'max-w-[112rem]',
  prose: 'max-w-3xl',
} as const;

/**
 * The single source of horizontal rhythm.
 *
 * Every page uses this rather than ad-hoc padding, which is what keeps
 * content aligned across routes and guarantees the gutter never collapses on
 * small screens.
 */
export function Container({
  as: Component = 'div',
  width = 'default',
  className,
  ...props
}: ContainerProps) {
  return (
    <Component
      className={cn('mx-auto w-full px-4 sm:px-5 lg:px-6', WIDTHS[width], className)}
      {...props}
    />
  );
}
