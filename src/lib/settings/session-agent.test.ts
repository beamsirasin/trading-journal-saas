import { describe, expect, it } from 'vitest';

import { describeSessionAgent } from './session-agent';

describe('describeSessionAgent', () => {
  it('maps only conservative browser/platform families', () => {
    expect(
      describeSessionAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
      ),
    ).toBe('chrome_windows');
    expect(
      describeSessionAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1 Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('safari_ios');
  });

  it('returns bounded generic labels rather than forwarding raw input', () => {
    expect(describeSessionAgent('<script>alert(1)</script>')).toBe('other');
    expect(describeSessionAgent(null)).toBe('other');
  });
});
