import { describe, expect, it } from 'vitest';

import {
  CreateSetupSchema,
  CreateStrategyRuleSchema,
  CreateStrategySchema,
  RemoveStrategyRuleSchema,
  SetupLifecycleSchema,
  StrategyIdSchema,
  StrategyLifecycleSchema,
  UpdateSetupContentSchema,
  UpdateStrategyContentSchema,
  UpdateStrategyRuleSchema,
} from './schemas';

/**
 * Phase 06D's client-facing input boundary. The central property under test
 * throughout this file: every object schema is `.strict()`, so a client
 * payload smuggling a server-only field (`workspaceId`, `actorUserId`,
 * `isArchived`, `currentVersionId`, `versionNumber`, `lockedAt`, a raw Rule
 * row `id`) fails validation outright rather than being silently stripped.
 */

const uuid = () => crypto.randomUUID();

describe('CreateStrategySchema', () => {
  const base = () => ({ mutationKey: uuid(), name: 'Trend Following' });

  it('accepts a minimal valid payload', () => {
    expect(CreateStrategySchema.safeParse(base()).success).toBe(true);
  });

  it('accepts optional description/notes when present', () => {
    const result = CreateStrategySchema.safeParse({
      ...base(),
      description: 'A description',
      notes: 'Some notes',
    });
    expect(result.success).toBe(true);
  });

  it('treats an empty-string optional field as absent, not stored empty', () => {
    const result = CreateStrategySchema.safeParse({ ...base(), description: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
    }
  });

  it('rejects a missing mutationKey', () => {
    const { mutationKey: _mutationKey, ...rest } = base();
    expect(CreateStrategySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a non-UUID mutationKey', () => {
    expect(CreateStrategySchema.safeParse({ ...base(), mutationKey: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('rejects a blank name', () => {
    expect(CreateStrategySchema.safeParse({ ...base(), name: '' }).success).toBe(false);
  });

  it('rejects a name over the configured max length', () => {
    expect(CreateStrategySchema.safeParse({ ...base(), name: 'x'.repeat(121) }).success).toBe(
      false,
    );
  });

  it('rejects HTML markup in name', () => {
    expect(CreateStrategySchema.safeParse({ ...base(), name: '<script>' }).success).toBe(false);
  });

  it('rejects control characters in description', () => {
    expect(CreateStrategySchema.safeParse({ ...base(), description: 'badtext' }).success).toBe(
      false,
    );
  });

  it('rejects an unrecognized key — the security boundary itself', () => {
    const result = CreateStrategySchema.safeParse({
      ...base(),
      workspaceId: uuid(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a client attempt to set isArchived/currentVersionId/actorUserId', () => {
    for (const forged of [
      { isArchived: true },
      { currentVersionId: uuid() },
      { actorUserId: uuid() },
      { lockedAt: new Date().toISOString() },
    ]) {
      const result = CreateStrategySchema.safeParse({ ...base(), ...forged });
      expect(result.success).toBe(false);
    }
  });
});

describe('UpdateStrategyContentSchema', () => {
  const base = () => ({ strategyId: uuid(), name: 'Updated name' });

  it('accepts a minimal valid payload without changeNote', () => {
    expect(UpdateStrategyContentSchema.safeParse(base()).success).toBe(true);
  });

  it('accepts an explicit changeNote', () => {
    const result = UpdateStrategyContentSchema.safeParse({
      ...base(),
      changeNote: 'Tightened stop rule',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a changeNote over the configured max length', () => {
    const result = UpdateStrategyContentSchema.safeParse({
      ...base(),
      changeNote: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a forged versionNumber field', () => {
    expect(UpdateStrategyContentSchema.safeParse({ ...base(), versionNumber: 3 }).success).toBe(
      false,
    );
  });
});

describe('StrategyLifecycleSchema', () => {
  it('accepts a bare strategyId', () => {
    expect(StrategyLifecycleSchema.safeParse({ strategyId: uuid() }).success).toBe(true);
  });

  it('rejects a non-UUID strategyId', () => {
    expect(StrategyLifecycleSchema.safeParse({ strategyId: 'nope' }).success).toBe(false);
  });

  it('rejects any extra key', () => {
    expect(
      StrategyLifecycleSchema.safeParse({ strategyId: uuid(), workspaceId: uuid() }).success,
    ).toBe(false);
  });
});

describe('CreateSetupSchema', () => {
  const base = () => ({
    strategyId: uuid(),
    mutationKey: uuid(),
    name: 'Breakout setup',
    sortOrder: 0,
  });

  it('accepts a minimal valid payload', () => {
    expect(CreateSetupSchema.safeParse(base()).success).toBe(true);
  });

  it('rejects a negative sortOrder', () => {
    expect(CreateSetupSchema.safeParse({ ...base(), sortOrder: -1 }).success).toBe(false);
  });

  it('rejects a non-integer sortOrder', () => {
    expect(CreateSetupSchema.safeParse({ ...base(), sortOrder: 1.5 }).success).toBe(false);
  });

  it('rejects a missing sortOrder', () => {
    const { sortOrder: _sortOrder, ...rest } = base();
    expect(CreateSetupSchema.safeParse(rest).success).toBe(false);
  });
});

describe('UpdateSetupContentSchema', () => {
  it('requires both strategyId and setupId', () => {
    const full = { strategyId: uuid(), setupId: uuid(), name: 'Setup', sortOrder: 0 };
    expect(UpdateSetupContentSchema.safeParse(full).success).toBe(true);
    const { setupId: _setupId, ...missingSetupId } = full;
    expect(UpdateSetupContentSchema.safeParse(missingSetupId).success).toBe(false);
  });
});

describe('SetupLifecycleSchema', () => {
  it('accepts strategyId + setupId, rejects extras', () => {
    const valid = { strategyId: uuid(), setupId: uuid() };
    expect(SetupLifecycleSchema.safeParse(valid).success).toBe(true);
    expect(SetupLifecycleSchema.safeParse({ ...valid, isArchived: false }).success).toBe(false);
  });
});

describe('CreateStrategyRuleSchema', () => {
  const base = () => ({
    strategyId: uuid(),
    ruleKey: uuid(),
    category: 'entry' as const,
    title: 'Confirm trend direction',
    isRequired: true,
    isPreTradeCheck: true,
    sortOrder: 0,
  });

  it('accepts a Strategy-level rule (no setupId)', () => {
    expect(CreateStrategyRuleSchema.safeParse(base()).success).toBe(true);
  });

  it('accepts a Setup-level rule (setupId present)', () => {
    expect(CreateStrategyRuleSchema.safeParse({ ...base(), setupId: uuid() }).success).toBe(true);
  });

  it('rejects an invalid category', () => {
    expect(
      CreateStrategyRuleSchema.safeParse({ ...base(), category: 'not-a-category' }).success,
    ).toBe(false);
  });

  it('requires isRequired explicitly (not optional)', () => {
    const { isRequired: _isRequired, ...rest } = base();
    expect(CreateStrategyRuleSchema.safeParse(rest).success).toBe(false);
  });

  it('requires isPreTradeCheck explicitly (not optional)', () => {
    const { isPreTradeCheck: _isPreTradeCheck, ...rest } = base();
    expect(CreateStrategyRuleSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a blank title', () => {
    expect(CreateStrategyRuleSchema.safeParse({ ...base(), title: '' }).success).toBe(false);
  });

  it('rejects a title over the configured max length', () => {
    expect(CreateStrategyRuleSchema.safeParse({ ...base(), title: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });

  it('rejects a forged rule row id', () => {
    expect(CreateStrategyRuleSchema.safeParse({ ...base(), id: uuid() }).success).toBe(false);
  });
});

describe('UpdateStrategyRuleSchema', () => {
  it('mirrors CreateStrategyRuleSchema’s shape, keyed by ruleKey', () => {
    const valid = {
      strategyId: uuid(),
      ruleKey: uuid(),
      category: 'risk' as const,
      title: 'Risk check',
      isRequired: false,
      isPreTradeCheck: false,
      sortOrder: 1,
    };
    expect(UpdateStrategyRuleSchema.safeParse(valid).success).toBe(true);
  });
});

describe('RemoveStrategyRuleSchema', () => {
  it('accepts ruleKey with optional setupId/changeNote', () => {
    expect(
      RemoveStrategyRuleSchema.safeParse({ strategyId: uuid(), ruleKey: uuid() }).success,
    ).toBe(true);
    expect(
      RemoveStrategyRuleSchema.safeParse({
        strategyId: uuid(),
        setupId: uuid(),
        ruleKey: uuid(),
        changeNote: 'Removing redundant rule',
      }).success,
    ).toBe(true);
  });

  it('rejects a missing ruleKey', () => {
    expect(RemoveStrategyRuleSchema.safeParse({ strategyId: uuid() }).success).toBe(false);
  });
});

describe('StrategyIdSchema', () => {
  it('accepts a UUID and rejects anything else', () => {
    expect(StrategyIdSchema.safeParse(uuid()).success).toBe(true);
    expect(StrategyIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
