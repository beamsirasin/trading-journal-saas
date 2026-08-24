#!/usr/bin/env node

/**
 * Phase 15H.2A — explicit LOCAL-DEVELOPMENT visual fixture.
 *
 * This script deliberately uses the repository's direct-fixture convention:
 * every canonical input and persisted derived snapshot is inserted together
 * inside one transaction, with the same database constraints/triggers left
 * enabled. A dedicated fixture user/workspace is required because locked
 * Strategy history and Setup Checklist snapshots are intentionally immutable
 * except during whole-workspace deletion. That isolation makes rerun/cleanup
 * complete without ever deleting a developer's unrelated Trades.
 */
import crypto from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import Decimal from "decimal.js";
import postgres from "postgres";

export const VISUAL_UAT_ACKNOWLEDGEMENT =
  "I_UNDERSTAND_THIS_IS_LOCAL_VISUAL_UAT_DATA";
export const VISUAL_UAT_EMAIL = "visual-uat@example.test";
export const VISUAL_UAT_PASSWORD = "visual-uat-password-123";

const FIXTURE_MARKER = "[phase-15h2a-visual-uat]";
const FIXTURE_NAME = "Phase 15H.2A Visual UAT";
const VISUAL_ACCOUNT_NAME = "Visual UAT Account";
const WORKSPACE_SLUG = "phase-15h2a-visual-uat";

function fixtureUuid(label) {
  const hex = crypto
    .createHash("sha256")
    .update(`${FIXTURE_MARKER}:${label}`)
    .digest("hex");
  const chars = hex.slice(0, 32).split("");
  chars[12] = "7";
  chars[16] = "8";
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

const USER_ID = fixtureUuid("user");
const WORKSPACE_ID = fixtureUuid("workspace");
const TRADING_ACCOUNT_ID = fixtureUuid("trading-account");

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const acknowledgement = rest
    .find((value) => value.startsWith("--ack="))
    ?.slice("--ack=".length);
  if (mode !== "seed" && mode !== "clear" && mode !== "summary") {
    throw new Error(
      "Usage: visual-uat-data.mjs <seed|clear|summary> --ack=I_UNDERSTAND_THIS_IS_LOCAL_VISUAL_UAT_DATA",
    );
  }
  if (acknowledgement !== VISUAL_UAT_ACKNOWLEDGEMENT) {
    throw new Error(
      `Refusing visual fixture access. Pass --ack=${VISUAL_UAT_ACKNOWLEDGEMENT}.`,
    );
  }
  return { mode };
}

function parseDevelopmentDatabase(env) {
  if (
    env.NODE_ENV === "production" ||
    env.VERCEL === "1" ||
    env.CI === "true"
  ) {
    throw new Error(
      "Visual UAT data is forbidden in production, deployment, and CI environments.",
    );
  }
  const value = env.DATABASE_URL;
  if (value === undefined || value.trim() === "") {
    throw new Error(
      "DATABASE_URL is required. The visual fixture never falls back to another URL.",
    );
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://.");
  }
  const hostname = url.hostname.toLowerCase();
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (
    databaseName === "" ||
    /(?:^|[_-])(prod|production|test|e2e)(?:[_-]|$)/i.test(databaseName)
  ) {
    throw new Error(
      "Visual UAT data requires a named development database, never prod/test/e2e.",
    );
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    hostname,
  );
  const isExplicitDevelopmentDatabase =
    /(?:^|[_-])(dev|development|demo)(?:[_-]|$)/i.test(databaseName);
  if (!isLoopback && !isExplicitDevelopmentDatabase) {
    throw new Error(
      "Remote Visual UAT data requires a database name with an explicit dev/development/demo segment.",
    );
  }
  return { connectionUrl: value, hostname, databaseName };
}

function timestamp(day, hour, minute = 0) {
  return new Date(Date.UTC(2026, 7, day, hour, minute));
}

function outcomeFor(r) {
  const value = new Decimal(r);
  if (value.isNegative()) return "loss";
  if (value.isZero()) return "break_even";
  return "win";
}

function minorUnits(r) {
  return BigInt(new Decimal(r).times(10_000).toFixed(0));
}

const market = {
  XAUUSD: { entry: new Decimal("4330"), risk: new Decimal("10") },
  BTCUSD: { entry: new Decimal("64000"), risk: new Decimal("1000") },
  EURUSD: { entry: new Decimal("1.1000"), risk: new Decimal("0.0100") },
  NAS100: { entry: new Decimal("18000"), risk: new Decimal("100") },
  GBPUSD: { entry: new Decimal("1.2800"), risk: new Decimal("0.0100") },
};

function priceForR(symbol, direction, r) {
  const quote = market[symbol];
  const movement = quote.risk.times(new Decimal(r));
  return (
    direction === "long"
      ? quote.entry.plus(movement)
      : quote.entry.minus(movement)
  ).toFixed(10);
}

function stopPrice(symbol, direction) {
  const quote = market[symbol];
  return (
    direction === "long"
      ? quote.entry.minus(quote.risk)
      : quote.entry.plus(quote.risk)
  ).toFixed(10);
}

const strategiesFixture = [
  {
    key: "elliott-rsi",
    name: "Elliott Wave + RSI",
    setups: [
      ["wave-3", "Wave 3"],
      ["wave-5", "Wave 5"],
      ["wave-c", "Wave C"],
    ],
  },
  {
    key: "breakout",
    name: "Breakout Continuation",
    setups: [
      ["breakout-retest", "Breakout Retest"],
      ["momentum-break", "Momentum Break"],
    ],
  },
  {
    key: "mean-reversion",
    name: "Mean Reversion",
    setups: [["range-reversal", "Range Reversal"]],
  },
];

const dailyFixture = [
  { day: 3, actual: ["1.7000", "-0.5000"], system: ["2.5000", "-0.5000"] },
  { day: 4, actual: ["-0.4500"], system: ["1.5000"] },
  { day: 5, actual: ["0.4000", "0.4000"], system: ["0.4000", "0.4000"] },
  { day: 7, actual: ["1.8500", "-0.5000"], system: ["3.0000", "-0.5000"] },
  { day: 10, actual: ["0.5500"], system: ["-1.0000"] },
  { day: 11, actual: ["1.6000", "-0.5000"], system: ["2.5000", "-0.5000"] },
  { day: 13, actual: ["-1.0000"], system: ["-1.0000"], reviewPending: true },
  { day: 14, actual: ["0.7000"], system: ["1.5000"] },
  { day: 17, actual: ["-0.7500"], system: ["2.0000"], reviewPending: true },
  { day: 18, actual: ["0.7000", "0.7500"], system: ["0.9000", "0.9000"] },
  { day: 19, actual: ["0.6000"], system: ["0.6000"] },
  { day: 20, actual: ["2.3500", "-0.5000"], system: ["3.5000", "-0.5000"] },
  { day: 21, actual: ["0.3000"], system: [null], systemState: "no_trade" },
  { day: 24, actual: ["1.4500", "-0.5000"], system: ["2.5000", "-0.5000"] },
  { day: 25, actual: ["0.5000"], system: [null], systemState: "pending" },
  { day: 26, actual: ["-0.6500"], system: [null], systemState: "no_trade" },
  { day: 27, actual: ["0.5500", "0.6000"], system: ["1.2500", "1.2500"] },
  { day: 28, actual: ["-0.4000"], system: [null], systemState: "pending" },
];

function buildTradeDefinitions() {
  const symbols = ["XAUUSD", "EURUSD", "NAS100", "GBPUSD", "BTCUSD"];
  const plannedRs = [
    "1.5000",
    "2.0000",
    "2.5000",
    "3.0000",
    "4.0000",
    "5.0000",
  ];
  const closed = [];
  let index = 0;

  for (const dayFixture of dailyFixture) {
    for (let part = 0; part < dayFixture.actual.length; part += 1) {
      const isRecent = dayFixture.day >= 25;
      const symbol =
        dayFixture.day === 28
          ? "NAS100"
          : dayFixture.day === 27
            ? "XAUUSD"
            : dayFixture.day === 26
              ? "GBPUSD"
              : dayFixture.day === 25
                ? "EURUSD"
                : symbols[(index + dayFixture.day + part) % symbols.length];
      const direction = isRecent
        ? dayFixture.day === 28 || dayFixture.day === 26
          ? "short"
          : "long"
        : index % 5 < 3
          ? "long"
          : "short";
      const partial =
        (dayFixture.day === 3 && part === 0) ||
        (dayFixture.day === 20 && part === 0);
      closed.push({
        index,
        day: dayFixture.day,
        part,
        symbol,
        direction,
        actualR: dayFixture.actual[part],
        systemR: dayFixture.system[part],
        systemState: dayFixture.systemState ?? "resolved",
        reviewPending: dayFixture.reviewPending === true,
        planMode: index % 2 === 0 ? "price" : "money",
        actualMode: partial
          ? dayFixture.day === 3
            ? "price"
            : "money"
          : Math.floor(index / 2) % 2 === 0
            ? "price"
            : "money",
        plannedR: plannedRs[index % plannedRs.length],
        partial,
        status: "closed",
        unclassified: false,
        enteredAt: timestamp(dayFixture.day, 2 + part * 2),
        exitedAt: timestamp(dayFixture.day, 4 + part * 2),
      });
      index += 1;
    }
  }

  const open = [
    {
      index,
      day: 28,
      part: 1,
      symbol: "BTCUSD",
      direction: "short",
      actualR: null,
      systemR: "1.5000",
      systemState: "resolved",
      reviewPending: false,
      planMode: "price",
      actualMode: "price",
      plannedR: "3.0000",
      partial: false,
      status: "open",
      unclassified: true,
      enteredAt: timestamp(28, 10),
      exitedAt: null,
    },
    {
      index: index + 1,
      day: 28,
      part: 2,
      symbol: "XAUUSD",
      direction: "long",
      actualR: null,
      systemR: "2.0000",
      systemState: "resolved",
      reviewPending: false,
      planMode: "money",
      actualMode: "money",
      plannedR: "2.5000",
      partial: false,
      status: "open",
      unclassified: true,
      enteredAt: timestamp(28, 12),
      exitedAt: null,
    },
  ];

  return [...closed, ...open];
}

async function assertFixtureCanBeReplaced(tx) {
  const users = await tx`
    select id from users where email = ${VISUAL_UAT_EMAIL} for update
  `;
  if (users.length === 0) return;
  if (users.length !== 1 || users[0].id !== USER_ID) {
    throw new Error(
      `Refusing to replace a non-fixture user at ${VISUAL_UAT_EMAIL}.`,
    );
  }

  const [safety] = await tx`
    select
      count(*) filter (where w.id <> ${WORKSPACE_ID})::int as unexpected_workspaces,
      count(*) filter (where w.id = ${WORKSPACE_ID} and w.slug <> ${WORKSPACE_SLUG})::int as renamed_workspace
    from workspaces w where w.personal_owner_user_id = ${USER_ID}
  `;
  const [unexpected] = await tx`
    select
      (select count(*)::int from trading_accounts where workspace_id = ${WORKSPACE_ID} and id <> ${TRADING_ACCOUNT_ID}) as accounts,
      (select count(*)::int from workspace_members where workspace_id = ${WORKSPACE_ID} and user_id <> ${USER_ID}) as members,
      (select count(*)::int from strategy_versions where workspace_id = ${WORKSPACE_ID} and notes is distinct from ${FIXTURE_MARKER}) as strategies,
      (select count(*)::int from trades where workspace_id = ${WORKSPACE_ID} and (notes is null or notes not like ${`${FIXTURE_MARKER}%`})) as trades
  `;
  if (
    safety.unexpected_workspaces !== 0 ||
    safety.renamed_workspace !== 0 ||
    unexpected.accounts !== 0 ||
    unexpected.members !== 0 ||
    unexpected.strategies !== 0 ||
    unexpected.trades !== 0
  ) {
    throw new Error(
      "Refusing cleanup: the dedicated Visual UAT identity contains non-fixture workspace data.",
    );
  }
}

async function clearFixture(sql) {
  return sql.begin(async (tx) => {
    await assertFixtureCanBeReplaced(tx);
    const deleted = await tx`
      delete from users where id = ${USER_ID} and email = ${VISUAL_UAT_EMAIL}
      returning id
    `;
    return { cleared: deleted.length === 1 };
  });
}

async function createFramework(tx) {
  const framework = [];
  for (const definition of strategiesFixture) {
    const strategyId = fixtureUuid(`strategy:${definition.key}`);
    const strategyVersionId = fixtureUuid(
      `strategy-version:${definition.key}:1`,
    );
    await tx`
      insert into strategies (id, workspace_id, current_version_id, is_archived, mutation_key, created_at, updated_at)
      values (${strategyId}, ${WORKSPACE_ID}, null, false, ${fixtureUuid(`strategy-mutation:${definition.key}`)}, ${timestamp(1, 1)}, ${timestamp(1, 1)})
    `;
    await tx`
      insert into strategy_versions
        (id, workspace_id, strategy_id, version_number, name, description, notes, locked_at, created_at, updated_at)
      values
        (${strategyVersionId}, ${WORKSPACE_ID}, ${strategyId}, 1, ${definition.name},
         ${`Development-only ${definition.name} visual fixture`}, ${FIXTURE_MARKER}, null,
         ${timestamp(1, 1)}, ${timestamp(1, 1)})
    `;

    for (const [
      setupIndex,
      [setupKey, setupName],
    ] of definition.setups.entries()) {
      const setupId = fixtureUuid(`setup:${setupKey}`);
      const setupVersionId = fixtureUuid(`setup-version:${setupKey}:1`);
      await tx`
        insert into setups (id, workspace_id, strategy_id, is_archived, mutation_key, created_at, updated_at)
        values (${setupId}, ${WORKSPACE_ID}, ${strategyId}, false, ${fixtureUuid(`setup-mutation:${setupKey}`)}, ${timestamp(1, 1)}, ${timestamp(1, 1)})
      `;
      await tx`
        insert into strategy_setup_versions
          (id, workspace_id, strategy_id, strategy_version_id, setup_id, name, description, sort_order, created_at, updated_at)
        values
          (${setupVersionId}, ${WORKSPACE_ID}, ${strategyId}, ${strategyVersionId}, ${setupId},
           ${setupName}, ${`${FIXTURE_NAME}: ${setupName}`}, ${setupIndex}, ${timestamp(1, 1)}, ${timestamp(1, 1)})
      `;

      const conditionLabels = [
        `${setupName} structure is valid`,
        "Momentum and session context agree",
        "Risk and invalidation are defined",
      ];
      const conditions = [];
      for (const [conditionIndex, label] of conditionLabels.entries()) {
        const conditionId = fixtureUuid(
          `condition:${setupKey}:${conditionIndex}`,
        );
        const conditionKey = fixtureUuid(
          `condition-key:${setupKey}:${conditionIndex}`,
        );
        await tx`
          insert into setup_conditions
            (id, workspace_id, setup_id, setup_version_id, condition_key, label, sort_order, created_at, updated_at)
          values
            (${conditionId}, ${WORKSPACE_ID}, ${setupId}, ${setupVersionId}, ${conditionKey},
             ${label}, ${conditionIndex}, ${timestamp(1, 1)}, ${timestamp(1, 1)})
        `;
        conditions.push({
          id: conditionId,
          key: conditionKey,
          label,
          sortOrder: conditionIndex,
        });
      }
      framework.push({
        strategyId,
        strategyVersionId,
        strategyName: definition.name,
        setupId,
        setupVersionId,
        setupName,
        conditions,
      });
    }

    await tx`
      update strategies set current_version_id = ${strategyVersionId}, updated_at = ${timestamp(1, 2)}
      where id = ${strategyId}
    `;
    await tx`
      update strategy_versions set locked_at = ${timestamp(1, 2)}, updated_at = ${timestamp(1, 2)}
      where id = ${strategyVersionId}
    `;
  }
  return framework;
}

async function insertTrade(tx, definition, framework, emotionIds) {
  const tradeId = fixtureUuid(`trade:${definition.index}`);
  const mutationKey = fixtureUuid(`trade-mutation:${definition.index}`);
  const createdAt = new Date(definition.enteredAt.getTime() - 15 * 60 * 1000);
  const classified = definition.unclassified
    ? null
    : framework[definition.index % framework.length];
  const confidenceValues = [50, 75, 100];
  const confidence = definition.unclassified
    ? null
    : confidenceValues[definition.index % 3];
  const planned = market[definition.symbol];
  const plannedTarget = priceForR(
    definition.symbol,
    definition.direction,
    definition.plannedR,
  );
  const pricePlan = definition.planMode === "price";
  const moneyPlan = definition.planMode === "money";
  const priceActual = definition.actualMode === "price";
  const isClosed = definition.status === "closed";
  const actualR = definition.actualR;

  let exitLegRs = [];
  if (isClosed && actualR !== null) {
    exitLegRs = definition.partial
      ? definition.day === 3
        ? ["1.0000", new Decimal(actualR).times(2).minus(1).toFixed(4)]
        : ["1.0000", new Decimal(actualR).minus(1).toFixed(4)]
      : [actualR];
  }
  const exitBps = definition.partial ? [5000, 5000] : isClosed ? [10000] : [];
  const exitPrices = priceActual
    ? exitLegRs.map((r) =>
        priceForR(definition.symbol, definition.direction, r),
      )
    : [];
  const realizedMinor = priceActual
    ? []
    : definition.partial
      ? [minorUnits(exitLegRs[0]), minorUnits(exitLegRs[1])]
      : isClosed && actualR !== null
        ? [minorUnits(actualR)]
        : [];

  const systemResolvedAt = timestamp(definition.day, 8 + definition.part, 15);
  const systemExitedAt = timestamp(definition.day, 8 + definition.part);
  const resolvedSystem = definition.systemState === "resolved";
  const noTradeSystem = definition.systemState === "no_trade";
  const systemR = resolvedSystem ? definition.systemR : null;

  await tx`
    insert into trades (
      id, workspace_id, mutation_key, trading_account_id,
      strategy_id, strategy_version_id, setup_id, setup_version_id,
      strategy_assigned_at, setup_assigned_at,
      symbol, direction, timeframe, session, confirmation_notes, confidence,
      notes, review_notes, emotions_recorded_at,
      planned_entry, planned_stop, planned_target, planned_position_size,
      planned_risk_minor, planned_reward_minor,
      actual_result_mode, actual_entry, actual_initial_stop, actual_exit,
      actual_position_size, actual_initial_risk_minor, gross_pnl_minor,
      net_pnl_minor, entered_at, exited_at,
      system_status, system_resolution_kind, system_exit_price,
      system_gross_r_input, system_exited_at, system_exit_reason,
      system_cost_r, system_resolved_at,
      planned_r, actual_r, system_r, trader_outcome, system_outcome,
      status, followed_plan, created_at, updated_at
    ) values (
      ${tradeId}, ${WORKSPACE_ID}, ${mutationKey}, ${TRADING_ACCOUNT_ID},
      ${classified?.strategyId ?? null}, ${classified?.strategyVersionId ?? null},
      ${classified?.setupId ?? null}, ${classified?.setupVersionId ?? null},
      ${classified === null ? null : createdAt}, ${classified === null ? null : createdAt},
      ${definition.symbol}, ${definition.direction}, ${["15m", "1h", "4h"][definition.index % 3]},
      ${["Asia", "London", "New York"][definition.index % 3]},
      ${classified === null ? null : `Entry context for ${classified.setupName}`}, ${confidence},
      ${`${FIXTURE_MARKER} canonical visual Trade ${definition.index + 1}`},
      ${isClosed && definition.reviewPending ? null : isClosed ? `Reviewed: ${definition.actualR}R execution.` : null},
      ${classified === null ? null : definition.enteredAt},
      ${pricePlan ? planned.entry.toFixed(10) : null},
      ${pricePlan ? stopPrice(definition.symbol, definition.direction) : null},
      ${pricePlan ? plannedTarget : null}, ${pricePlan ? "1.0000000000" : null},
      ${moneyPlan ? 10_000n : null}, ${moneyPlan ? minorUnits(definition.plannedR) : null},
      ${definition.actualMode},
      ${priceActual ? planned.entry.toFixed(10) : null},
      ${priceActual ? stopPrice(definition.symbol, definition.direction) : null},
      ${isClosed && priceActual ? exitPrices.at(-1) : null},
      ${priceActual ? "1.0000000000" : null},
      ${priceActual ? null : 10_000n},
      ${isClosed && !priceActual && actualR !== null ? minorUnits(actualR) : null},
      ${isClosed && !priceActual && actualR !== null ? minorUnits(actualR) : null},
      ${definition.enteredAt}, ${definition.exitedAt},
      ${definition.systemState},
      ${resolvedSystem ? (pricePlan ? "price_exit" : "money_custom") : null},
      ${resolvedSystem && pricePlan && systemR !== null ? priceForR(definition.symbol, definition.direction, systemR) : null},
      ${resolvedSystem && moneyPlan ? systemR : null},
      ${resolvedSystem ? systemExitedAt : null},
      ${resolvedSystem ? "manual_system_valid_exit" : noTradeSystem ? "setup_invalidated" : null},
      ${"0.0000"}, ${resolvedSystem || noTradeSystem ? systemResolvedAt : null},
      ${definition.plannedR}, ${actualR}, ${systemR},
      ${actualR === null ? null : outcomeFor(actualR)},
      ${systemR === null ? null : outcomeFor(systemR)},
      ${definition.status},
      ${actualR === null ? null : new Decimal(actualR).greaterThanOrEqualTo(new Decimal(systemR ?? actualR))},
      ${createdAt}, ${definition.exitedAt ?? systemResolvedAt}
    )
  `;

  for (let legIndex = 0; legIndex < exitBps.length; legIndex += 1) {
    const exitedAt = new Date(
      definition.exitedAt.getTime() -
        (exitBps.length - legIndex - 1) * 30 * 60 * 1000,
    );
    await tx`
      insert into trade_exits
        (id, workspace_id, trade_id, mutation_key, sequence, closed_bps,
         exit_price, realized_pnl_minor, exit_reason, exited_at, created_at, updated_at)
      values
        (${fixtureUuid(`exit:${definition.index}:${legIndex}`)}, ${WORKSPACE_ID}, ${tradeId},
         ${fixtureUuid(`exit-mutation:${definition.index}:${legIndex}`)}, ${legIndex + 1}, ${exitBps[legIndex]},
         ${priceActual ? exitPrices[legIndex] : null}, ${priceActual ? null : realizedMinor[legIndex]},
         ${definition.partial ? "Scaled exit" : "Final exit"}, ${exitedAt}, ${exitedAt}, ${exitedAt})
    `;
  }

  if (classified !== null) {
    const missCount =
      definition.index % 7 === 0 ? 2 : definition.index % 4 === 0 ? 1 : 0;
    for (const [conditionIndex, condition] of classified.conditions.entries()) {
      await tx`
        insert into trade_setup_condition_checks
          (id, workspace_id, trade_id, setup_condition_id, setup_version_id,
           condition_key, label, sort_order, check_status, created_at, updated_at)
        values
          (${fixtureUuid(`condition-check:${definition.index}:${conditionIndex}`)}, ${WORKSPACE_ID},
           ${tradeId}, ${condition.id}, ${classified.setupVersionId}, ${condition.key},
           ${condition.label}, ${condition.sortOrder},
           ${conditionIndex >= classified.conditions.length - missCount ? "not_met" : "met"},
           ${definition.enteredAt}, ${definition.enteredAt})
      `;
    }

    const emotionKey =
      actualR === null
        ? "focused"
        : outcomeFor(actualR) === "loss"
          ? definition.index % 2 === 0
            ? "fearful"
            : "fomo"
          : definition.index % 2 === 0
            ? "calm"
            : "focused";
    const emotionTypeId = emotionIds.get(emotionKey);
    if (emotionTypeId === undefined)
      throw new Error(`Canonical Emotion ${emotionKey} is missing.`);
    await tx`
      insert into trade_emotions (trade_id, emotion_type_id, workspace_id, created_at)
      values (${tradeId}, ${emotionTypeId}, ${WORKSPACE_ID}, ${definition.enteredAt})
    `;
  }
}

async function seedFixture(sql) {
  const passwordHash = await hashPassword(VISUAL_UAT_PASSWORD);
  return sql.begin(async (tx) => {
    await assertFixtureCanBeReplaced(tx);
    await tx`delete from users where id = ${USER_ID} and email = ${VISUAL_UAT_EMAIL}`;

    await tx`
      insert into users (id, name, email, email_verified, created_at, updated_at)
      values (${USER_ID}, ${FIXTURE_NAME}, ${VISUAL_UAT_EMAIL}, true, ${timestamp(1, 0)}, ${timestamp(1, 0)})
    `;
    await tx`
      insert into accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
      values (${fixtureUuid("auth-account")}, ${USER_ID}, ${USER_ID}, 'credential', ${passwordHash}, ${timestamp(1, 0)}, ${timestamp(1, 0)})
    `;
    await tx`
      insert into workspaces
        (id, name, slug, kind, personal_owner_user_id, onboarding_completed_at, created_at, updated_at)
      values
        (${WORKSPACE_ID}, ${FIXTURE_NAME}, ${WORKSPACE_SLUG}, 'personal', ${USER_ID},
         ${timestamp(1, 0)}, ${timestamp(1, 0)}, ${timestamp(1, 0)})
    `;
    await tx`
      insert into workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at)
      values (${fixtureUuid("workspace-member")}, ${WORKSPACE_ID}, ${USER_ID}, 'owner', 'active', ${timestamp(1, 0)}, ${timestamp(1, 0)})
    `;
    await tx`
      insert into workspace_entitlements
        (id, workspace_id, status, plan_key, source, created_at, updated_at)
      values (${fixtureUuid("entitlement")}, ${WORKSPACE_ID}, 'active', 'professional', 'complimentary', ${timestamp(1, 0)}, ${timestamp(1, 0)})
    `;
    await tx`
      insert into trading_accounts
        (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone,
         is_archived, mutation_key, created_at, updated_at)
      values
        (${TRADING_ACCOUNT_ID}, ${WORKSPACE_ID}, ${VISUAL_ACCOUNT_NAME}, 'live', 'USD', '5000',
         'Asia/Bangkok', false, ${fixtureUuid("trading-account-mutation")}, ${timestamp(1, 0)}, ${timestamp(1, 0)})
    `;
    await tx`
      insert into user_preferences
        (user_id, active_workspace_id, active_trading_account_id, locale, theme, timezone, created_at, updated_at)
      values
        (${USER_ID}, ${WORKSPACE_ID}, ${TRADING_ACCOUNT_ID}, 'en', 'dark', 'Asia/Bangkok', ${timestamp(1, 0)}, ${timestamp(1, 0)})
    `;

    const emotionRows = await tx`
      select id, key from emotion_types where is_system and not is_archived
    `;
    const emotionIds = new Map(emotionRows.map((row) => [row.key, row.id]));
    const framework = await createFramework(tx);
    for (const definition of buildTradeDefinitions()) {
      await insertTrade(tx, definition, framework, emotionIds);
    }
    return { seeded: true };
  });
}

async function fixtureSummary(sql) {
  const [row] = await sql`
    select
      count(*)::int as trades,
      count(*) filter (where status = 'closed')::int as closed,
      count(*) filter (where status = 'open')::int as open,
      count(*) filter (where system_status = 'pending')::int as pending_system,
      count(*) filter (where system_status = 'no_trade')::int as no_trade_system,
      count(*) filter (where strategy_id is null)::int as unclassified,
      count(*) filter (where status = 'closed' and review_notes is null)::int as reviews_pending,
      count(*) filter (where planned_entry is not null)::int as price_plans,
      count(*) filter (where planned_risk_minor is not null)::int as money_plans,
      count(*) filter (where actual_result_mode = 'price')::int as price_actual,
      count(*) filter (where actual_result_mode = 'money')::int as money_actual,
      count(*) filter (where planned_entry is not null and actual_result_mode = 'price')::int as price_plan_price_actual,
      count(*) filter (where planned_entry is not null and actual_result_mode = 'money')::int as price_plan_money_actual,
      count(*) filter (where planned_risk_minor is not null and actual_result_mode = 'price')::int as money_plan_price_actual,
      count(*) filter (where planned_risk_minor is not null and actual_result_mode = 'money')::int as money_plan_money_actual,
      count(*) filter (where direction = 'long')::int as long_trades,
      count(*) filter (where direction = 'short')::int as short_trades,
      coalesce(sum(actual_r) filter (where status = 'closed'), 0)::text as trader_total_r,
      coalesce(sum(system_r) filter (where system_status = 'resolved'), 0)::text as system_total_r,
      round(
        100.0 * count(*) filter (where status = 'closed' and trader_outcome = 'win')
        / nullif(count(*) filter (where status = 'closed'), 0), 2
      )::text as win_rate_percent,
      round(avg(actual_r - system_r) filter (
        where status = 'closed' and system_status = 'resolved'
      ), 4)::text as execution_gap_r
    from trades
    where workspace_id = ${WORKSPACE_ID} and trading_account_id = ${TRADING_ACCOUNT_ID}
      and deleted_at is null and notes like ${`${FIXTURE_MARKER}%`}
  `;
  const strategies = await sql`
    select sv.name from strategy_versions sv where sv.workspace_id = ${WORKSPACE_ID}
    order by sv.name
  `;
  const setups = await sql`
    select ssv.name from strategy_setup_versions ssv where ssv.workspace_id = ${WORKSPACE_ID}
    order by ssv.name
  `;
  const symbols = await sql`
    select distinct symbol from trades where workspace_id = ${WORKSPACE_ID} order by symbol
  `;
  const [partial] = await sql`
    select count(*)::int as count from (
      select trade_id from trade_exits where workspace_id = ${WORKSPACE_ID}
      group by trade_id having count(*) > 1
    ) rows
  `;
  return {
    fixture: FIXTURE_NAME,
    loginEmail: VISUAL_UAT_EMAIL,
    account: VISUAL_ACCOUNT_NAME,
    ...row,
    strategies: strategies.map((item) => item.name),
    setups: setups.map((item) => item.name),
    symbols: symbols.map((item) => item.symbol),
    partialCloseTrades: partial.count,
  };
}

async function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  const guarded = parseDevelopmentDatabase(process.env);
  const sql = postgres(guarded.connectionUrl, { max: 1, prepare: false });
  try {
    if (mode === "clear") {
      const result = await clearFixture(sql);
      process.stdout.write(
        `${JSON.stringify({ ...result, database: guarded.databaseName, fixture: FIXTURE_NAME })}\n`,
      );
      return;
    }
    if (mode === "seed") await seedFixture(sql);
    const summary = await fixtureSummary(sql);
    process.stdout.write(
      `${JSON.stringify({ database: guarded.databaseName, ...summary }, null, 2)}\n`,
    );
  } finally {
    await sql.end();
  }
}

await main();
