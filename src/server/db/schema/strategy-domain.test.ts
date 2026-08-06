import { getTableColumns } from 'drizzle-orm';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  isStrategyRuleCategory,
  STRATEGY_RULE_CATEGORIES,
  type StrategyRuleCategory,
} from '@/lib/strategies/constants';

import { setups } from './setups';
import { strategies, strategyVersions } from './strategies';
import { strategyRules } from './strategy-rules';
import { strategySetupVersions } from './strategy-setup-versions';

function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.keys(getTableColumns(table)).sort();
}

describe('Phase 06B strategy domain schema', () => {
  describe('exported tables exist with the exact approved column set', () => {
    it('strategies is an identity row only', () => {
      expect(columnNames(strategies)).toEqual(
        [
          'id',
          'workspaceId',
          'currentVersionId',
          'isArchived',
          'mutationKey',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
    });

    it('strategy_versions carries the versioned content', () => {
      expect(columnNames(strategyVersions)).toEqual(
        [
          'id',
          'workspaceId',
          'strategyId',
          'versionNumber',
          'name',
          'description',
          'notes',
          'changeNote',
          'lockedAt',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
    });

    it('setups is an identity row only', () => {
      expect(columnNames(setups)).toEqual(
        [
          'id',
          'workspaceId',
          'strategyId',
          'isArchived',
          'mutationKey',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
    });

    it('strategy_setup_versions carries the per-version setup snapshot', () => {
      expect(columnNames(strategySetupVersions)).toEqual(
        [
          'id',
          'workspaceId',
          'strategyId',
          'strategyVersionId',
          'setupId',
          'name',
          'description',
          'sortOrder',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
    });

    it('strategy_rules carries structured rule content', () => {
      expect(columnNames(strategyRules)).toEqual(
        [
          'id',
          'workspaceId',
          'strategyVersionId',
          'setupVersionId',
          'ruleKey',
          'category',
          'title',
          'description',
          'isRequired',
          'isPreTradeCheck',
          'sortOrder',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
    });
  });

  describe('absence of deleted_at anywhere in the domain', () => {
    it.each([
      ['strategies', strategies],
      ['strategy_versions', strategyVersions],
      ['setups', setups],
      ['strategy_setup_versions', strategySetupVersions],
      ['strategy_rules', strategyRules],
    ] as const)('%s has no deleted_at / deletedAt column', (_label, table) => {
      const names = columnNames(table);
      expect(names).not.toContain('deletedAt');
      expect(names).not.toContain('deleted_at');
    });
  });

  describe('absence of plan/entitlement-limit columns', () => {
    it.each([
      ['strategies', strategies],
      ['setups', setups],
    ] as const)('%s carries no plan/account-limit column', (_label, table) => {
      const names = columnNames(table);
      for (const forbidden of [
        'planKey',
        'plan_key',
        'accountPlan',
        'account_plan',
        'strategyLimit',
        'setupLimit',
      ]) {
        expect(names).not.toContain(forbidden);
      }
    });
  });

  describe('absence of deferred trade-context and analytics columns', () => {
    it('strategy_versions has no instrument/timeframe/default-risk columns', () => {
      const names = columnNames(strategyVersions);
      for (const forbidden of [
        'instrumentClass',
        'instrument_class',
        'timeframe',
        'defaultTimeframe',
        'defaultRisk',
        'default_risk',
        'setupChecklist',
        'entryRules',
        'exitRules',
        'riskRules',
      ]) {
        expect(names).not.toContain(forbidden);
      }
    });

    it('strategy_setup_versions has no expected-R/target/symbol/wave columns', () => {
      const names = columnNames(strategySetupVersions);
      for (const forbidden of [
        'expectedMinimumR',
        'expected_minimum_r',
        'targetGuidance',
        'target_guidance',
        'timeframe',
        'symbol',
        'waveNumber',
        'wave_number',
      ]) {
        expect(names).not.toContain(forbidden);
      }
    });

    it('strategy_rules has no severity weight or penalty/analytics columns', () => {
      const names = columnNames(strategyRules);
      for (const forbidden of [
        'severityWeight',
        'severity_weight',
        'penalty',
        'penaltyWeight',
        'analyticsResult',
      ]) {
        expect(names).not.toContain(forbidden);
      }
    });
  });

  describe('identity rows never carry versioned display content', () => {
    it('strategies has no name/description/notes — that content lives on strategy_versions', () => {
      const names = columnNames(strategies);
      expect(names).not.toContain('name');
      expect(names).not.toContain('description');
      expect(names).not.toContain('notes');
    });

    it('setups has no name/description — that content lives on strategy_setup_versions', () => {
      const names = columnNames(setups);
      expect(names).not.toContain('name');
      expect(names).not.toContain('description');
    });

    it('strategies.$inferSelect has no name field at the type level', () => {
      expectTypeOf<typeof strategies.$inferSelect>().not.toHaveProperty('name');
    });

    it('setups.$inferSelect has no name field at the type level', () => {
      expectTypeOf<typeof setups.$inferSelect>().not.toHaveProperty('name');
    });
  });

  describe('approved rule categories', () => {
    it('is the exact five-category set from the approved model', () => {
      expect([...STRATEGY_RULE_CATEGORIES].sort()).toEqual(
        ['entry', 'invalidation', 'risk', 'management', 'exit'].sort(),
      );
    });

    it('isStrategyRuleCategory accepts every approved category', () => {
      for (const category of STRATEGY_RULE_CATEGORIES) {
        expect(isStrategyRuleCategory(category)).toBe(true);
      }
    });

    it('isStrategyRuleCategory rejects an unapproved value', () => {
      expect(isStrategyRuleCategory('confirmation')).toBe(false);
      expect(isStrategyRuleCategory('')).toBe(false);
      expect(isStrategyRuleCategory(42)).toBe(false);
    });

    it('the type is exactly the union of the const array', () => {
      expectTypeOf<StrategyRuleCategory>().toEqualTypeOf<
        'entry' | 'invalidation' | 'risk' | 'management' | 'exit'
      >();
    });
  });

  describe('setup version and rule inferred types carry the expected shape', () => {
    it('strategy_setup_versions.$inferSelect has setupId, strategyVersionId, sortOrder', () => {
      expectTypeOf<typeof strategySetupVersions.$inferSelect>().toHaveProperty('setupId');
      expectTypeOf<typeof strategySetupVersions.$inferSelect>().toHaveProperty('strategyVersionId');
      expectTypeOf<typeof strategySetupVersions.$inferSelect>().toHaveProperty('sortOrder');
    });

    it('strategy_rules.$inferSelect has ruleKey, category, setupVersionId (nullable)', () => {
      type Row = typeof strategyRules.$inferSelect;
      expectTypeOf<Row>().toHaveProperty('ruleKey');
      expectTypeOf<Row>().toHaveProperty('category');
      expectTypeOf<Row['setupVersionId']>().toEqualTypeOf<string | null>();
    });
  });
});
