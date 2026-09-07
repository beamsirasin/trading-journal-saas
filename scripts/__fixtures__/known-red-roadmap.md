<!--
  A stand-in for docs/roadmap.md, used only by compare-known-red-e2e.test.mjs.

  The real list changes whenever the debt does, and a fixture pinned to it
  would fail for reasons that have nothing to do with the script. This file
  carries the same SHAPE — the headline that names the spec, one heading per
  Playwright project with a declared count, backticked test names, and the
  closing sentence the parser stops at — with three invented tests.
-->

**Three `e2e/fixture.spec.ts` tests still assert a UI that is not there.** Invented debt, for a test of the comparison script.

**`chromium` (2)**

- `alpha stays red for a documented reason`
- `beta stays red for a documented reason`

**`mobile-chrome` (1)**

- `gamma stays red for a documented reason`

Repairing them is not a locator swap: this paragraph exists so the parser knows where the list ends.
