import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
  PRODUCTION NEVER IMPORTS THE PROTOTYPE.

  `/prototype/add-trade` is frozen reference material. Accepted UX moves from
  it into shared production components; production code must not reach back
  into `components/prototype`, or a change to the reference would silently
  change the product. Only the prototype namespace itself and the prototype
  route group may import it.
*/
const SRC = join(process.cwd(), 'src');
const ALLOWED_PREFIXES = [
  ['components', 'prototype'].join(sep) + sep,
  ['app', '[locale]', '(prototype)'].join(sep) + sep,
  // This file quotes prototype imports as fixtures for the matcher below.
  ['components', 'prototype-import-boundary.test.ts'].join(sep),
];
const PROTOTYPE_IMPORT = /from\s+['"](?:@\/components\/prototype|[./]+\/prototype)(?:\/|['"])/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('prototype import boundary', () => {
  it('keeps every production module free of prototype imports', () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path))
      .filter((path) => !ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)))
      .filter((path) => PROTOTYPE_IMPORT.test(readFileSync(join(SRC, path), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('would catch a production recording form importing the prototype', () => {
    expect(
      PROTOTYPE_IMPORT.test(
        "import { AtEntryForm } from '@/components/prototype/add-trade/at-entry-form';",
      ),
    ).toBe(true);
    expect(PROTOTYPE_IMPORT.test("import { money } from '../prototype/exit-model';")).toBe(true);
    expect(PROTOTYPE_IMPORT.test("import { cn } from '@/lib/utils';")).toBe(false);
  });
});
