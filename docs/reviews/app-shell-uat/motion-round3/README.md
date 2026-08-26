# App shell motion — Founder visual UAT (round 3)

> **Superseded on the easing question — see `../motion-round4-easing/`.**
> The mechanism documented here (transform, 220ms, flush workspace, stationary
> header, visibility timing) was accepted and is unchanged. The easing was not:
> the Founder took the decision offered at the end of this page, and
> `--ease-shell` is now `cubic-bezier(0.4, 0, 0.6, 1)`. Every measurement below
> describes the OLD curve and is kept as the evidence that identified it.

Captured from the **shipping components** running the **shipping CSS** against a
real `pnpm build` / `pnpm start` production server, signed in as the E2E fixture
user. No width, easing, duration or class was altered to produce any frame.

Reproduce with `node capture.mjs` (in this folder) against a server on
`http://127.0.0.1:3100`.

## How the five transition frames were taken

The real toggle is clicked, the browser creates its real `CSSTransition`
objects from the production stylesheet, and those objects are then **paused and
seeked** through the Web Animations API — the same act as a high-speed camera
catching a real movement mid-flight. The animation is the product's; only the
shutter is ours. Each frame reloads to a settled open sidebar and runs its own
fresh transition, so no frame is derived from another.

## Desktop — 1440 × 900

| File                                 | What it shows                                                              |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `01-desktop-1440-sidebar-open.png`   | Settled open. Sidebar 200px, workspace starts at x=200.                    |
| `02-desktop-1440-sidebar-closed.png` | Settled closed. Sidebar gone, workspace starts at x=0 and owns all 1440px. |

Header geometry is **byte-identical** in both states:

```
header    x=0      y=0  w=1440    h=57
hamburger x=16     y=6  w=44      h=44
brand     x=66     y=6  w=158.52  h=44
utilities x=1001.67 y=6 w=422.33  h=44
```

## Desktop closing transition — `transition-frames/`

| Frame                   | Elapsed | Sidebar visible | Workspace left edge | Gap |
| ----------------------- | ------- | --------------- | ------------------- | --- |
| `01-closing-000pct.png` | 0 ms    | 200 px          | 200                 | 0   |
| `02-closing-025pct.png` | 27 ms   | 150 px          | 150                 | 0   |
| `03-closing-050pct.png` | 44 ms   | 100 px          | 100                 | 0   |
| `04-closing-075pct.png` | 77 ms   | 50 px           | 50                  | 0   |
| `05-closing-100pct.png` | 220 ms  | 0 px            | 0                   | 0   |

The header is pixel-identical across all five. The workspace edge is flush with
the panel's right edge on every frame — no gap, no overlap, no second-stage
snap.

### Read the "Elapsed" column

The percentages above are percentages of **travel**, not of time, and the two do
not line up — because `cubic-bezier(0.2, 0, 0, 1)` is a very steep decelerate.
Half of the movement happens in the first **44 ms** of a 220 ms transition; the
final 50 px take the remaining 143 ms and are close to imperceptible.

That is the honest explanation of the "snapping" this round was opened to fix.
The mechanism was never broken — the panel really did travel, on schedule, flush
with the workspace. What reads as a snap is the easing spending its visible
budget almost entirely in the first three frames.

The prescribed easing was implemented exactly as specified. If more even
progression is wanted, it is a **one-line change** to `--ease-shell` in
`src/app/globals.css` — nothing else moves, and no frame above would need
retaking for any reason other than showing the new curve.

Measured in Chromium, percentage of distance travelled by each fraction of the
duration:

| Easing                                               | 25% of time | 50% of time | 75% of time |
| ---------------------------------------------------- | ----------- | ----------- | ----------- |
| `cubic-bezier(0.2, 0, 0, 1)` — current, as specified | 61%         | 88%         | 98%         |
| `cubic-bezier(0.4, 0, 0.2, 1)` — Material standard   | 24%         | 78%         | 96%         |

This is a Founder decision, not an engineering one, and nothing else in this
round depends on it.

## Mobile — `mobile/`

| File                       | Viewport  | What it shows                                                                                                                 |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `01-390-drawer-closed.png` | 390 × 844 | Drawer closed.                                                                                                                |
| `02-390-drawer-50pct.png`  | 390 × 844 | Drawer half in (panel left = −160 of 320), backdrop at 0.50 — rising **with** the panel. Header lit and un-scrimmed above it. |
| `03-390-drawer-open.png`   | 390 × 844 | Drawer open, 320px wide (82% of viewport).                                                                                    |
| `04-320-drawer-open.png`   | 320 × 720 | Drawer open, 272px wide — the dimmed sliver survives the narrowest supported width.                                           |

Measured in both:

- header box identical drawer-open vs drawer-closed
- drawer `top` = 60 (header height), `left` = 0, `bottom` = viewport floor
- backdrop `top` = 60 as well, so the header is never dimmed
- workspace `x` unchanged while the drawer is open — a layer over the page, not
  a squeeze of it

The 1px between the header's box bottom (61) and the drawer top (60) is the
header's own bottom hairline border, which the drawer meets rather than clears —
identical to the desktop sidebar's relationship with the same border.

## Superseded rounds

`../superseded-rail-model/` and `../superseded-round2/` are earlier models kept
for reference only. The 72px icon rail they show is retired and must not return.
