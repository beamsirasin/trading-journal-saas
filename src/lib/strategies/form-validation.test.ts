import { describe, expect, it } from 'vitest';

import {
  validateChangeNote,
  validateRuleFields,
  validateSetupContentFields,
  validateStrategyContentFields,
} from './form-validation';

describe('validateStrategyContentFields', () => {
  it('requires a non-blank name', () => {
    expect(validateStrategyContentFields({ name: '', description: '', notes: '' })).toEqual({
      name: 'required',
    });
    expect(validateStrategyContentFields({ name: '   ', description: '', notes: '' })).toEqual({
      name: 'required',
    });
  });

  it('accepts a valid name with blank optional fields', () => {
    expect(
      validateStrategyContentFields({ name: 'Elliott Wave + RSI', description: '', notes: '' }),
    ).toEqual({});
  });

  it('rejects a name over the max length', () => {
    expect(
      validateStrategyContentFields({ name: 'a'.repeat(200), description: '', notes: '' }),
    ).toEqual({ name: 'tooLong' });
  });

  it('rejects control/HTML characters in optional fields', () => {
    expect(
      validateStrategyContentFields({
        name: 'Valid name',
        description: '<script>alert(1)</script>',
        notes: '',
      }),
    ).toEqual({ description: 'invalidCharacters' });
  });
});

describe('validateSetupContentFields', () => {
  it('requires a non-blank name', () => {
    expect(validateSetupContentFields({ name: '', description: '' })).toEqual({ name: 'required' });
  });

  it('accepts a valid setup', () => {
    expect(validateSetupContentFields({ name: 'Wave 2 Reversal', description: '' })).toEqual({});
  });
});

describe('validateRuleFields', () => {
  it('requires a non-blank title', () => {
    expect(validateRuleFields({ title: '', description: '' })).toEqual({ title: 'required' });
  });

  it('accepts a valid rule', () => {
    expect(validateRuleFields({ title: 'Wait for confirmation', description: '' })).toEqual({});
  });
});

describe('validateChangeNote', () => {
  it('requires a non-blank note', () => {
    expect(validateChangeNote('')).toBe('required');
    expect(validateChangeNote('   ')).toBe('required');
  });

  it('accepts a valid note', () => {
    expect(validateChangeNote('Tightened the invalidation rule')).toBeUndefined();
  });

  it('rejects a note over the max length', () => {
    expect(validateChangeNote('a'.repeat(600))).toBe('tooLong');
  });
});
