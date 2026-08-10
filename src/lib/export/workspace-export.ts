import { strToU8, zipSync } from 'fflate';

export const WORKSPACE_EXPORT_SCHEMA_VERSION = 1 as const;
export type WorkspaceExportSchemaVersion = typeof WORKSPACE_EXPORT_SCHEMA_VERSION;
export type WorkspaceExportFormat = 'json' | 'csv';

export type ExportValue = string | number | boolean | null;
export type ExportRecord = Readonly<Record<string, ExportValue>>;
export type WorkspaceExportDatasetName =
  | 'workspace'
  | 'trading_accounts'
  | 'strategies'
  | 'strategy_versions'
  | 'setups'
  | 'strategy_setup_versions'
  | 'strategy_rules'
  | 'mistake_types'
  | 'trades'
  | 'trade_rule_checks'
  | 'trade_mistakes'
  | 'billing_transactions';

type ColumnKind =
  'id' | 'user_text' | 'text' | 'decimal' | 'bigint' | 'integer' | 'boolean' | 'timestamp';

export interface ExportColumn {
  readonly key: string;
  readonly csvHeader: string;
  readonly kind: ColumnKind;
}

export interface ExportDatasetDefinition {
  readonly name: WorkspaceExportDatasetName;
  readonly csvFilename: `${string}.csv`;
  readonly columns: readonly ExportColumn[];
}

const column = (key: string, csvHeader: string, kind: ColumnKind): ExportColumn => ({
  key,
  csvHeader,
  kind,
});

/**
 * Security boundary for schema v1. The DAL may select only safe fields, but
 * this registry is the final allowlist used by BOTH JSON and CSV. A future
 * database column cannot enter either format without an explicit review here.
 */
export const WORKSPACE_EXPORT_REGISTRY = [
  {
    name: 'workspace',
    csvFilename: 'workspace.csv',
    columns: [
      column('id', 'id', 'id'),
      column('name', 'name', 'user_text'),
      column('kind', 'kind', 'text'),
      column('onboardingCompletedAt', 'onboarding_completed_at', 'timestamp'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'trading_accounts',
    csvFilename: 'trading_accounts.csv',
    columns: [
      column('id', 'id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('name', 'name', 'user_text'),
      column('brokerName', 'broker_name', 'user_text'),
      column('platformName', 'platform_name', 'user_text'),
      column('accountMode', 'account_mode', 'text'),
      column('baseCurrency', 'base_currency', 'text'),
      column('startingBalance', 'starting_balance', 'decimal'),
      column('timezone', 'timezone', 'text'),
      column('riskPerTradePercent', 'risk_per_trade_percent', 'decimal'),
      column('maximumDailyLossPercent', 'maximum_daily_loss_percent', 'decimal'),
      column('isArchived', 'is_archived', 'boolean'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'strategies',
    csvFilename: 'strategies.csv',
    columns: [
      column('id', 'id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('currentVersionId', 'current_version_id', 'id'),
      column('isArchived', 'is_archived', 'boolean'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'strategy_versions',
    csvFilename: 'strategy_versions.csv',
    columns: [
      column('id', 'id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('strategyId', 'strategy_id', 'id'),
      column('versionNumber', 'version_number', 'integer'),
      column('name', 'name', 'user_text'),
      column('description', 'description', 'user_text'),
      column('notes', 'notes', 'user_text'),
      column('changeNote', 'change_note', 'user_text'),
      column('lockedAt', 'locked_at', 'timestamp'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'setups',
    csvFilename: 'setups.csv',
    columns: [
      column('id', 'id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('strategyId', 'strategy_id', 'id'),
      column('isArchived', 'is_archived', 'boolean'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'strategy_setup_versions',
    csvFilename: 'strategy_setup_versions.csv',
    columns: [
      column('id', 'id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('strategyId', 'strategy_id', 'id'),
      column('strategyVersionId', 'strategy_version_id', 'id'),
      column('setupId', 'setup_id', 'id'),
      column('name', 'name', 'user_text'),
      column('description', 'description', 'user_text'),
      column('sortOrder', 'sort_order', 'integer'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'strategy_rules',
    csvFilename: 'strategy_rules.csv',
    columns: [
      column('id', 'id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('strategyVersionId', 'strategy_version_id', 'id'),
      column('setupVersionId', 'setup_version_id', 'id'),
      column('ruleKey', 'rule_key', 'id'),
      column('category', 'category', 'text'),
      column('title', 'title', 'user_text'),
      column('description', 'description', 'user_text'),
      column('isRequired', 'is_required', 'boolean'),
      column('isPreTradeCheck', 'is_pre_trade_check', 'boolean'),
      column('sortOrder', 'sort_order', 'integer'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'mistake_types',
    csvFilename: 'mistake_types.csv',
    columns: [
      column('id', 'id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('key', 'key', 'text'),
      column('label', 'label', 'user_text'),
      column('severity', 'severity', 'text'),
      column('isSystem', 'is_system', 'boolean'),
      column('isArchived', 'is_archived', 'boolean'),
      column('sortOrder', 'sort_order', 'integer'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'trades',
    csvFilename: 'trades.csv',
    columns: [
      column('id', 'id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('tradingAccountId', 'trading_account_id', 'id'),
      column('strategyId', 'strategy_id', 'id'),
      column('strategyVersionId', 'strategy_version_id', 'id'),
      column('setupId', 'setup_id', 'id'),
      column('setupVersionId', 'setup_version_id', 'id'),
      column('symbol', 'symbol', 'user_text'),
      column('direction', 'direction', 'text'),
      column('timeframe', 'timeframe', 'user_text'),
      column('session', 'session', 'user_text'),
      column('confirmationNotes', 'confirmation_notes', 'user_text'),
      column('confidence', 'confidence', 'integer'),
      column('tradingviewUrl', 'tradingview_url', 'user_text'),
      column('notes', 'notes', 'user_text'),
      column('plannedEntry', 'planned_entry', 'decimal'),
      column('plannedStop', 'planned_stop', 'decimal'),
      column('plannedTarget', 'planned_target', 'decimal'),
      column('plannedPositionSize', 'planned_position_size', 'decimal'),
      column('actualEntry', 'actual_entry', 'decimal'),
      column('actualInitialStop', 'actual_initial_stop', 'decimal'),
      column('actualExit', 'actual_exit', 'decimal'),
      column('actualPositionSize', 'actual_position_size', 'decimal'),
      column('actualInitialRiskMinor', 'actual_initial_risk_minor', 'bigint'),
      column('grossPnlMinor', 'gross_pnl_minor', 'bigint'),
      column('commissionMinor', 'commission_minor', 'bigint'),
      column('feesMinor', 'fees_minor', 'bigint'),
      column('swapMinor', 'swap_minor', 'bigint'),
      column('netPnlMinor', 'net_pnl_minor', 'bigint'),
      column('enteredAt', 'entered_at', 'timestamp'),
      column('exitedAt', 'exited_at', 'timestamp'),
      column('systemStatus', 'system_status', 'text'),
      column('systemExitPrice', 'system_exit_price', 'decimal'),
      column('systemExitedAt', 'system_exited_at', 'timestamp'),
      column('systemExitReason', 'system_exit_reason', 'text'),
      column('systemCostR', 'system_cost_r', 'decimal'),
      column('systemResolvedAt', 'system_resolved_at', 'timestamp'),
      column('plannedR', 'planned_r', 'decimal'),
      column('actualR', 'actual_r', 'decimal'),
      column('systemR', 'system_r', 'decimal'),
      column('traderOutcome', 'trader_outcome', 'text'),
      column('systemOutcome', 'system_outcome', 'text'),
      column('calcVersion', 'calc_version', 'integer'),
      column('status', 'status', 'text'),
      column('followedPlan', 'followed_plan', 'boolean'),
      column('deletedAt', 'deleted_at', 'timestamp'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'trade_rule_checks',
    csvFilename: 'trade_rule_checks.csv',
    columns: [
      column('id', 'id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('tradeId', 'trade_id', 'id'),
      column('strategyRuleId', 'strategy_rule_id', 'id'),
      column('strategyVersionId', 'strategy_version_id', 'id'),
      column('ruleKey', 'rule_key', 'id'),
      column('checkStatus', 'check_status', 'text'),
      column('title', 'title', 'user_text'),
      column('category', 'category', 'text'),
      column('isRequired', 'is_required', 'boolean'),
      column('isPreTradeCheck', 'is_pre_trade_check', 'boolean'),
      column('sortOrder', 'sort_order', 'integer'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'trade_mistakes',
    csvFilename: 'trade_mistakes.csv',
    columns: [
      column('tradeId', 'trade_id', 'id'),
      column('mistakeTypeId', 'mistake_type_id', 'id'),
      column('workspaceId', 'workspace_id', 'id'),
      column('note', 'note', 'user_text'),
      column('severityAtTime', 'severity_at_time', 'text'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
    ],
  },
  {
    name: 'billing_transactions',
    csvFilename: 'billing_transactions.csv',
    columns: [
      column('workspaceId', 'workspace_id', 'id'),
      column('planKey', 'plan_key', 'text'),
      column('billingCurrency', 'billing_currency', 'text'),
      column('billingInterval', 'billing_interval', 'text'),
      column('subtotalMinor', 'subtotal_minor', 'bigint'),
      column('vatEnabled', 'vat_enabled', 'boolean'),
      column('appliedVatRateBasisPoints', 'applied_vat_rate_basis_points', 'integer'),
      column('vatAmountMinor', 'vat_amount_minor', 'bigint'),
      column('totalMinor', 'total_minor', 'bigint'),
      column('status', 'status', 'text'),
      column('createdAt', 'created_at', 'timestamp'),
      column('updatedAt', 'updated_at', 'timestamp'),
      column('completedAt', 'completed_at', 'timestamp'),
      column('failedAt', 'failed_at', 'timestamp'),
    ],
  },
] as const satisfies readonly ExportDatasetDefinition[];

export type WorkspaceExportSource = Readonly<
  Record<WorkspaceExportDatasetName, readonly Readonly<Record<string, unknown>>[]>
>;
export type WorkspaceExportData = Readonly<
  Record<WorkspaceExportDatasetName, readonly ExportRecord[]>
>;

export interface WorkspaceExportEnvelope {
  readonly schemaVersion: WorkspaceExportSchemaVersion;
  readonly exportedAt: string;
  readonly productVersion: string;
  readonly scope: { readonly type: 'workspace'; readonly workspaceId: string };
  readonly data: WorkspaceExportData;
}

function serializeValue(value: unknown, kind: ColumnKind): ExportValue {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'id':
    case 'user_text':
    case 'text':
    case 'decimal':
      if (typeof value !== 'string') throw new TypeError(`Expected ${kind} string`);
      return value;
    case 'bigint':
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
      throw new TypeError('Expected exact bigint value');
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new TypeError('Expected safe integer value');
      }
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw new TypeError('Expected boolean value');
      return value;
    case 'timestamp': {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) throw new TypeError('Expected valid timestamp');
      return date.toISOString();
    }
  }
}

export function createWorkspaceExportEnvelope(input: {
  readonly exportedAt: Date;
  readonly productVersion: string;
  readonly workspaceId: string;
  readonly source: WorkspaceExportSource;
}): WorkspaceExportEnvelope {
  const data = Object.fromEntries(
    WORKSPACE_EXPORT_REGISTRY.map((dataset) => [
      dataset.name,
      input.source[dataset.name].map((row) =>
        Object.fromEntries(
          dataset.columns.map((definition) => [
            definition.key,
            serializeValue(row[definition.key], definition.kind),
          ]),
        ),
      ),
    ]),
  ) as unknown as WorkspaceExportData;

  return {
    schemaVersion: WORKSPACE_EXPORT_SCHEMA_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    productVersion: input.productVersion,
    scope: { type: 'workspace', workspaceId: input.workspaceId },
    data,
  };
}

export function serializeWorkspaceExportJson(envelope: WorkspaceExportEnvelope): string {
  return JSON.stringify(envelope);
}

function protectSpreadsheetText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: ExportValue, kind: ColumnKind): string {
  if (value === null) return '';
  const raw = kind === 'user_text' ? protectSpreadsheetText(String(value)) : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function serializeWorkspaceExportCsvFiles(
  envelope: WorkspaceExportEnvelope,
): Readonly<Record<string, string>> {
  const entries: [string, string][] = WORKSPACE_EXPORT_REGISTRY.map((dataset) => {
    const header = dataset.columns.map((definition) => definition.csvHeader).join(',');
    const rows = envelope.data[dataset.name].map((row) =>
      dataset.columns
        .map((definition) => csvCell(row[definition.key] ?? null, definition.kind))
        .join(','),
    );
    return [dataset.csvFilename, `\uFEFF${[header, ...rows].join('\n')}\n`];
  });
  return Object.fromEntries(entries);
}

const ZIP_TIMESTAMP = new Date('1980-01-01T00:00:00.000Z');

export function createWorkspaceExportCsvZip(envelope: WorkspaceExportEnvelope): Uint8Array {
  const csvFiles = serializeWorkspaceExportCsvFiles(envelope);
  const manifest = JSON.stringify({
    schemaVersion: envelope.schemaVersion,
    exportedAt: envelope.exportedAt,
    productVersion: envelope.productVersion,
    scope: envelope.scope,
    nullRepresentation: 'empty CSV field',
    datasets: WORKSPACE_EXPORT_REGISTRY.map((dataset) => ({
      name: dataset.name,
      filename: dataset.csvFilename,
    })),
  });
  return zipSync(
    {
      'manifest.json': [strToU8(manifest), { mtime: ZIP_TIMESTAMP }],
      ...Object.fromEntries(
        Object.entries(csvFiles).map(([filename, contents]) => [
          filename,
          [strToU8(contents), { mtime: ZIP_TIMESTAMP }],
        ]),
      ),
    },
    { level: 6, mtime: ZIP_TIMESTAMP },
  );
}
