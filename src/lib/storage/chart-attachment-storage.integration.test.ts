import { afterEach, describe, expect, it } from 'vitest';

import { resetServerEnvCache } from '@/config/env.server';

import {
  getChartAttachmentStorage,
  isChartAttachmentStorageConfigured,
} from './chart-attachment-storage';

/**
 * Lives under `vitest.integration.config.ts` (node environment, `react-server`
 * condition) not because this touches Postgres — it never does — but because
 * `chart-attachment-storage.ts` imports `server-only`, which throws outside a
 * server-like environment exactly like every other file this config exists
 * for. No real Vercel Blob credentials are required or used: only the
 * TOKEN-PRESENCE capability check is exercised here, never a real
 * upload/delete call (see the Founder-UAT Trade Plan UX correction slice
 * report for why a real Blob store could not be provisioned/verified in this
 * environment).
 */
describe('chart-attachment-storage — capability check', () => {
  afterEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetServerEnvCache();
  });

  it('is unconfigured when BLOB_READ_WRITE_TOKEN is unset', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    resetServerEnvCache();
    expect(isChartAttachmentStorageConfigured()).toBe(false);
    expect(getChartAttachmentStorage()).toBeNull();
  });

  it('is unconfigured when BLOB_READ_WRITE_TOKEN is an empty string', () => {
    process.env.BLOB_READ_WRITE_TOKEN = '';
    resetServerEnvCache();
    expect(isChartAttachmentStorageConfigured()).toBe(false);
    expect(getChartAttachmentStorage()).toBeNull();
  });

  it('is configured once BLOB_READ_WRITE_TOKEN is set, and returns a real adapter shape', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token_placeholder';
    resetServerEnvCache();
    expect(isChartAttachmentStorageConfigured()).toBe(true);
    const storage = getChartAttachmentStorage();
    expect(storage).not.toBeNull();
    expect(typeof storage?.upload).toBe('function');
    expect(typeof storage?.delete).toBe('function');
  });
});
