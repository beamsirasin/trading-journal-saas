# App shell motion — Founder visual UAT (round 4: easing only)

Round 3 established the mechanism. This round changed **one line** — the
`--ease-shell` token — and nothing else. Duration, transform implementation,
workspace synchronisation, header stationarity, visibility timing,
accessibility, persistence and the mobile architecture are all exactly as
accepted.

|            |                                |
| ---------- | ------------------------------ |
| Old easing | `cubic-bezier(0.2, 0, 0, 1)`   |
| New easing | `cubic-bezier(0.4, 0, 0.6, 1)` |
| Duration   | `220ms` — unchanged, not tuned |

Captured from the shipping components running the shipping CSS against a real
`pnpm build` / `pnpm start` production server. Reproduce with
`node capture-time.mjs` against a server on `http://127.0.0.1:3100`.

## Captured by TIME, not by position

Round 3's five frames were seeked until the panel reached 200/150/100/50/0
visible pixels. That proved the transform could paint intermediate positions;
it could not prove perceptual timing, because the position was the _input_.

Here the input is elapsed time — 0, 55, 110, 165, 220 ms — and the position is
whatever the browser happens to have reached by each instant. The numbers below
are outputs.

## Desktop closing — equal-time frames (`time-frames/`)

| Frame             | Elapsed | Sidebar visible | Workspace x | Gap | Header identical |
| ----------------- | ------- | --------------- | ----------- | --- | ---------------- |
| `01-time-000.png` | 0 ms    | 200 px          | 200         | 0   | yes              |
| `02-time-025.png` | 55 ms   | 173 px          | 173         | 0   | yes              |
| `03-time-050.png` | 110 ms  | 100 px          | 100         | 0   | yes              |
| `04-time-075.png` | 165 ms  | 27 px           | 27          | 0   | yes              |
| `05-time-100.png` | 220 ms  | 0 px            | 0           | 0   | yes              |

Against the rejected feel, at the same instants:

| Elapsed | Old `(0.2, 0, 0, 1)` | New `(0.4, 0, 0.6, 1)` |
| ------- | -------------------- | ---------------------- |
| 0 ms    | 200 px               | 200 px                 |
| 55 ms   | 79 px                | **173 px**             |
| 110 ms  | 24 px                | **100 px**             |
| 165 ms  | 5 px                 | **27 px**              |
| 220 ms  | 0 px                 | 0 px                   |

The old curve had 88% of the travel finished by the halfway point, so the eye
only ever caught the tail. The new curve is at the exact midpoint of its
journey at the midpoint of its time.

## Normal-speed playback

Paused frames prove geometry, not feel, so the unpaused transition was also
sampled every painted frame at normal speed, three times in each direction.
This is the sequence a viewer's eye actually receives — no throttling, no
seeking:

```
closing   4ms:200  22ms:190  56ms:160  89ms:115  122ms:66  156ms:25  189ms:4  223ms:0
opening   3ms:0    22ms:10   55ms:40   88ms:85   121ms:134 155ms:175 188ms:196 222ms:200
```

Per direction: ~15 painted frames inside the transition, **14 distinct
positions**, and **5 frames in the middle third** of the travel (40–160 px).
The panel is visibly in motion across the whole 220 ms rather than gone in the
first three frames.

Opening and closing are mirror images of each other, as one physical panel
pushed in opposite directions should be.

## Reverse mid-motion

Reversed 110 ms in, in both directions:

```
closing, reversed at  90px -> 95, 108, 129, 155, 177, 193, 200, 200   (settles open)
opening, reversed at 110px -> 106, 92, 71, 46, 23, 7, 0, 0            (settles closed)
```

Continuation from the current visual position. No collapse to an endpoint
before travelling back, in either direction.

## Desktop resting states

- `01-desktop-1440-sidebar-open.png` — sidebar 200 px, workspace starts at 200
- `02-desktop-1440-sidebar-closed.png` — sidebar gone, workspace owns all 1440

Header geometry identical in both, and across all five transition frames:

```
header    x=0        y=0  w=1440    h=57
hamburger x=16       y=6  w=44      h=44
brand     x=66       y=6  w=158.52  h=44
utilities x=1001.67  y=6  w=422.33  h=44
```

## Mobile (`mobile/`)

| File                         | Viewport  | What it shows                                                              |
| ---------------------------- | --------- | -------------------------------------------------------------------------- |
| `01-390-drawer-closed.png`   | 390 × 844 | Drawer closed                                                              |
| `02-390-drawer-050-time.png` | 390 × 844 | Drawer at **110 ms of 220 ms** — 50% of time, 50% travelled, backdrop 0.50 |
| `03-390-drawer-open.png`     | 390 × 844 | Drawer open, 320 px (82% of viewport)                                      |
| `04-320-drawer-open.png`     | 320 × 720 | Drawer open, 272 px                                                        |

The drawer shares the same token, so it moved with the curve automatically —
no separate mobile easing was introduced. At both widths: header box identical
open vs closed, drawer `top` = 60 / `left` = 0 / `bottom` = viewport floor,
backdrop `top` = 60 so the header is never dimmed, workspace `x` unchanged, and
**0 wordmark links inside the drawer** — the duplicate stays removed.

## Superseded rounds

`../motion-round3/` documents the mechanism fix and the position-seeked frames
that identified this easing problem. `../superseded-rail-model/` and
`../superseded-round2/` are older models; the 72 px icon rail they show is
retired and must not return.
