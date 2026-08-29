import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Tailwind v4 generates these font-size utilities from the project's
 * `--text-*` metric tokens. tailwind-merge cannot discover that generated
 * theme, so without this extension it guesses that an unknown `text-*` class
 * is a colour and drops the size whenever a metric tone follows it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': ['text-metric', 'text-kpi', 'text-kpi-hero'],
    },
  },
});

/**
 * Merge conditional class names, resolving conflicting Tailwind utilities so
 * that the last one wins (`cn('p-2', 'p-4')` -> `'p-4'`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
