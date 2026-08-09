import { describe, expect, it } from 'vitest';

import {
  DISPLAY_NAME_MAX_LENGTH,
  SyncObservedPreferencesSchema,
  UpdateDisplayNameSchema,
  UpdateTimezoneSchema,
  UpdateWorkspaceNameSchema,
  WORKSPACE_NAME_MAX_LENGTH,
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

describe('UpdateWorkspaceNameSchema', () => {
  it.each(['Trading Workspace', 'พื้นที่ทำงานของกานต์'])('accepts workspace name %s', (name) => {
    expect(UpdateWorkspaceNameSchema.parse({ name })).toEqual({ name });
  });

  it('normalizes outer whitespace', () => {
    expect(UpdateWorkspaceNameSchema.parse({ name: '  Alpha Workspace  ' })).toEqual({
      name: 'Alpha Workspace',
    });
  });

  it('rejects blank, max-length overflow, unsafe markup, non-string, slug and unknown fields', () => {
    expect(UpdateWorkspaceNameSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(
      UpdateWorkspaceNameSchema.safeParse({ name: 'a'.repeat(WORKSPACE_NAME_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(UpdateWorkspaceNameSchema.safeParse({ name: '<b>Alpha</b>' }).success).toBe(false);
    expect(UpdateWorkspaceNameSchema.safeParse({ name: 42 }).success).toBe(false);
    expect(
      UpdateWorkspaceNameSchema.safeParse({ name: 'Alpha', slug: 'foreign-target' }).success,
    ).toBe(false);
    expect(
      UpdateWorkspaceNameSchema.safeParse({ name: 'Alpha', workspaceId: crypto.randomUUID() })
        .success,
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
