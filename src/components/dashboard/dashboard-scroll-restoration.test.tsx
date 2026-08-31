import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DashboardScrollRestoration,
  rememberDashboardScroll,
} from './dashboard-scroll-restoration';

const KEY = 'tradechemist:dashboard-scroll';

function stubViewport({
  scrollHeight,
  innerHeight,
}: {
  scrollHeight: number;
  innerHeight: number;
}) {
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.scrollY = 0;
  // jsdom has no layout, so `scrollTo` is stubbed to move `scrollY` the way a
  // real browser would — clamped to what the document can actually offer.
  vi.stubGlobal(
    'scrollTo',
    vi.fn((options: { top: number }) => {
      const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollY = Math.min(options.top, max);
    }),
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('rememberDashboardScroll', () => {
  it('records the current offset for the page the navigation lands on', () => {
    window.scrollY = 842;
    rememberDashboardScroll();
    expect(window.sessionStorage.getItem(KEY)).toBe('842');
  });

  /**
   * Storage can be unavailable — a private window, blocked site data, a full
   * quota. Losing the scroll position is a far smaller failure than throwing
   * inside a click handler and preventing the navigation itself.
   */
  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberDashboardScroll()).not.toThrow();
  });
});

describe('DashboardScrollRestoration', () => {
  it('restores the remembered offset once the page is tall enough to hold it', () => {
    stubViewport({ scrollHeight: 4000, innerHeight: 900 });
    window.sessionStorage.setItem(KEY, '842');

    render(<DashboardScrollRestoration />);

    expect(window.scrollY).toBe(842);
  });

  /**
   * The key is consumed on the first mount, so a plain visit later in the same
   * session lands at the top. A position that survived would eventually fire
   * against a page the reader arrived at fresh, which reads as the app
   * scrolling on its own.
   */
  it('consumes the offset so a later plain visit starts at the top', () => {
    stubViewport({ scrollHeight: 4000, innerHeight: 900 });
    window.sessionStorage.setItem(KEY, '842');

    const first = render(<DashboardScrollRestoration />);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    first.unmount();

    window.scrollY = 0;
    render(<DashboardScrollRestoration />);
    expect(window.scrollY).toBe(0);
  });

  it('does nothing at all on an ordinary arrival', () => {
    stubViewport({ scrollHeight: 4000, innerHeight: 900 });
    render(<DashboardScrollRestoration />);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(0);
  });

  it('ignores a stored value that is not a usable offset', () => {
    stubViewport({ scrollHeight: 4000, innerHeight: 900 });
    for (const stored of ['0', '-40', 'not-a-number', '']) {
      window.sessionStorage.setItem(KEY, stored);
      const view = render(<DashboardScrollRestoration />);
      expect(window.scrollY).toBe(0);
      view.unmount();
    }
  });

  /**
   * A shorter page cannot reach the old offset — a Calendar month with fewer
   * populated days, or a filter that empties a section. The attempt clamps to
   * whatever the document can offer rather than looping against a target it
   * will never reach.
   */
  it('lands as close as a shorter page allows rather than retrying forever', () => {
    stubViewport({ scrollHeight: 1200, innerHeight: 900 });
    window.sessionStorage.setItem(KEY, '842');

    render(<DashboardScrollRestoration />);

    expect(window.scrollY).toBe(300);
  });

  it('renders nothing', () => {
    const { container } = render(<DashboardScrollRestoration />);
    expect(container).toBeEmptyDOMElement();
  });
});
