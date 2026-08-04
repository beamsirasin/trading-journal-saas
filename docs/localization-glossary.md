# Localization Glossary

**Status:** Phase 01.1. Governs Thai (`th`) and English (`en`) copy. Architecture and URL strategy are in [ADR 0007](decisions/0007-i18n-architecture.md); this document is the terminology and formatting standard translators and reviewers check copy against.

## 1. Principle

Thai copy is written for a retail trader who already thinks in English trading vocabulary, not translated word-for-word from the English source. A term stays in English when the Thai translation would be unnatural, less precise, or simply not what a Thai-speaking trader already calls it. This is a deliberate asymmetry, not an inconsistency — see §3.

## 2. Never translate

These render identically in both locales, in every context:

| Term                                                                                                                        | Why                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TradingView`                                                                                                               | Proper noun — a third-party product name.                                                                                                                                                                     |
| `R` (the unit)                                                                                                              | The product's core unit of measure. "R" is not an abbreviation of a Thai word and has no natural translation.                                                                                                 |
| Symbol names (`EURUSD`, `AAPL`, …)                                                                                          | Instrument identifiers, not prose.                                                                                                                                                                            |
| Currency codes (`USD`, `THB`, …)                                                                                            | ISO 4217 codes are language-independent by design.                                                                                                                                                            |
| Plan names (`Starter`, `Trader`, `Professional`)                                                                            | Product/brand names, not descriptions — see [ADR 0007](decisions/0007-i18n-architecture.md), `config/plans.ts`.                                                                                               |
| Demo fixture content (trade symbols, strategy names like "London breakout", account nicknames like "Prop challenge — 100K") | User-authored-like fixture data, not UI chrome — the same category as a real trader's own account name, which this product would never translate. Fixed product taxonomy such as mistake names is translated. |
| `Trading OS` (brand name)                                                                                                   | Proper noun.                                                                                                                                                                                                  |

## 3. Kept in English inside Thai copy (terminology policy)

These are technical terms a Thai-speaking retail trader already uses in English, where forcing a Thai coinage would read as unnatural or introduce ambiguity a professional trader would not have in practice. Thai copy uses them as loanwords, generally without transliteration:

| Term                       | Thai copy renders it as                         | Note                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Average R                  | `Average R` (e.g. `Average R จริง`)             | "R" itself is never translated (§2); the compound phrase is also left whole rather than split.                                                                                           |
| Expectancy                 | `Expectancy`                                    | No established Thai trading-community term; forcing one would need a footnote.                                                                                                           |
| Edge Leakage               | `ความได้เปรียบที่เสียไป (Edge Leakage)`         | Natural Thai explanation alongside the English term on first/prominent use (e.g. the attribution section heading); later prose can use the Thai explanation alone.                       |
| Discipline Score           | `คะแนนวินัย`                                    | Exception: this one **is** translated — "discipline" and "score" both have exact, unambiguous Thai equivalents traders already use, unlike "Expectancy" or "Edge Leakage".               |
| Strategy / Setup           | `กลยุทธ์` / left as `Setup` in table contexts   | "Strategy" translates cleanly (`กลยุทธ์`); "Setup" as a specific trading term is left in English where it appears.                                                                       |
| Drawdown                   | `Max Drawdown` / `การลดลง` depending on context | Used as a translated description (`ทั้งสองเส้น...การลดลงระหว่างสัปดาห์`) in prose, kept as `Max Drawdown`-style compounds in metric labels — see `analytics.systemVsActual.maxDrawdown`. |
| Profit Factor              | `Profit Factor`                                 | Metric-label convention — see §4.                                                                                                                                                        |
| Long / Short               | `Long` / `Short`                                | Standard trade-direction labels; translating them would be less familiar in a trading table.                                                                                             |
| Backtest / prop firm       | `backtest` / `prop firm`                        | Established industry terms in Thai trading usage; keep them in Latin script inside otherwise-natural Thai prose.                                                                         |
| API / CSV / AI / MT4 / MT5 | unchanged                                       | Technical names and formats, not ordinary English prose.                                                                                                                                 |

**System / Trader, translated, not left in English.** Unlike the terms above, the product's central axis names translate cleanly and are translated everywhere:

| English            | Thai                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| System             | `ระบบ`                                                                                       |
| Trader / Actual    | `จริง` (as an axis label), `เทรดเดอร์` (as a noun, e.g. section eyebrow "ระบบ vs เทรดเดอร์") |
| System Performance | `ประสิทธิภาพตามระบบ`                                                                         |
| Trader Performance | `ผลงานการเทรดจริง`                                                                           |
| System Win Rate    | `อัตราชนะตามระบบ`                                                                            |
| Actual Win Rate    | `อัตราชนะจริง`                                                                               |

## 4. Metric-label convention

A metric name that is a standard, internationally-recognized trading-analytics term (Profit Factor, Expectancy, Average R) is left in English even mid-sentence in Thai copy, exactly as a Thai financial news article would leave "P/E ratio" untranslated. A metric name built from ordinary words (Win Rate → อัตราชนะ, Discipline Score → คะแนนวินัย, Net P&L → กำไร/ขาดทุนสุทธิ) is translated, because the Thai phrase is at least as precise as the English one and a Thai trader would never say the English term instead.

This is a judgment call applied per term, not a mechanical rule — when adding a new metric, check whether Thai retail-trading communities already have a settled way of saying it before defaulting to a literal translation.

## 5. Number, date, and currency formatting

**Money is locale-independent by design** — see [ADR 0007](decisions/0007-i18n-architecture.md) Decision 5. `formatMoney`/`formatNet` take no locale parameter. The currency symbol and decimal scale come from the trading account's configured currency (CLAUDE.md §5), never from the UI language, and Thai/English share the same digit and grouping convention for every currency this product supports.

**Dates read the active locale.** `formatInstant` (`src/lib/time/format.ts`) passes the current locale to `Intl.DateTimeFormat` and unconditionally pins `calendar: 'gregory'`, because `th` defaults to the Buddhist calendar (year + 543) under ICU otherwise — confirmed empirically, not assumed. Worked examples:

| Locale | Rendered form                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------- |
| `en`   | `Jul 31, 2026`                                                                                  |
| `th`   | `31 ก.ค. 2026` (Gregorian year, pinned — not the Buddhist-calendar `2569` ICU would default to) |

**Numbers use tabular, locale-neutral digits.** Both locales use Arabic numerals with the `numeric` utility class (design-system.md §4) for fixed-width alignment; neither locale substitutes Thai numerals (`๑๒๓`), which is standard practice in Thai financial software.

**No user timezone setting yet.** Both locales display timestamps in `DEMO_TIME_ZONE` — see the open item in the Phase 1.1 implementation notes. Real per-user timezone display is unaffected by locale and remains a Phase 07+ concern (CLAUDE.md §7).

## 6. Progressive-disclosure and UI-chrome vocabulary

Standard phrases used consistently across the product so a trader learns the pattern once:

| English                                  | Thai                                      |
| ---------------------------------------- | ----------------------------------------- |
| View details                             | ดูรายละเอียด                              |
| View analytics / View detailed analytics | ดูการวิเคราะห์ / ดูการวิเคราะห์โดยละเอียด |
| Show more                                | แสดงเพิ่มเติม                             |
| Hide details                             | ซ่อนรายละเอียด                            |
| Demo data                                | ข้อมูลตัวอย่าง                            |

## 7. Authentication vocabulary

Introduced in Phase 02. Google, email address values, plan names, and technical provider identifiers shown only to developers are never translated (§2 applies here too).

| English                                 | Thai                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Log in                                  | เข้าสู่ระบบ                                                                                                                                                                                                                                                                                           |
| Create account (register submit button) | สร้างบัญชี — the commissioning brief suggested `สมัครสมาชิก` ("register/subscribe"); `สร้างบัญชี` ("create account") shipped instead, matching `auth.registerSubmit` in `messages/th.json`. Both are correct, natural Thai for this action; documented here so the two are not treated as a mismatch. |
| Verify your email                       | ยืนยันอีเมล                                                                                                                                                                                                                                                                                           |
| Forgot password?                        | ลืมรหัสผ่าน                                                                                                                                                                                                                                                                                           |
| Reset your password                     | ตั้งรหัสผ่านใหม่                                                                                                                                                                                                                                                                                      |
| Log out                                 | ออกจากระบบ                                                                                                                                                                                                                                                                                            |
| Workspace                               | พื้นที่ทำงาน                                                                                                                                                                                                                                                                                          |
| Your session has expired                | เซสชันหมดอายุ                                                                                                                                                                                                                                                                                         |
| Try again later                         | ลองอีกครั้งภายหลัง                                                                                                                                                                                                                                                                                    |
| Continue with Google                    | ดำเนินการต่อด้วย Google (`Google` unchanged — §2)                                                                                                                                                                                                                                                     |
| Invalid email or password               | อีเมลหรือรหัสผ่านไม่ถูกต้อง                                                                                                                                                                                                                                                                           |
| Check your email                        | ตรวจสอบอีเมลของคุณ                                                                                                                                                                                                                                                                                    |

## 8. VAT pricing notice

VAT collection is disabled at launch, so neither locale shows a VAT line or VAT pricing notice while it remains disabled. If an administrator enables the future 7% VAT configuration, public pages use these exact strings:

| Locale | Notice                              |
| ------ | ----------------------------------- |
| `th`   | `ราคาไม่รวมภาษีมูลค่าเพิ่ม 7%`      |
| `en`   | `Prices exclude 7% VAT.`            |

Checkout labels for subtotal, VAT, and final total are localized normally; the server-calculated amounts and rate must not be inferred from translated client copy.

## 9. What this document does not cover

- Grammatical structure decisions (e.g., Thai has no plural inflection, so `{count, plural, one {# time} other {# times}}` in English becomes a plain `{count} ครั้ง` in Thai — this is a structural ICU difference, not a terminology one, and is expected wherever a count is involved). See `messages/en.json` / `messages/th.json` `mistakes.occurrences` and `dashboard.mistakes.times` for the pattern.
- Route naming or URL structure — see [ADR 0007](decisions/0007-i18n-architecture.md).
- Font/typography selection — see [ADR 0007](decisions/0007-i18n-architecture.md) Decision 4 and `design-system.md` §4.
