/**
 * The Dashboard's chart chrome, in one place.
 *
 * WHY THIS EXISTS. Every chart on the page was configuring its own axes,
 * grid, zero line and margins inline. They agreed by copy-paste, which meant
 * they also drifted by copy-paste — and, more importantly, they agreed on
 * RECHARTS' opinions rather than on this product's. A grid at full
 * `--border`, a 3-3 dash, an axis tick every 40px and a zero line at
 * `--muted-foreground` are the library's defaults dressed in theme tokens;
 * none of them was chosen.
 *
 * WHAT CHANGED, AND WHY.
 *
 * - The grid is a 2/6 dotted rule at 60% border rather than a 3/3 dash at
 *   full border. A gridline exists to let the eye carry a value across to the
 *   axis; at the old weight it competed with the series it was measuring, and
 *   on a 24-point cumulative plot that reads as texture, not structure.
 * - Ticks are 10.5px, up-weighted to `font-medium`. Smaller AND more legible:
 *   the extra weight buys back what the size costs, and the axis stops
 *   claiming the same visual rank as a metric label.
 * - `minTickGap` goes from 40 to 64. At 1792px the old value permitted ~40
 *   date labels along the bottom of one chart, which is a wall of text
 *   pretending to be an axis. Fewer readable dates beat many unreadable ones.
 * - The zero line drops to `--subtle-foreground`. It is a datum, not a
 *   series, and at `--muted-foreground` it was as loud as the axis labels.
 *
 * EVERYTHING IS A TOKEN. No chart may hardcode a colour: these render in both
 * themes, and a dark-only tooltip or grid is exactly the regression §36
 * rules out.
 */

/** Shared tick typography. `fontWeight` compensates for the smaller size. */
const TICK = {
  fill: 'var(--muted-foreground)',
  fontSize: 10.5,
  fontWeight: 500,
} as const;

/**
 * The X axis every Dashboard time series uses.
 *
 * `interval="preserveStartEnd"` keeps the first and last date whatever the
 * thinning drops, so the reader always knows the window's bounds even when
 * every label between them has been removed.
 */
export const CHART_X_AXIS = {
  stroke: 'var(--border)',
  tick: TICK,
  tickLine: false,
  axisLine: false,
  interval: 'preserveStartEnd',
  minTickGap: 64,
  tickMargin: 8,
} as const;

/**
 * The Y axis, at a FIXED width across every chart in a section.
 *
 * The width is what makes two stacked charts share a plot area: a cumulative
 * plot and the daily strip beneath it only line up column-for-column if their
 * Y axes reserve the same gutter. That alignment is the entire reason the
 * strip can drop its own X axis (see `CHART_X_AXIS_HIDDEN`) and still be
 * readable — a reader follows a bar straight up to the date above it.
 */
export const CHART_Y_AXIS = {
  stroke: 'var(--border)',
  tick: TICK,
  tickLine: false,
  axisLine: false,
  width: 44,
  tickMargin: 4,
} as const;

/**
 * For a secondary strip stacked directly under a chart that already carries
 * the shared axis. Recharts still needs the axis to exist for its scale; it
 * simply must not be drawn twice.
 */
export const CHART_X_AXIS_HIDDEN = { ...CHART_X_AXIS, hide: true } as const;

/** Quiet, dotted, horizontal only. Vertical rules add nothing to a time series. */
export const CHART_GRID = {
  stroke: 'color-mix(in oklab, var(--border) 60%, transparent)',
  strokeDasharray: '2 6',
  vertical: false,
} as const;

/** The zero datum: present, and quieter than the axis labels. */
export const CHART_ZERO_LINE = {
  stroke: 'var(--subtle-foreground)',
  strokeWidth: 1,
} as const;

/** Identical on both charts of a stacked pair, so their plot areas align. */
export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: -8 } as const;

/** A dashed vertical rule that follows the pointer, at the grid's weight. */
export const CHART_CURSOR_LINE = {
  stroke: 'var(--subtle-foreground)',
  strokeWidth: 1,
  strokeDasharray: '3 3',
} as const;

/** A translucent column behind the hovered category, for bar charts. */
export const CHART_CURSOR_FILL = { fill: 'var(--muted)', fillOpacity: 0.35 } as const;

/**
 * `R` suffixed onto an axis value.
 *
 * The axis is a scale, not a figure, so this is the one place a chart may
 * format a number itself — every VALUE on screen still arrives pre-formatted
 * from the canonical presentation layer (CLAUDE.md §5's "rounded once at the
 * presentation boundary").
 */
export const formatAxisR = (value: number): string => `${value}R`;
