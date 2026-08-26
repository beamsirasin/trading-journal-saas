# App shell — visual polish and alignment

Shell only. No dashboard content, domain logic, DB, DAL, server or migrations
touched. Behaviour from the previous round is preserved exactly: deliberate
toggle, no hover expand, real workspace displacement, mobile drawer unchanged.

Captured from the shipping components against a real `pnpm build` /
`pnpm start` production server, theme set through the product's own control.
Reproduce with `node capture-two-layer.mjs` against `http://127.0.0.1:3100`.

## 1. Single-surface sidebar

The icon column and the labels beside it were two different painted shades, so
the sidebar read as two panels bolted together. There is now **one flat
surface** across the whole width; the `--shell-rail` / `--shell-rail-border`
tokens and the absolutely-positioned spine element are gone.

The icon column still exists as a **layout** fact — a fixed first grid column
on every nav row — which is what keeps icons from moving when the panel opens.
Nothing is drawn to announce it.

## 2. Proportions

|              | before | after             |
| ------------ | ------ | ----------------- |
| collapsed    | 48px   | **64px**          |
| expanded     | 208px  | **224px**         |
| label column | 160px  | 160px (unchanged) |

Measured live in both themes: collapsed nav `64`, expanded `224`, workspace x
`64 → 224`, icon x `23` in **both** states (centre 32 = exactly half the
collapsed width), width after hovering the rail `64` — hover still does
nothing.

## 3. Header toggle alignment

The header used its own `px-4` gutter while the sidebar used the rail token, so
the toggle's glyph sat ~6px off the icons directly beneath it.

The header's left cell **is** the sidebar's icon column now: same token
(`--shell-rail-width`), same width, same centring, and the row's left padding
is dropped at `lg` so no gutter can push it out of register.

- toggle glyph centre and nav icon centre: **within 1px**, both on the 32px
  centre line
- brand link left edge and nav label left edge: **within 2px** (both at 64)

The brand's _wordmark_ necessarily sits further right — the link leads with a
32px mark tile. What aligns is the leading edge of the brand as a whole, which
is what the reference does too.

Both are asserted in `e2e/app-shell.spec.ts` rather than left to the eye.

## 4. What caused the wallet button's white edge

The header rebinds the semantic colour tokens to its own dark palette via
`[data-shell-chrome]` — but **`--muted` was not among them**. The switcher's
`sm:bg-muted/50` therefore resolved to the _page's_ near-white muted
(`#e9edf7` in light) and painted it at 50% over a dark navy bar, producing a
washed light block; `sm:border-border` added a hairline on top of it.

Two fixes:

1. `--muted` is now rebound in the chrome scope, so anything inside the header
   that reaches for it gets a chrome-appropriate value.
2. The switcher **drops the border entirely** in favour of a soft
   `secondary/60` chip — one shape, no ring, no hairline, no competing edge
   beside the account menu.

## 5. Header right controls

Matched to one family: same height (44px), same radius, same gap, same
horizontal padding. The switcher keeps a soft chip because it is displaying a
current **value**; the account menu stays unfilled at rest because it is a
plain menu trigger, and filling both would leave the header with two competing
blocks.

## Theme

| Surface               | Light                            | Dark                          |
| --------------------- | -------------------------------- | ----------------------------- |
| header                | `#101a2e` → `rgb(16, 26, 46)`    | `#0b0b0e` → `rgb(11, 11, 14)` |
| sidebar (one surface) | `#eef2f9` → `rgb(238, 242, 249)` | `#151519` → `rgb(21, 21, 25)` |
| workspace             | `#f8fafd` → `rgb(248, 250, 253)` | `#0f0f11` → `rgb(15, 15, 17)` |
| cards                 | `#ffffff`                        | `#18181c`                     |

Light: sidebar is one light surface slightly deeper than the workspace. Dark:
one surface lifting off a darker page. Accent stays on active item, CTA and
focus ring only.

**Active pill is now per-theme** (`--shell-nav-active-tint`, 12% light / 24%
dark). At a flat 12% it was nearly invisible on the dark sidebar — and when
collapsed the pill is the _only_ non-hue cue, since the label's weight is
clipped away. A `dark:` utility would not work here: it keys off the `.dark`
class and would miss the OS-preference path, which switches tokens by media
query alone.

## Motion

Unchanged: panel width plus workspace boundary, 220ms `ease-in-out`, icons
stationary. Mid-reveal frame at 110ms — nav `144`, workspace `144`.

## Files

| File                                            | Shows                |
| ----------------------------------------------- | -------------------- |
| `01-desktop-1440-{light,dark}-rail.png`         | collapsed            |
| `02-desktop-1440-{light,dark}-expanded.png`     | expanded             |
| `03-desktop-1440-{light,dark}-profile-menu.png` | profile menu         |
| `04-desktop-1440-dark-reveal-mid.png`           | mid-reveal           |
| `05-mobile-390-light-drawer-open.png`           | mobile drawer, light |
| `06-mobile-390-dark-drawer-open.png`            | mobile drawer, dark  |
| `07-mobile-320-dark-drawer-open.png`            | mobile drawer, 320   |

Frames park the pointer off every control before shooting, so a hover state is
never captured as if it were the resting state.
