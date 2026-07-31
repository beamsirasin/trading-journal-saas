import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names, resolving conflicting Tailwind utilities so
 * that the last one wins (`cn('p-2', 'p-4')` -> `'p-4'`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
