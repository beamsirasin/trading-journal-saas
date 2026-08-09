import { describe, expect, it } from 'vitest';

import {
  DISPLAY_NAME_MAX_LENGTH,
  SyncObservedPreferencesSchema,
  UpdateDisplayNameSchema,
  UpdateTimezoneSchema,
} from './schemas';

describe('UpdateDisplayNameSchema', () => {
  it.each(['Ada Lovelace', 'กานต์ เทรดเดอร์'])('accepts international display name %s', (name) => {
    expect(UpdateDisplayNameSchema.parse({ name })).toEqual({ name });
  });

  it('trims outer whitespace', () => {
    expect(UpdateDisplayNameSchema.parse({ name: '  Ada Lovelace  ' })).toEqual({
      name: 'Ada Lovelace',
    });
  });

  it('rejects blank, oversized, unsafe, non-string and unknown fields', () => {
    expect(UpdateDisplayNameSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(
      UpdateDisplayNameSchema.safeParse({ name: 'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1) }).success,
    ).toBe(false);
    expect(UpdateDisplayNameSchema.safeParse({ name: '<b>Ada</b>' }).success).toBe(false);
    expect(UpdateDisplayNameSchema.safeParse({ name: 42 }).success).toBe(false);
    expect(
      UpdateDisplayNameSchema.safeParse({ name: 'Ada', email: 'forged@example.test' }).success,
    ).toBe(false);
  });
});

describe('Settings preference schemas', () => {
  it('accepts valid IANA timezones and rejects invalid values or extra keys', () => {
    expect(UpdateTimezoneSchema.parse({ timezone: 'Asia/Bangkok' })).toEqual({
      timezone: 'Asia/Bangkok',
    });
    expect(UpdateTimezoneSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(
      UpdateTimezoneSchema.safeParse({ timezone: 'UTC', activeWorkspaceId: crypto.randomUUID() })
        .success,
    ).toBe(false);
  });

  it('accepts only last-observed locale/theme fields', () => {
    expect(SyncObservedPreferencesSchema.parse({ locale: 'th', theme: 'dark' })).toEqual({
      locale: 'th',
      theme: 'dark',
    });
    expect(SyncObservedPreferencesSchema.safeParse({}).success).toBe(false);
    expect(
      SyncObservedPreferencesSchema.safeParse({
        theme: 'dark',
        activeTradingAccountId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
});
