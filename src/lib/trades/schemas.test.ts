import { describe, expect, it } from 'vitest';

import {
  AttachTradeMistakeSchema,
  CancelTradeSchema,
  CloseTradeSchema,
  CorrectSystemResolutionSchema,
  CorrectTradeExecutionSchema,
  CorrectTradeIdentitySchema,
  CreateTradeSchema,
  MarkSystemNoTradeSchema,
  OpenTradeSchema,
  RemoveTradeMistakeSchema,
  ReplaceTradeEmotionsSchema,
  ResolveSystemTradeSchema,
  SoftDeleteTradeSchema,
  UpdateTradePlanSchema,
  UpdateTradeReviewNotesSchema,
  UpdateTradeRuleCheckSchema,
} from './schemas';

const uuid1 = '019112a0-0000-7000-8000-000000000001';
const uuid2 = '019112a0-0000-7000-8000-000000000002';
const uuid3 = '019112a0-0000-7000-8000-000000000003';

function baseCreateInput() {
  return {
    mutationKey: uuid1,
    tradingAccountId: uuid2,
    strategyId: uuid3,
    setupId: uuid1,
    conditionSetToken: 'a'.repeat(64),
    conditionAnswers: [],
    emotionKeys: [],
    symbol: 'EURUSD',
    direction: 'long' as const,
    plannedEntry: '1.1000000000',
    plannedStop: '1.0950000000',
    plannedTarget: '1.1100000000',
  };
}

describe('trades/schemas — valid input', () => {
  it('CreateTradeSchema accepts a minimal valid Plan (no Target)', () => {
    const { plannedTarget: _plannedTarget, ...withoutTarget } = baseCreateInput();
    const result = CreateTradeSchema.safeParse(withoutTarget);
    expect(result.success).toBe(true);
  });

  it('CreateTradeSchema accepts a full valid Plan with every optional field', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseCreateInput(),
      plannedPositionSize: '100000',
      timeframe: '4H',
      session: 'London',
      confirmationNotes: 'Confluence with the daily trend.',
      confidence: 75,
      tradingviewUrl: 'https://www.tradingview.com/chart/abc123/',
      notes: 'Entered on the retest.',
    });
    expect(result.success).toBe(true);
  });

  it('CreateTradeSchema accepts binary Setup Condition answers', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseCreateInput(),
      conditionAnswers: [
        { conditionKey: uuid2, status: 'met' },
        { conditionKey: uuid3, status: 'not_met' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts zero or multiple canonical Emotions and rejects duplicates or unknown keys', () => {
    expect(CreateTradeSchema.safeParse({ ...baseCreateInput(), emotionKeys: [] }).success).toBe(
      true,
    );
    expect(
      CreateTradeSchema.safeParse({ ...baseCreateInput(), emotionKeys: ['calm', 'fomo'] }).success,
    ).toBe(true);
    expect(
      CreateTradeSchema.safeParse({ ...baseCreateInput(), emotionKeys: ['calm', 'calm'] }).success,
    ).toBe(false);
    expect(
      CreateTradeSchema.safeParse({ ...baseCreateInput(), emotionKeys: ['invented'] }).success,
    ).toBe(false);
  });

  it('validates Emotion replacement and nullable post-trade review notes', () => {
    expect(
      ReplaceTradeEmotionsSchema.safeParse({ tradeId: uuid1, emotionKeys: ['focused'] }).success,
    ).toBe(true);
    expect(
      ReplaceTradeEmotionsSchema.safeParse({ tradeId: uuid1, emotionKeys: ['focused', 'focused'] })
        .success,
    ).toBe(false);
    expect(
      UpdateTradeReviewNotesSchema.safeParse({ tradeId: uuid1, reviewNotes: null }).success,
    ).toBe(true);
  });

  it('CreateTradeSchema rejects client-supplied Condition snapshot content', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseCreateInput(),
      conditionAnswers: [{ conditionKey: uuid2, status: 'met', label: 'forged' }],
    });
    expect(result.success).toBe(false);
  });

  it('CreateTradeSchema rejects invalid Condition status and malformed concurrency tokens', () => {
    expect(
      CreateTradeSchema.safeParse({
        ...baseCreateInput(),
        conditionAnswers: [{ conditionKey: uuid2, status: 'partial' }],
      }).success,
    ).toBe(false);
    expect(
      CreateTradeSchema.safeParse({ ...baseCreateInput(), conditionSetToken: uuid1 }).success,
    ).toBe(false);
  });

  it('OpenTradeSchema accepts valid primitive open data', () => {
    const result = OpenTradeSchema.safeParse({
      tradeId: uuid1,
      actualEntry: '1.1005000000',
      actualInitialStop: '1.0950000000',
      actualInitialRiskMinor: '5000',
      enteredAt: '2026-08-01T09:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actualInitialRiskMinor).toBe(5000n);
      expect(result.data.enteredAt).toBeInstanceOf(Date);
    }
  });

  it('CloseTradeSchema accepts a negative netPnlMinor (a loss)', () => {
    const result = CloseTradeSchema.safeParse({
      tradeId: uuid1,
      actualExit: '1.0900000000',
      netPnlMinor: '-2500',
      exitedAt: '2026-08-01T14:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.netPnlMinor).toBe(-2500n);
  });

  it('ResolveSystemTradeSchema accepts a valid resolve payload', () => {
    const result = ResolveSystemTradeSchema.safeParse({
      tradeId: uuid1,
      systemExitPrice: '1.1100000000',
      systemExitedAt: '2026-08-01T12:00:00Z',
      systemExitReason: 'target_hit',
      systemCostR: '0.0500',
    });
    expect(result.success).toBe(true);
  });

  it('UpdateTradeRuleCheckSchema accepts every valid check status', () => {
    for (const checkStatus of ['followed', 'violated', 'not_applicable', 'not_checked']) {
      const result = UpdateTradeRuleCheckSchema.safeParse({
        tradeId: uuid1,
        ruleKey: uuid2,
        checkStatus,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('trades/schemas — unknown field rejection (.strict())', () => {
  it('CreateTradeSchema rejects an extra unknown field', () => {
    const result = CreateTradeSchema.safeParse({ ...baseCreateInput(), extraField: 'nope' });
    expect(result.success).toBe(false);
  });

  it('OpenTradeSchema rejects an extra unknown field', () => {
    const result = OpenTradeSchema.safeParse({
      tradeId: uuid1,
      actualEntry: '1.1',
      actualInitialStop: '1.09',
      actualInitialRiskMinor: '5000',
      enteredAt: '2026-08-01T09:00:00Z',
      extraField: true,
    });
    expect(result.success).toBe(false);
  });

  it('UpdateTradeRuleCheckSchema rejects an extra unknown field', () => {
    const result = UpdateTradeRuleCheckSchema.safeParse({
      tradeId: uuid1,
      ruleKey: uuid2,
      checkStatus: 'followed',
      extraField: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('trades/schemas — injection rejection: trusted/derived fields can never be supplied', () => {
  const forbiddenFieldsByExample: Record<string, unknown> = {
    workspaceId: uuid1,
    actorUserId: uuid1,
    strategyVersionId: uuid1,
    setupVersionId: uuid1,
    actualR: '2.0000',
    traderOutcome: 'win',
    systemR: '2.0000',
    systemOutcome: 'win',
    plannedR: '2.0000',
    calcVersion: 1,
    systemResolvedAt: '2026-08-01T00:00:00Z',
    deletedAt: '2026-08-01T00:00:00Z',
    status: 'closed',
    systemStatus: 'resolved',
    auditMetadata: { tradeId: uuid1 },
    strategyRuleId: uuid1,
    ruleTitle: 'A rule title',
    ruleCategory: 'entry',
    isRequired: true,
    isPreTradeCheck: false,
    sortOrder: 0,
    severityAtTime: 'moderate',
    weightAtTime: '1.0000',
  };

  it.each(Object.entries(forbiddenFieldsByExample))(
    'CreateTradeSchema rejects an injected "%s"',
    (field, value) => {
      const result = CreateTradeSchema.safeParse({ ...baseCreateInput(), [field]: value });
      expect(result.success).toBe(false);
    },
  );

  it.each(Object.entries(forbiddenFieldsByExample))(
    'OpenTradeSchema rejects an injected "%s"',
    (field, value) => {
      const result = OpenTradeSchema.safeParse({
        tradeId: uuid1,
        actualEntry: '1.1',
        actualInitialStop: '1.09',
        actualInitialRiskMinor: '5000',
        enteredAt: '2026-08-01T09:00:00Z',
        [field]: value,
      });
      expect(result.success).toBe(false);
    },
  );

  it.each(Object.entries(forbiddenFieldsByExample))(
    'ResolveSystemTradeSchema rejects an injected "%s"',
    (field, value) => {
      const result = ResolveSystemTradeSchema.safeParse({
        tradeId: uuid1,
        systemExitPrice: '1.11',
        systemExitedAt: '2026-08-01T12:00:00Z',
        systemExitReason: 'target_hit',
        systemCostR: '0.05',
        [field]: value,
      });
      expect(result.success).toBe(false);
    },
  );

  it.each(Object.entries(forbiddenFieldsByExample))(
    'UpdateTradeRuleCheckSchema rejects an injected "%s"',
    (field, value) => {
      const result = UpdateTradeRuleCheckSchema.safeParse({
        tradeId: uuid1,
        ruleKey: uuid2,
        checkStatus: 'followed',
        [field]: value,
      });
      expect(result.success).toBe(false);
    },
  );

  it('AttachTradeMistakeSchema rejects an injected severity/weight snapshot', () => {
    const result = AttachTradeMistakeSchema.safeParse({
      tradeId: uuid1,
      mistakeTypeId: uuid2,
      severityAtTime: 'severe',
      weightAtTime: '0.6000',
    });
    expect(result.success).toBe(false);
  });

  it('UpdateTradeRuleCheckSchema rejects strategyRuleId in place of ruleKey', () => {
    const result = UpdateTradeRuleCheckSchema.safeParse({
      tradeId: uuid1,
      strategyRuleId: uuid2,
      checkStatus: 'followed',
    });
    expect(result.success).toBe(false);
  });
});

describe('trades/schemas — money (bigint integer-string) parsing', () => {
  it('rejects a decimal string where an integer minor-unit string is required', () => {
    const result = OpenTradeSchema.safeParse({
      tradeId: uuid1,
      actualEntry: '1.1',
      actualInitialStop: '1.09',
      actualInitialRiskMinor: '5000.50',
      enteredAt: '2026-08-01T09:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive actualInitialRiskMinor', () => {
    const zero = OpenTradeSchema.safeParse({
      tradeId: uuid1,
      actualEntry: '1.1',
      actualInitialStop: '1.09',
      actualInitialRiskMinor: '0',
      enteredAt: '2026-08-01T09:00:00Z',
    });
    expect(zero.success).toBe(false);
  });

  it('rejects a signed actualInitialRiskMinor (unsigned-only field)', () => {
    const result = OpenTradeSchema.safeParse({
      tradeId: uuid1,
      actualEntry: '1.1',
      actualInitialStop: '1.09',
      actualInitialRiskMinor: '-5000',
      enteredAt: '2026-08-01T09:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative commissionMinor (unsigned-only field)', () => {
    const result = CloseTradeSchema.safeParse({
      tradeId: uuid1,
      actualExit: '1.09',
      netPnlMinor: '1000',
      exitedAt: '2026-08-01T14:00:00Z',
      commissionMinor: '-100',
    });
    expect(result.success).toBe(false);
  });

  it('accepts netPnlMinor of exactly "0"', () => {
    const result = CloseTradeSchema.safeParse({
      tradeId: uuid1,
      actualExit: '1.1',
      netPnlMinor: '0',
      exitedAt: '2026-08-01T14:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.netPnlMinor).toBe(0n);
  });
});

describe('trades/schemas — CreateTradeSchema Price/Money independence (migration 0010)', () => {
  function baseIdentity() {
    return {
      mutationKey: uuid1,
      tradingAccountId: uuid2,
      strategyId: uuid3,
      setupId: uuid1,
      conditionSetToken: 'a'.repeat(64),
      conditionAnswers: [],
      emotionKeys: [],
      symbol: 'EURUSD',
      direction: 'long' as const,
    };
  }

  it('accepts a Price-only Plan (no Money fields at all)', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseIdentity(),
      plannedEntry: '1.1000000000',
      plannedStop: '1.0950000000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Money-only Plan (no Price fields at all)', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseIdentity(),
      plannedRiskMinor: '5000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts both Price and Money together', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseIdentity(),
      plannedEntry: '1.1000000000',
      plannedStop: '1.0950000000',
      plannedRiskMinor: '5000',
      plannedRewardMinor: '15000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects neither Price nor Money present (no_plan_representation)', () => {
    const result = CreateTradeSchema.safeParse(baseIdentity());
    expect(result.success).toBe(false);
  });

  it('rejects Entry without Stop', () => {
    const result = CreateTradeSchema.safeParse({ ...baseIdentity(), plannedEntry: '1.1' });
    expect(result.success).toBe(false);
  });

  it('rejects a Target without a complete Price pair, even with Money present', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseIdentity(),
      plannedTarget: '1.12',
      plannedRiskMinor: '5000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a Reward without a Risk', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseIdentity(),
      plannedEntry: '1.1',
      plannedStop: '1.09',
      plannedRewardMinor: '15000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive plannedRiskMinor', () => {
    const result = CreateTradeSchema.safeParse({ ...baseIdentity(), plannedRiskMinor: '0' });
    expect(result.success).toBe(false);
  });

  it('accepts plannedRewardMinor of exactly "0" (a break-even-or-better plan)', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseIdentity(),
      plannedRiskMinor: '5000',
      plannedRewardMinor: '0',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.plannedRewardMinor).toBe(0n);
  });

  it('accepts exactly the five allowed Confidence steps (Founder-UAT Confidence redesign)', () => {
    for (const confidence of [0, 25, 50, 75, 100]) {
      const result = CreateTradeSchema.safeParse({
        ...baseIdentity(),
        plannedEntry: '1.1',
        plannedStop: '1.09',
        confidence,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects every Confidence value that is not one of the five allowed steps, even from a bypassing client', () => {
    for (const confidence of [-1, 1, 10, 30, 51, 73, 99, 101]) {
      const result = CreateTradeSchema.safeParse({
        ...baseIdentity(),
        plannedEntry: '1.1',
        plannedStop: '1.09',
        confidence,
      });
      expect(result.success).toBe(false);
    }
  });

  it('accepts a valid chart attachment storage key alone (no URL concept exists — private storage, Founder review)', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseIdentity(),
      plannedEntry: '1.1',
      plannedStop: '1.09',
      chartAttachmentStorageKey:
        'trade-charts/019112a0-0000-7000-8000-000000000002/019112a0-0000-7000-8000-000000000003.png',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed chart attachment storage key', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseIdentity(),
      plannedEntry: '1.1',
      plannedStop: '1.09',
      chartAttachmentStorageKey: 'not-a-real-storage-key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a chart attachment url — no such field exists (.strict() rejects the unknown key)', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseIdentity(),
      plannedEntry: '1.1',
      plannedStop: '1.09',
      chartAttachmentUrl: 'https://abc123.public.blob.vercel-storage.com/trade-charts/x.png',
    });
    expect(result.success).toBe(false);
  });
});

describe('trades/schemas — UpdateTradePlanSchema patch semantics (migration 0010)', () => {
  it('accepts a patch that only sets Money fields, leaving Price entirely absent (unchanged, not asserted)', () => {
    const result = UpdateTradePlanSchema.safeParse({
      tradeId: uuid1,
      plannedRiskMinor: '5000',
      plannedRewardMinor: '15000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts explicitly clearing Entry and Stop together (down to Money-only)', () => {
    const result = UpdateTradePlanSchema.safeParse({
      tradeId: uuid1,
      plannedEntry: null,
      plannedStop: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plannedEntry).toBeNull();
      expect(result.data.plannedStop).toBeNull();
    }
  });

  it('rejects setting Entry while explicitly clearing Stop in the same patch', () => {
    const result = UpdateTradePlanSchema.safeParse({
      tradeId: uuid1,
      plannedEntry: '1.1',
      plannedStop: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts touching only plannedStop, leaving plannedEntry key entirely absent', () => {
    const result = UpdateTradePlanSchema.safeParse({ tradeId: uuid1, plannedStop: '1.0900000000' });
    expect(result.success).toBe(true);
  });

  it('accepts touching only plannedTarget — the "requires a Price pair" rule is a server-side, merged-state concern, not a Zod shape concern', () => {
    const result = UpdateTradePlanSchema.safeParse({
      tradeId: uuid1,
      plannedTarget: '1.1200000000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects setting a Reward while explicitly clearing Risk in the same patch', () => {
    const result = UpdateTradePlanSchema.safeParse({
      tradeId: uuid1,
      plannedRiskMinor: null,
      plannedRewardMinor: '15000',
    });
    expect(result.success).toBe(false);
  });

  it('accepts clearing Reward alongside clearing Risk', () => {
    const result = UpdateTradePlanSchema.safeParse({
      tradeId: uuid1,
      plannedRiskMinor: null,
      plannedRewardMinor: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('trades/schemas — decimal-string validation', () => {
  it('rejects a plannedEntry with a comma thousands separator', () => {
    const result = CreateTradeSchema.safeParse({ ...baseCreateInput(), plannedEntry: '1,100' });
    expect(result.success).toBe(false);
  });

  it('rejects a plannedEntry that is not numeric at all', () => {
    const result = CreateTradeSchema.safeParse({ ...baseCreateInput(), plannedEntry: 'abc' });
    expect(result.success).toBe(false);
  });

  it('accepts a signed decimal for systemCostR (never coerced with Number)', () => {
    const result = ResolveSystemTradeSchema.safeParse({
      tradeId: uuid1,
      systemExitPrice: '1.11',
      systemExitedAt: '2026-08-01T12:00:00Z',
      systemExitReason: 'target_hit',
      systemCostR: '0.0500',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(typeof result.data.systemCostR).toBe('string');
  });
});

describe('trades/schemas — optional/clear Target semantics (updateTradePlan)', () => {
  it('omitting plannedTarget leaves the key absent in the parsed output', () => {
    const result = UpdateTradePlanSchema.safeParse({ tradeId: uuid1, notes: 'typo fix' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.hasOwn(result.data, 'plannedTarget')).toBe(false);
    }
  });

  it('explicit null clears the Target — the key is present with value null', () => {
    const result = UpdateTradePlanSchema.safeParse({ tradeId: uuid1, plannedTarget: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.hasOwn(result.data, 'plannedTarget')).toBe(true);
      expect(result.data.plannedTarget).toBeNull();
    }
  });

  it('a non-blank value sets the Target', () => {
    const result = UpdateTradePlanSchema.safeParse({
      tradeId: uuid1,
      plannedTarget: '1.1200000000',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.plannedTarget).toBe('1.1200000000');
  });

  it('an empty-string HTML input never silently becomes numeric zero', () => {
    const result = UpdateTradePlanSchema.safeParse({ tradeId: uuid1, plannedTarget: '' });
    expect(result.success).toBe(false);
  });
});

describe('trades/schemas — correctTradeIdentity coherent input', () => {
  it('rejects a payload with neither symbol nor direction', () => {
    const result = CorrectTradeIdentitySchema.safeParse({ tradeId: uuid1 });
    expect(result.success).toBe(false);
  });

  it('accepts a symbol-only correction, with no plannedEntry/plannedStop required', () => {
    const result = CorrectTradeIdentitySchema.safeParse({ tradeId: uuid1, symbol: 'GBPUSD' });
    expect(result.success).toBe(true);
  });

  it('accepts a direction correction accompanied by corrected Entry/Stop', () => {
    const result = CorrectTradeIdentitySchema.safeParse({
      tradeId: uuid1,
      direction: 'short',
      plannedEntry: '1.1000000000',
      plannedStop: '1.1050000000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a direction-only correction too (the service alone decides validity)', () => {
    const result = CorrectTradeIdentitySchema.safeParse({ tradeId: uuid1, direction: 'short' });
    expect(result.success).toBe(true);
  });
});

describe('trades/schemas — timestamp validation', () => {
  it('rejects an offset-less timestamp', () => {
    const result = OpenTradeSchema.safeParse({
      tradeId: uuid1,
      actualEntry: '1.1',
      actualInitialStop: '1.09',
      actualInitialRiskMinor: '5000',
      enteredAt: '2026-08-01T09:00:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects browser-locale-style date strings', () => {
    const result = OpenTradeSchema.safeParse({
      tradeId: uuid1,
      actualEntry: '1.1',
      actualInitialStop: '1.09',
      actualInitialRiskMinor: '5000',
      enteredAt: '08/01/2026 9:00 AM',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a numeric-offset ISO instant', () => {
    const result = OpenTradeSchema.safeParse({
      tradeId: uuid1,
      actualEntry: '1.1',
      actualInitialStop: '1.09',
      actualInitialRiskMinor: '5000',
      enteredAt: '2026-08-01T16:00:00+07:00',
    });
    expect(result.success).toBe(true);
  });
});

describe('trades/schemas — TradingView URL validation', () => {
  it('accepts a well-formed tradingview.com chart URL', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseCreateInput(),
      tradingviewUrl: 'https://www.tradingview.com/chart/abc123/',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-HTTPS URL', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseCreateInput(),
      tradingviewUrl: 'http://www.tradingview.com/chart/abc123/',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a host that is not tradingview.com', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseCreateInput(),
      tradingviewUrl: 'https://evil.example.com/tradingview.com/',
    });
    expect(result.success).toBe(false);
  });

  it('rejects embedded userinfo credentials', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseCreateInput(),
      tradingviewUrl: 'https://user:pass@www.tradingview.com/chart/abc123/',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a javascript: scheme outright', () => {
    const result = CreateTradeSchema.safeParse({
      ...baseCreateInput(),
      tradingviewUrl: 'javascript:alert(1)',
    });
    expect(result.success).toBe(false);
  });

  it('treats an empty string as "not provided", not a validation error', () => {
    const result = CreateTradeSchema.safeParse({ ...baseCreateInput(), tradingviewUrl: '' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tradingviewUrl).toBeUndefined();
  });
});

describe('trades/schemas — no restore/pending target in System correction', () => {
  it('CorrectSystemResolutionSchema rejects target: "pending" structurally', () => {
    const result = CorrectSystemResolutionSchema.safeParse({ tradeId: uuid1, target: 'pending' });
    expect(result.success).toBe(false);
  });

  it('accepts the no_trade branch with no other fields', () => {
    const result = CorrectSystemResolutionSchema.safeParse({ tradeId: uuid1, target: 'no_trade' });
    expect(result.success).toBe(true);
  });

  it('rejects setup_invalidated as a resolvable exit reason', () => {
    const result = CorrectSystemResolutionSchema.safeParse({
      tradeId: uuid1,
      target: 'resolved',
      systemExitPrice: '1.11',
      systemExitedAt: '2026-08-01T12:00:00Z',
      systemExitReason: 'setup_invalidated',
      systemCostR: '0',
    });
    expect(result.success).toBe(false);
  });
});

describe('trades/schemas — simple tradeId-only schemas', () => {
  it('CancelTradeSchema/MarkSystemNoTradeSchema/SoftDeleteTradeSchema accept a bare tradeId', () => {
    expect(CancelTradeSchema.safeParse({ tradeId: uuid1 }).success).toBe(true);
    expect(MarkSystemNoTradeSchema.safeParse({ tradeId: uuid1 }).success).toBe(true);
    expect(SoftDeleteTradeSchema.safeParse({ tradeId: uuid1 }).success).toBe(true);
  });

  it('reject a non-UUID tradeId', () => {
    expect(CancelTradeSchema.safeParse({ tradeId: 'not-a-uuid' }).success).toBe(false);
  });

  it('RemoveTradeMistakeSchema requires both tradeId and mistakeTypeId', () => {
    expect(RemoveTradeMistakeSchema.safeParse({ tradeId: uuid1 }).success).toBe(false);
    expect(
      RemoveTradeMistakeSchema.safeParse({ tradeId: uuid1, mistakeTypeId: uuid2 }).success,
    ).toBe(true);
  });
});

describe('trades/schemas — correctTradeExecution', () => {
  it('accepts an empty patch (no fields to correct is a valid, no-op call)', () => {
    const result = CorrectTradeExecutionSchema.safeParse({ tradeId: uuid1 });
    expect(result.success).toBe(true);
  });

  it('accepts a closed-side correction with tri-state grossPnlMinor cleared to null', () => {
    const result = CorrectTradeExecutionSchema.safeParse({
      tradeId: uuid1,
      netPnlMinor: '-1000',
      grossPnlMinor: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.grossPnlMinor).toBeNull();
  });
});
