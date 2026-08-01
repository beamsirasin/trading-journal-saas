# ADR 0007 — i18n architecture, URL strategy, and the Thai typography stack

- **Status:** Accepted
- **Date:** 2026-08-01
- **Phase:** 01.1 — UI simplification and Thai/English localization

## Context

Phase 1.1 adds a second locale (Thai) to a product that previously had every string hardcoded in English, and simplifies the dashboard and landing page at the same time. Three decisions had to be made before any component could be touched: what carries the translated strings, how the URL expresses the active locale, and whether the existing "no web font" typography default (ADR 0005 §4) still holds once Thai script is in scope.

## Decision 1 — `next-intl`, not hand-rolled ternaries or a second routing library

**Chosen: `next-intl` 4.13.4.** It is the only actively maintained i18n library with first-class App Router support that works in Server Components without forcing every translated component to be a Client Component — `useTranslations` resolves synchronously inside a Server Component in this version, and `getTranslations`/`setRequestLocale` cover the async cases (`generateMetadata`, static param generation). Message files are structured JSON with ICU MessageFormat, so plurals, number/date interpolation, and nested keys are load-bearing library features rather than string concatenation invented per call site.

**Rejected: `language === 'th' ? … : …` ternaries inline in components.** This was the pattern explicitly ruled out by the brief. It cannot be tested for coverage (a missing Thai branch is not a type error), cannot express ICU plurals, and turns every component into two languages of prose interleaved with markup.

**Rejected: a second, `/th`-only mirror of every route.** Doubling every `page.tsx` guarantees the two copies drift the first time one is edited and not the other. `next-intl`'s `[locale]` segment plus one message catalog per language is the same route tree rendering twice, not two route trees.

**Message file shape.** `messages/en.json` and `messages/th.json`, one file per locale, loaded by `src/i18n/request.ts` via `getRequestConfig`. Namespaced by feature area (`nav`, `hero`, `dashboard`, `trades`, …) rather than one flat file, so a component only pulls the slice it needs and a misplaced key is easy to spot in review. Both files are kept at exact key parity — enforced by `src/i18n/messages.test.ts`, which fails on any missing, extra, or empty leaf key between the two files, and on any placeholder variable declared in one locale's string but not the other's.

## Decision 2 — `localePrefix: 'always'`, both locales always in the URL

**Chosen:** every route is served under `/en/...` or `/th/...`, with no bare unprefixed route. `routing.defaultLocale` is `'en'`, used only to pick a locale when none of the detection signals below apply — it does not mean `/` serves English without a prefix.

**Rejected: `localePrefix: 'as-needed'`** (default locale unprefixed, `/pricing` in English but `/th/pricing` in Thai). This was the more common choice and was rejected for two concrete reasons:

1. **Ambiguity at the root.** `/` would need to resolve to a locale via detection alone, with no URL signal — the exact redirect-loop and hydration-mismatch surface the phase brief calls out by name. `always` makes the resolved locale a plain, inspectable fact of the URL on every request, including the first one.
2. **Canonical URLs and metadata.** `alternates.languages` in `generateMetadata` needs one predictable locale-prefixed shape rather than a special case for the default. `src/i18n/metadata.ts` builds route-specific canonical, hreflang, and Open Graph URLs, so `/th/pricing` points to `/th/pricing` and its `/en/pricing` equivalent rather than inheriting home-page URLs. `always` means `/en` and `/th` are exactly symmetric — no route is "the real one" with the other as a variant.

The cost is that `/en/...` is one segment longer than plain English routers ship. That cost is paid once, in `src/middleware.ts`'s matcher and `src/i18n/routing.ts`'s config, and never again per-route.

**Consequence for every internal link.** `next/link` and `next/navigation`'s router are never imported directly outside `src/i18n/`. `Link`, `redirect`, `usePathname`, `useRouter`, `getPathname` all come from `src/i18n/navigation.ts` (`createNavigation(routing)`), which is what actually prepends the locale segment. A raw `next/link` would silently drop the prefix and send the user to a route Next.js would then have to re-resolve.

## Decision 3 — Locale resolution precedence, and where it is allowed to persist

Order, highest priority first:

1. **Explicit user selection** — clicking a `LanguageSwitcher` option — persisted as the `NEXT_LOCALE` cookie `next-intl`'s middleware manages by default (`sameSite: 'lax'`, not `httpOnly`, no explicit `maxAge` — a browser-session cookie unless a future phase configures otherwise).
2. **The cookie**, on every subsequent request, read by `src/middleware.ts` before content negotiation runs.
3. **`Accept-Language`** — Thai in the browser's language list resolves to `th`; anything else resolves to `routing.defaultLocale` (`en`).
4. **`routing.defaultLocale`** — the documented fallback, `en`, used when no signal above applies (a fresh visit with an unparseable or absent `Accept-Language` header).

This precedence is entirely middleware-level and cookie-based — never `localStorage`. `localStorage` is unavailable during SSR, so a first paint that read it would either guess English and then flash to Thai on hydration, or need a loading state solely to hide that flash. The cookie is available to the server on the very first request, so the SSR'd HTML and the first client render agree without a placeholder.

**No account-level persistence yet.** `NEXT_LOCALE` is a cookie, full stop, in this phase. **Phase 2 will sync the cookie's value to the authenticated user's stored preference once accounts exist** — until then there is no user row to store it on, and inventing one now would be schema built ahead of the phase that needs it (CLAUDE.md §10, "avoid premature abstraction").

## Decision 4 — Typography: `Noto Sans Thai`, reversing the Phase 00b/01 "no web font" default

`design-system.md` §4 (Phase 01) chose the OS system-font stack specifically to avoid a build-time network dependency and a flash of unstyled text, on the grounds that a typeface wasn't yet carrying any brand decision worth its cost. That reasoning holds for a Latin-only product. It does not hold once a screen mixes a Thai sentence with an untranslated English metric name in the same line, which is nearly every screen in this product (`ประสิทธิภาพตามระบบ (System Performance)`, `Average R จริง`) — the terminology policy in the [localization glossary](../localization-glossary.md) deliberately keeps some terms in English inside Thai copy.

**The concrete failure this avoids:** the Windows/Android system font stack does not guarantee a Thai-covering face in the same family as the Latin system font. Where it substitutes a different typeface for the Thai glyphs within one string, line-height and vertical metrics stop matching mid-sentence — visible as Thai text clipping or floating relative to the English word beside it, exactly at the script boundary this product's copy constantly crosses.

**Chosen: `next/font/google`'s `Noto Sans Thai`**, not `Noto Sans`. These are two distinct font families in Google's catalog, not one family with a Thai subset — confirmed against `next/font`'s own compiled subset manifest (`next/dist/compiled/@next/font/dist/google/font-data.json`): `"Noto Sans"` lists `["cyrillic", "cyrillic-ext", "devanagari", "greek", "greek-ext", "latin", "latin-ext", "vietnamese"]`, no `thai`; `"Noto Sans Thai"` lists `["latin", "latin-ext", "thai"]`. `Noto Sans Thai`'s inclusion of `latin` is what makes it sufficient alone — one family covers both scripts, so nothing needs pairing at a script boundary. Subsetted and self-hosted at build time by `next/font`, exactly as the rest of the stack already assumes: no runtime request to Google, no layout shift, no dependency on the visitor's OS having a Thai face installed. `display: 'swap'` and `weight: ['400','500','600','700']` cover every weight the type scale (design-system.md §4) uses.

**Consequence.** `--font-sans` in `globals.css` changed from a hardcoded system-font stack literal to `var(--font-sans)`, set by the `notoSansThai.variable` class on `<html>` in `src/app/[locale]/layout.tsx`. Thai display/title roles also use taller line heights and zero letter spacing so combining marks remain intact when text wraps. `docs/design-system.md` §4 records the current typography stack and locale-specific rhythm.

## Decision 5 — Money formatting stays locale-independent; only date formatting reads the locale

Every locale-sensitive display primitive was audited against `src/lib/money/` and `src/lib/time/`. The result: **`formatMoney`/`formatNet` (money) take no locale parameter and are unchanged.** `formatInstant` (time) does, and gained one addition.

**Why money does not change per locale.** CLAUDE.md §5 already fixes the display rule: currency scale and symbol come from the trading account's configured currency, never from the UI's language. Thai and English also share the identical Arabic-numeral, comma-grouping convention for the currencies this product supports — there is no `12.450,00` vs `12,450.00` split to resolve, because nothing in scope uses a period as the group separator. Changing this primitive to accept a locale would add a parameter with no observable effect and a plausible-looking test to write against nothing.

**Why time does.** `Intl.DateTimeFormat` under the `th` locale defaults to the **Buddhist calendar** (year + 543) per ICU, which contradicts the phase brief's own worked example (`31 ก.ค. 2026`, not `31 ก.ค. 2569`). Confirmed empirically — not assumed — with a throwaway Node comparison of `th` with and without an explicit calendar option. Fix: `formatInstant` now unconditionally passes `calendar: 'gregory'` to `Intl.DateTimeFormat`, documented inline at the call site so a future reader does not "simplify" it away. This is the one place UTC storage (CLAUDE.md §7) and locale presentation actually intersect: the stored instant never changes, only which calendar and script render its digits.

## Consequences

- Every internal navigation must import `Link`/`usePathname`/`useRouter` from `@/i18n/navigation`, never `next/link` or `next/navigation` directly — a lint rule is the natural next step if a raw import recurs.
- Adding a third locale means: one more `messages/<locale>.json` at full key parity, one more entry in `routing.locales`, and a typography check against `Noto Sans Thai`'s (or a new family's) subset list before assuming coverage — the Decision 4 mistake is exactly the kind that recurs silently.
- Vitest cannot execute real Server Components — there is no RSC renderer in a Vite/jsdom test run. Component tests that exercise a `next-intl`-driven page render through `NextIntlClientProvider` with the real message catalog and locale `'en'` supplied directly, and `setRequestLocale` (a genuine RSC-only API with no client-safe stub) is mocked to a no-op for the render tree under test. This tests real content and structure; it does not exercise static-generation opt-in, which is a build-time concern verified by `pnpm build` instead.
- `next-intl`'s navigation module resolves `next/navigation` in a way that Node's own ESM resolver cannot follow when Vite externalizes the package. `vitest.config.ts` inlines `next-intl` (`test.server.deps.inline`) so Vite transforms it instead of handing resolution to Node.

## Alternatives considered

**`react-i18next` / `i18next`.** Mature and framework-agnostic, but its App Router integration is a community adapter rather than a first-party one, and its idiomatic pattern pushes translation into Client Components more readily than `next-intl`'s RSC-native hooks — exactly the "every translated string costs a `'use client'` boundary" outcome this phase avoids.

**Rolling a minimal custom message-loader** (a `t(key, locale)` function reading flat JSON, no library). Rejected: reimplements ICU pluralization and rich-text interpolation (`t.rich` for embedding a `<Link>` inside a sentence) badly, for a problem `next-intl` already solves, tested, with App Router-specific edge cases (static rendering, middleware detection) already handled.

**Detecting locale client-side only, via a `useEffect` and `navigator.language`.** Rejected outright: guarantees a first paint in the wrong locale followed by a visible re-render, on every single page load, for every user without a cookie yet — the flash Decision 3 exists specifically to prevent.
