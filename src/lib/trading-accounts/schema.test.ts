import { describe, expect, it } from 'vitest';

import { OnboardingStepOneSchema, OnboardingStepTwoSchema, OnboardingSubmitSchema } from './schema';

const VALID_STEP_ONE = {
  name: 'My Trading Account',
  brokerName: '',
  platformName: '',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '10000',
};

const VALID_STEP_TWO = {
  timezone: 'Asia/Bangkok',
  riskPerTradePercent: '1',
  maximumDailyLossPercent: '3',
};

describe('OnboardingStepOneSchema', () => {
  it('accepts fully valid input', () => {
    const result = OnboardingStepOneSchema.safeParse(VALID_STEP_ONE);
    expect(result.success).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = OnboardingStepOneSchema.safeParse({ ...VALID_STEP_ONE, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a name that is only whitespace', () => {
    const result = OnboardingStepOneSchema.safeParse({ ...VALID_STEP_ONE, name: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid account mode', () => {
    const result = OnboardingStepOneSchema.safeParse({ ...VALID_STEP_ONE, accountMode: 'paper' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid base currency', () => {
    const result = OnboardingStepOneSchema.safeParse({ ...VALID_STEP_ONE, baseCurrency: 'usd' });
    expect(result.success).toBe(false);
  });

  it('rejects a negative starting balance', () => {
    const result = OnboardingStepOneSchema.safeParse({
      ...VALID_STEP_ONE,
      startingBalance: '-1',
    });
    expect(result.success).toBe(false);
  });

  it('turns an empty optional brokerName/platformName into undefined, never a stored empty string', () => {
    const result = OnboardingStepOneSchema.parse(VALID_STEP_ONE);
    expect(result.brokerName).toBeUndefined();
    expect(result.platformName).toBeUndefined();
  });

  it('preserves a provided brokerName/platformName', () => {
    const result = OnboardingStepOneSchema.parse({
      ...VALID_STEP_ONE,
      brokerName: 'Interactive Brokers',
      platformName: 'TWS',
    });
    expect(result.brokerName).toBe('Interactive Brokers');
    expect(result.platformName).toBe('TWS');
  });

  it('rejects a brokerName containing HTML markup', () => {
    const result = OnboardingStepOneSchema.safeParse({
      ...VALID_STEP_ONE,
      brokerName: '<script>alert(1)</script>',
    });
    expect(result.success).toBe(false);
  });
});

describe('OnboardingStepTwoSchema', () => {
  it('accepts fully valid input', () => {
    const result = OnboardingStepTwoSchema.safeParse(VALID_STEP_TWO);
    expect(result.success).toBe(true);
  });

  it('accepts an omitted (optional) risk/loss percentage', () => {
    const result = OnboardingStepTwoSchema.safeParse({
      timezone: 'UTC',
      riskPerTradePercent: '',
      maximumDailyLossPercent: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid IANA timezone', () => {
    const result = OnboardingStepTwoSchema.safeParse({
      ...VALID_STEP_TWO,
      timezone: 'Not/AZone',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a risk percentage of exactly zero', () => {
    const result = OnboardingStepTwoSchema.safeParse({
      ...VALID_STEP_TWO,
      riskPerTradePercent: '0',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a maximum daily loss percentage over 100', () => {
    const result = OnboardingStepTwoSchema.safeParse({
      ...VALID_STEP_TWO,
      maximumDailyLossPercent: '150',
    });
    expect(result.success).toBe(false);
  });
});

describe('OnboardingSubmitSchema', () => {
  it('accepts the combined, fully valid payload', () => {
    const result = OnboardingSubmitSchema.safeParse({ ...VALID_STEP_ONE, ...VALID_STEP_TWO });
    expect(result.success).toBe(true);
  });

  it('rejects when step-one fields are invalid, even if step-two is valid', () => {
    const result = OnboardingSubmitSchema.safeParse({
      ...VALID_STEP_ONE,
      ...VALID_STEP_TWO,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when step-two fields are invalid, even if step-one is valid', () => {
    const result = OnboardingSubmitSchema.safeParse({
      ...VALID_STEP_ONE,
      ...VALID_STEP_TWO,
      timezone: 'Not/AZone',
    });
    expect(result.success).toBe(false);
  });

  it('never includes a workspaceId or userId field even if the caller tries to smuggle one in', () => {
    const result = OnboardingSubmitSchema.safeParse({
      ...VALID_STEP_ONE,
      ...VALID_STEP_TWO,
      workspaceId: 'forged-workspace-id',
      userId: 'forged-user-id',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('workspaceId');
      expect(result.data).not.toHaveProperty('userId');
    }
  });
});
