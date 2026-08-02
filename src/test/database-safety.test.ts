import { describe, expect, it } from 'vitest';

import {
  TEST_DATABASE_ACKNOWLEDGEMENT,
  validateTestDatabaseEnvironment,
} from '../../scripts/test-database-safety.mjs';

const acknowledged = { TEST_DATABASE_ACK: TEST_DATABASE_ACKNOWLEDGEMENT };

describe('test database safety', () => {
  it('accepts an explicitly acknowledged test database', () => {
    expect(
      validateTestDatabaseEnvironment({
        ...acknowledged,
        TEST_DATABASE_URL: 'postgresql://user:secret@localhost:5432/trading_os_test',
      }).hostname,
    ).toBe('localhost');
  });

  it('requires both an unmistakable database name and the acknowledgement', () => {
    expect(() =>
      validateTestDatabaseEnvironment({
        TEST_DATABASE_URL: 'postgresql://user:secret@localhost/trading_os',
      }),
    ).toThrow(/test or e2e/);
    expect(() =>
      validateTestDatabaseEnvironment({
        TEST_DATABASE_URL: 'postgresql://user:secret@localhost/trading_os_test',
      }),
    ).toThrow(/TEST_DATABASE_ACK/);
  });

  it('recognizes aliases, credentials, and query strings for the same database', () => {
    expect(() =>
      validateTestDatabaseEnvironment({
        ...acknowledged,
        TEST_DATABASE_URL: 'postgresql://test:one@localhost/trading_os_test?sslmode=disable',
        DATABASE_URL: 'postgres://app:two@127.0.0.1:5432/trading_os_test',
      }),
    ).toThrow(/same database as DATABASE_URL/);
  });

  it('also refuses the migration target even when the app URL is absent', () => {
    expect(() =>
      validateTestDatabaseEnvironment({
        ...acknowledged,
        TEST_DATABASE_URL: 'postgresql://test:one@localhost/trading_os_e2e',
        DATABASE_MIGRATION_URL: 'postgresql://admin:two@127.0.0.1/trading_os_e2e',
      }),
    ).toThrow(/same database as DATABASE_MIGRATION_URL/);
  });
});
