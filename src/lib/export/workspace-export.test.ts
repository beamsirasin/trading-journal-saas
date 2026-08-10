import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  createWorkspaceExportCsvZip,
  createWorkspaceExportEnvelope,
  serializeWorkspaceExportCsvFiles,
  serializeWorkspaceExportJson,
  WORKSPACE_EXPORT_REGISTRY,
  WORKSPACE_EXPORT_SCHEMA_VERSION,
  type WorkspaceExportSource,
} from './workspace-export';

const EXPORTED_AT = new Date('2026-08-09T12:34:56.789Z');

function valueFor(kind: string, key: string): unknown {
  if (key === 'workspaceId') return 'workspace-a';
  switch (kind) {
    case 'id':
      return `${key}-id`;
    case 'user_text':
      return `ข้อความ ${key}`;
    case 'text':
      return `value-${key}`;
    case 'decimal':
      return key === 'actualR' ? '-1.0000' : '1.2345';
    case 'bigint':
      return 10000000000000001n;
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    case 'timestamp':
      return EXPORTED_AT;
    default:
      throw new Error(`unsupported test kind ${kind}`);
  }
}

function completeSource(): WorkspaceExportSource {
  return Object.fromEntries(
    WORKSPACE_EXPORT_REGISTRY.map((dataset) => [
      dataset.name,
      [
        Object.fromEntries(
          dataset.columns.map((definition) => [
            definition.key,
            valueFor(definition.kind, definition.key),
          ]),
        ),
      ],
    ]),
  ) as unknown as WorkspaceExportSource;
}

describe('workspace export schema-v1 registry', () => {
  it('defines the complete normalized dataset and CSV inventory once', () => {
    expect(WORKSPACE_EXPORT_SCHEMA_VERSION).toBe(1);
    expect(WORKSPACE_EXPORT_REGISTRY.map(({ name }) => name)).toEqual([
      'workspace',
      'trading_accounts',
      'strategies',
      'strategy_versions',
      'setups',
      'strategy_setup_versions',
      'strategy_rules',
      'mistake_types',
      'trades',
      'trade_rule_checks',
      'trade_mistakes',
      'billing_transactions',
    ]);
    expect(new Set(WORKSPACE_EXPORT_REGISTRY.map(({ csvFilename }) => csvFilename)).size).toBe(12);
  });

  it('has no security, provider, audit, mutation, or unused scoring columns', () => {
    const columns = WORKSPACE_EXPORT_REGISTRY.flatMap((dataset) =>
      dataset.columns.map((definition) => definition.key),
    );
    for (const denied of [
      'password',
      'accessToken',
      'refreshToken',
      'idToken',
      'sessionToken',
      'verificationValue',
      'providerKind',
      'providerCheckoutId',
      'providerPaymentId',
      'idempotencyKey',
      'mutationKey',
      'auditMetadata',
      'failureCode',
      'defaultWeight',
      'weightAtTime',
    ]) {
      expect(columns).not.toContain(denied);
    }
  });

  it('serializes exact values and ignores unregistered source fields', () => {
    const source = completeSource();
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: EXPORTED_AT,
      productVersion: '0.1.0',
      workspaceId: 'workspace-a',
      source: {
        ...source,
        workspace: [
          {
            ...source.workspace[0],
            password: 'PASSWORD_SENTINEL',
            providerPaymentId: 'PAYMENT_SENTINEL',
          },
        ],
      },
    });
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.exportedAt).toBe('2026-08-09T12:34:56.789Z');
    expect(envelope.scope).toEqual({ type: 'workspace', workspaceId: 'workspace-a' });
    expect(envelope.data.trades[0]?.actualInitialRiskMinor).toBe('10000000000000001');
    expect(envelope.data.trades[0]?.actualR).toBe('-1.0000');
    expect(envelope.data.trades[0]?.createdAt).toBe('2026-08-09T12:34:56.789Z');
    expect(serializeWorkspaceExportJson(envelope)).not.toMatch(
      /PASSWORD_SENTINEL|PAYMENT_SENTINEL/,
    );
  });

  it('is byte-deterministic for fixed metadata and ordered source data', () => {
    const input = {
      exportedAt: EXPORTED_AT,
      productVersion: '0.1.0',
      workspaceId: 'workspace-a',
      source: completeSource(),
    };
    const first = createWorkspaceExportEnvelope(input);
    const second = createWorkspaceExportEnvelope(input);
    expect(serializeWorkspaceExportJson(first)).toBe(serializeWorkspaceExportJson(second));
    expect(createWorkspaceExportCsvZip(first)).toEqual(createWorkspaceExportCsvZip(second));
  });
});

describe('workspace CSV security and parity', () => {
  it('neutralizes formula-like user text without corrupting numeric values', () => {
    const source = completeSource();
    const dangerous = ['=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', '\tpayload', '\rpayload'];
    const base = source.strategy_versions[0] ?? {};
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: EXPORTED_AT,
      productVersion: '0.1.0',
      workspaceId: 'workspace-a',
      source: {
        ...source,
        strategy_versions: dangerous.map((description, index) => ({
          ...base,
          id: `version-${index}`,
          versionNumber: index + 1,
          description,
        })),
      },
    });
    const files = serializeWorkspaceExportCsvFiles(envelope);
    const versions = files['strategy_versions.csv'] ?? '';
    for (const text of dangerous) expect(versions).toContain(`'${text}`);
    expect(files['trades.csv']).toContain('-1.0000');
    expect(files['trades.csv']).not.toContain("'-1.0000");
  });

  it('preserves Thai, commas, quotes and newlines with RFC-style quoting', () => {
    const source = completeSource();
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: EXPORTED_AT,
      productVersion: '0.1.0',
      workspaceId: 'workspace-a',
      source: {
        ...source,
        workspace: [{ ...source.workspace[0], name: 'ไทย, "quoted"\nบรรทัดใหม่' }],
      },
    });
    expect(serializeWorkspaceExportCsvFiles(envelope)['workspace.csv']).toContain(
      '"ไทย, ""quoted""\nบรรทัดใหม่"',
    );
  });

  it('derives every ZIP CSV from the same envelope and includes a schema manifest', () => {
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: EXPORTED_AT,
      productVersion: '0.1.0',
      workspaceId: 'workspace-a',
      source: completeSource(),
    });
    const csvFiles = serializeWorkspaceExportCsvFiles(envelope);
    const archive = unzipSync(createWorkspaceExportCsvZip(envelope));
    expect(Object.keys(archive).sort()).toEqual(
      ['manifest.json', ...WORKSPACE_EXPORT_REGISTRY.map(({ csvFilename }) => csvFilename)].sort(),
    );
    for (const [filename, contents] of Object.entries(csvFiles)) {
      const archived = archive[filename] as Uint8Array;
      expect([...archived.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(strFromU8(archived)).toBe(contents.slice(1));
    }
    expect(JSON.parse(strFromU8(archive['manifest.json'] as Uint8Array))).toMatchObject({
      schemaVersion: 1,
      productVersion: '0.1.0',
      nullRepresentation: 'empty CSV field',
    });
  });
});

describe('workspace export 5,000-Trade generation target', () => {
  it('generates bounded JSON and ZIP artifacts without row-dependent queries or jobs', () => {
    const source = completeSource();
    const baseTrade = source.trades[0] ?? {};
    const trades = Array.from({ length: 5_000 }, (_, index) => ({
      ...baseTrade,
      id: `trade-${String(index).padStart(5, '0')}`,
      symbol: index % 2 === 0 ? 'ทองคำ' : 'EUR/USD',
      notes: `Export benchmark trade ${index}`,
    }));
    const startedAt = performance.now();
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: EXPORTED_AT,
      productVersion: '0.1.0',
      workspaceId: 'workspace-a',
      source: { ...source, trades },
    });
    const json = serializeWorkspaceExportJson(envelope);
    const zip = createWorkspaceExportCsvZip(envelope);
    const runtimeMs = performance.now() - startedAt;

    expect(envelope.data.trades).toHaveLength(5_000);
    expect(json.length).toBeLessThan(25 * 1024 * 1024);
    expect(zip.byteLength).toBeLessThan(25 * 1024 * 1024);
    expect(strFromU8(unzipSync(zip)['trades.csv'] as Uint8Array).split('\n')).toHaveLength(5_002);
    expect(runtimeMs).toBeLessThan(10_000);

    console.info(
      `workspace-export-5000 runtime_ms=${runtimeMs.toFixed(1)} json_bytes=${Buffer.byteLength(json)} zip_bytes=${zip.byteLength}`,
    );
  });
});
