#!/usr/bin/env node

/**
 * Phase 15H.2A local visual verification.
 *
 * This never runs with the application, migrations, tests, or deployment. It
 * only drives a loopback app that a developer has explicitly started, using
 * the dedicated development fixture identity created by visual-uat-data.mjs.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

if (
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL === "1" ||
  process.env.CI === "true"
) {
  throw new Error(
    "Visual UAT capture is forbidden in production, deployment, and CI environments.",
  );
}

const baseUrl = process.env.VISUAL_UAT_BASE_URL ?? "http://127.0.0.1:3000";
const parsedBaseUrl = new URL(baseUrl);
if (
  parsedBaseUrl.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsedBaseUrl.hostname.toLowerCase())
) {
  throw new Error("Visual UAT capture may only drive a loopback HTTP app.");
}
const outputDirectory = path.resolve("artifacts/phase-15h2a");
const dashboardScreenshot = path.join(
  outputDirectory,
  "1440-dashboard-populated-founder-uat.png",
);
const calendarScreenshot = path.join(
  outputDirectory,
  "1440-calendar-populated-founder-uat.png",
);
const browserCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function installedBrowser() {
  for (const candidate of browserCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next installed Chromium browser without downloading anything.
    }
  }
  throw new Error(
    "No installed Chromium browser is available for Visual UAT capture.",
  );
}

function requireText(body, expected) {
  if (!body.toLocaleLowerCase("en-US").includes(expected.toLocaleLowerCase("en-US")))
    throw new Error(`Dashboard is missing expected content: ${expected}`);
}

await fs.mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath: await installedBrowser(),
  headless: true,
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("/_next/webpack-hmr")
    ) {
      consoleErrors.push(message.text());
    }
  });

  const signIn = await page.request.post(`${baseUrl}/api/auth/sign-in/email`, {
    data: {
      email: "visual-uat@example.test",
      password: "visual-uat-password-123",
    },
  });
  if (!signIn.ok())
    throw new Error(`Visual UAT sign-in failed with HTTP ${signIn.status()}.`);

  const response = await page.goto(`${baseUrl}/en/app`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  if (response === null || !response.ok()) {
    throw new Error(
      `Dashboard navigation failed with HTTP ${response?.status() ?? "unknown"}.`,
    );
  }
  await page.getByRole("heading", { name: "Trading Calendar" }).waitFor();
  const body = await page.locator("body").innerText();
  for (const expected of [
    "Visual UAT Account",
    "Trader Performance",
    "System Performance",
    "Win Rate",
    "Execution Gap",
    "Trading Calendar",
    "Needs attention",
    "Recent Trades",
    "Execution Comparison",
  ]) {
    requireText(body, expected);
  }

  const calendarHeading = page.getByRole("heading", {
    name: "Trading Calendar",
  });
  const calendarCard = calendarHeading
    .locator("..")
    .locator("..")
    .locator("..");
  const selectedDay = page.locator('[data-calendar-day="2026-08-24"]');
  await page.goto(
    `${baseUrl}/en/app/trades?view=calendar&month=2026-08&date=2026-08-24`,
    { waitUntil: "networkidle", timeout: 60_000 },
  );
  if ((await selectedDay.getAttribute("aria-pressed")) !== "true") {
    throw new Error("Trade Log Calendar selected-day state did not activate.");
  }
  await page.goto(`${baseUrl}/en/app`, { waitUntil: "networkidle", timeout: 60_000 });
  await calendarHeading.waitFor();
  const today = page.locator('[data-calendar-day][aria-current="date"]');
  if ((await today.count()) !== 1)
    throw new Error("Calendar Today marker is missing or duplicated.");
  const todayDate = await today.getAttribute("data-calendar-day");

  const traderAxis = page.getByRole("radio", { name: "Trader" });
  const systemAxis = page.getByRole("radio", { name: "System" });
  const traderCalendarText = await calendarCard.innerText();
  await systemAxis.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  const systemCalendarText = await calendarCard.innerText();
  const systemAxisChecked = await systemAxis.isChecked();
  const calendarTextChanged = systemCalendarText !== traderCalendarText;
  if (!systemAxisChecked || !calendarTextChanged) {
    throw new Error(
      `Trader/System Calendar toggle failed: ${JSON.stringify({ systemAxisChecked, calendarTextChanged })}`,
    );
  }
  await traderAxis.focus();
  await page.keyboard.press("Space");

  const toneCounts = {
    positive: await page.locator('[data-calendar-tone="positive"]').count(),
    negative: await page.locator('[data-calendar-tone="negative"]').count(),
    empty: await page.locator('[data-calendar-tone="empty"]').count(),
  };
  if (Object.values(toneCounts).some((count) => count === 0)) {
    throw new Error(
      "Calendar does not contain the required positive, negative, and empty cells.",
    );
  }
  const overflow = await calendarCard.evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  if (overflow.horizontal)
    throw new Error("Calendar card has horizontal overflow at 1440px.");

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await calendarCard.screenshot({ path: calendarScreenshot });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({ path: dashboardScreenshot, fullPage: true });

  const analyticsResponse = await page.goto(`${baseUrl}/en/app/analytics?view=edge`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  if (analyticsResponse === null || !analyticsResponse.ok()) {
    throw new Error(
      `Analytics navigation failed with HTTP ${analyticsResponse?.status() ?? "unknown"}.`,
    );
  }
  const analyticsBody = await page.locator("body").innerText();
  requireText(analyticsBody, "Strategy Performance");
  requireText(analyticsBody, "Setup Performance");

  if (pageErrors.length !== 0 || consoleErrors.length !== 0) {
    throw new Error(
      `Browser errors detected: ${JSON.stringify({ pageErrors, consoleErrors }, null, 2)}`,
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        authenticated: true,
        viewportWidth: 1440,
        darkMode: true,
        toneCounts,
        today: todayDate,
        selectedDay: "2026-08-24",
        traderSystemToggle: true,
        overflow,
        analyticsLoaded: true,
        dashboardScreenshot,
        calendarScreenshot,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
}
