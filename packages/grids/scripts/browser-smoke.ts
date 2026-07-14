#!/usr/bin/env bun
/**
 * Grids browser regression smoke.
 *
 * This intentionally stays small: fixtures are created through the API,
 * then a real browser checks the routes and interactions most likely to
 * regress during v1 polish. Avoid golden screenshots and fragile full-app
 * snapshots; assert visible user-facing behaviour.
 */
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin";
const SESSION_TOKEN = process.env.SESSION_TOKEN;
const HEADLESS = process.env.HEADLESS !== "0";
const KEEP = process.env.KEEP === "1";
const TIMEOUT = Number(process.env.BROWSER_SMOKE_TIMEOUT_MS ?? 20_000);

type ApiError = Error & { status?: number; body?: string };

type Fixture = {
  sessionToken: string;
  base: { id: string; shortId: string };
  table: { id: string; shortId: string };
  view: { id: string; shortId: string };
  chartView: { id: string; shortId: string };
  form: { id: string; publicToken: string };
  dashboard: { id: string; shortId: string };
  records: {
    first: string;
  };
  fields: {
    title: string;
    amount: string;
    status: string;
    notes: string;
    due: string;
  };
};

const log = (message: string) => console.log(message);
const ok = (message: string) => log(`✓ ${message}`);

const fail = (message: string): never => {
  throw new Error(message);
};

const api = async <T>(
  method: string,
  path: string,
  body?: unknown,
  sessionToken?: string,
  expected = method === "DELETE" ? 204 : 200,
): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status !== expected) {
    const err = new Error(`${method} ${path} expected ${expected}, got ${res.status}`) as ApiError;
    err.status = res.status;
    err.body = text.slice(0, 800);
    throw err;
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
};

const login = async (): Promise<string> => {
  if (SESSION_TOKEN) {
    ok("session-token supplied");
    return SESSION_TOKEN;
  }
  const result = await api<{ session_token: string }>("POST", "/api/auth/admin-login", { token: ADMIN_TOKEN }, undefined, 200);
  if (!result.session_token) fail("admin-login returned no session token");
  ok("admin-login");
  return result.session_token;
};

const createFixture = async (): Promise<Fixture> => {
  const sessionToken = await login();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;

  const base = await api<{ id: string; shortId: string }>(
    "POST",
    "/api/grids/bases",
    { name: `browser-smoke-${suffix}`, description: "Browser regression smoke fixture" },
    sessionToken,
    201,
  );
  const table = await api<{ id: string; shortId: string }>(
    "POST",
    `/api/grids/tables/by-base/${base.id}`,
    { name: "Tasks", icon: "ti ti-checklist" },
    sessionToken,
    201,
  );

  const title = await api<{ id: string }>(
    "POST",
    `/api/grids/fields/by-table/${table.id}`,
    { name: "Title", type: "text", required: true },
    sessionToken,
    201,
  );
  const amount = await api<{ id: string }>(
    "POST",
    `/api/grids/fields/by-table/${table.id}`,
    {
      name: "Amount",
      type: "number",
      config: { precision: 16, decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" },
    },
    sessionToken,
    201,
  );
  const status = await api<{ id: string }>(
    "POST",
    `/api/grids/fields/by-table/${table.id}`,
    {
      name: "Status",
      type: "select",
      config: {
        options: [
          { id: "open", label: "Open", color: "#3b82f6", description: "Needs work" },
          { id: "done", label: "Done", color: "#10b981", description: "Finished" },
        ],
      },
    },
    sessionToken,
    201,
  );
  const notes = await api<{ id: string }>(
    "POST",
    `/api/grids/fields/by-table/${table.id}`,
    { name: "Notes", type: "longtext", config: { markdown: true } },
    sessionToken,
    201,
  );
  const due = await api<{ id: string }>(
    "POST",
    `/api/grids/fields/by-table/${table.id}`,
    { name: "Due", type: "date", config: { defaultMode: "now" } },
    sessionToken,
    201,
  );

  const firstRecord = await api<{ id: string }>(
    "POST",
    `/api/grids/records/by-table/${table.id}`,
    {
      [title.id]: "Review invoices",
      [amount.id]: "99.99",
      [status.id]: ["open"],
      [notes.id]: "## Checklist\n\n- verify amount\n- send update",
      [due.id]: "2026-05-26",
    },
    sessionToken,
    201,
  );
  await api(
    "POST",
    `/api/grids/records/by-table/${table.id}`,
    {
      [title.id]: "Close month",
      [amount.id]: "150.00",
      [status.id]: ["done"],
      [notes.id]: "Done in accounting.",
      [due.id]: "2026-05-27",
    },
    sessionToken,
    201,
  );

  const view = await api<{ id: string; shortId: string }>(
    "POST",
    `/api/grids/views/by-table/${table.id}`,
    {
      name: "Open task amounts",
      shared: true,
      source: `from table {${table.id}}\nselect {${title.id}}, {${status.id}}, {${amount.id}}\nsort {${title.id}} asc`,
      ui: {
        columns: [
          { fieldId: title.id },
          { fieldId: status.id },
          { fieldId: amount.id, format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
        ],
      },
    },
    sessionToken,
    201,
  );
  const chartView = await api<{ id: string; shortId: string }>(
    "POST",
    `/api/grids/views/by-table/${table.id}`,
    {
      name: "Amount by status",
      shared: true,
      source: `from table {${table.id}}\ngroup by {${status.id}}\naggregate sum({${amount.id}}) as total_amount`,
    },
    sessionToken,
    201,
  );
  const statView = await api<{ id: string; shortId: string }>(
    "POST",
    `/api/grids/views/by-table/${table.id}`,
    {
      name: "Total amount",
      shared: true,
      source: `from table {${table.id}}\naggregate sum({${amount.id}}) as total_amount`,
    },
    sessionToken,
    201,
  );

  const form = await api<{ id: string; publicToken: string | null }>(
    "POST",
    `/api/grids/forms/by-table/${table.id}`,
    {
      name: "Task intake",
      isPublic: true,
      config: {
        title: "Task intake",
        description: "Browser smoke public form",
        submitLabel: "Send task",
        successMessage: "Task saved",
        fields: [
          { kind: "user_input", fieldId: title.id, label: "Task title", required: true },
          { kind: "user_input", fieldId: amount.id, label: "Budget", defaultValue: "12.50" },
          { kind: "form_value", fieldId: status.id, value: ["open"] },
        ],
      },
    },
    sessionToken,
    201,
  );
  if (!form.publicToken) fail("public form was created without a public token");

  const dashboard = await api<{ id: string; shortId: string }>(
    "POST",
    `/api/grids/dashboards/by-base/${base.id}`,
    {
      name: "Operations dashboard",
      description: "Browser smoke dashboard",
      shared: true,
      icon: "ti ti-layout-dashboard",
      config: {
        rows: [
          {
            id: "row-stats",
            kind: "row",
            height: "sm",
            cells: [
              {
                id: "stat-total",
                kind: "stat",
                span: 6,
                title: "Total amount",
                format: "currency",
                tone: "blue",
                viewId: statView.id,
              },
              {
                id: "link-table",
                kind: "link",
                span: 6,
                title: "Open tasks table",
                description: "Jump to the task table.",
                target: { kind: "table", tableId: table.id },
              },
            ],
          },
          {
            id: "row-content",
            kind: "row",
            height: "md",
            cells: [
              {
                id: "md-help",
                kind: "markdown",
                span: 6,
                title: "Dashboard notes",
                markdown: "Use this dashboard to review **open tasks**.",
              },
              {
                id: "view-open",
                kind: "view",
                span: 6,
                title: "Open task amounts",
                viewId: view.id,
              },
            ],
          },
          {
            id: "row-chart",
            kind: "row",
            height: "md",
            cells: [
              {
                id: "view-stats-open",
                kind: "view-stats",
                span: 6,
                title: "Status summary",
                viewId: chartView.id,
              },
              {
                id: "chart-status",
                kind: "chart",
                span: 6,
                title: "Amount by status",
                chartType: "bar",
                viewId: chartView.id,
                format: "currency",
              },
            ],
          },
          {
            id: "row-form",
            kind: "row",
            height: "md",
            cells: [{ id: "form-intake", kind: "form", span: 12, title: "Task intake", formId: form.id }],
          },
        ],
      },
    },
    sessionToken,
    201,
  );

  ok("fixture created");
  return {
    sessionToken,
    base,
    table,
    view,
    chartView,
    form: { id: form.id, publicToken: form.publicToken },
    dashboard,
    records: { first: firstRecord.id },
    fields: { title: title.id, amount: amount.id, status: status.id, notes: notes.id, due: due.id },
  };
};

const addSessionCookie = async (context: BrowserContext, sessionToken: string) => {
  const url = new URL(BASE_URL);
  await context.addCookies([
    {
      name: "session_token",
      value: sessionToken,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: url.protocol === "https:",
    },
  ]);
};

const watchPage = (page: Page, errors: string[]) => {
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource:")) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && /\.js(\?|$)/.test(url)) {
      errors.push(`asset ${status}: ${url}`);
      return;
    }
    if (status >= 500 && !url.includes("/favicon")) {
      errors.push(`http ${status}: ${url}`);
    }
  });
};

const expectVisibleText = async (page: Page, text: string, label = text) => {
  await page.waitForFunction(
    (needle) =>
      !!document.body &&
      Array.from(document.body.querySelectorAll("*")).some((el) => {
        if (!el.textContent?.includes(needle)) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        return el.getClientRects().length > 0;
      }),
    text,
    { timeout: TIMEOUT },
  );
  ok(label);
};

const expectFocusedLabel = async (page: Page, label: string) => {
  await page
    .waitForFunction((expected) => document.activeElement?.getAttribute("aria-label") === expected, label, { timeout: TIMEOUT })
    .catch(async () => {
      const state = await page.evaluate(() => ({
        active: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? null,
        controls: Array.from(document.querySelectorAll<HTMLElement>("[data-dashboard-control]"))
          .filter((element) => element.getAttribute("aria-label")?.includes("Total amount"))
          .map((element) => ({
            label: element.getAttribute("aria-label"),
            disabled: element instanceof HTMLButtonElement && element.disabled,
          })),
      }));
      fail(`expected focus on ${label}: ${JSON.stringify(state)}`);
    });
};

const expectVisibleTextPattern = async (page: Page, pattern: RegExp, label: string) => {
  await page.waitForFunction(
    (source) => {
      if (!document.body) return false;
      const regex = new RegExp(source);
      return Array.from(document.body.querySelectorAll("*")).some((el) => {
        if (!regex.test(el.textContent ?? "")) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        return el.getClientRects().length > 0;
      });
    },
    pattern.source,
    { timeout: TIMEOUT },
  );
  ok(label);
};

const expectNoVisibleTextPattern = async (page: Page, pattern: RegExp, label: string) => {
  await page.waitForFunction(
    (source) => {
      if (!document.body) return false;
      const regex = new RegExp(source);
      return !Array.from(document.body.querySelectorAll("*")).some((el) => {
        if (!regex.test(el.textContent ?? "")) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        return el.getClientRects().length > 0;
      });
    },
    pattern.source,
    { timeout: TIMEOUT },
  );
  ok(label);
};

const assertNoBrowserErrors = (errors: string[]) => {
  if (errors.length > 0) {
    fail(`browser errors:\n${errors.slice(0, 8).join("\n")}`);
  }
};

const browserMutation = async <T>(page: Page, config: { method: string; path: string; body?: unknown; expected?: number }): Promise<T> => {
  const response = await page.context().request.fetch(config.path, {
    method: config.method,
    headers: config.body === undefined ? undefined : { "Content-Type": "application/json" },
    data: config.body === undefined ? undefined : JSON.stringify(config.body),
  });
  const text = await response.text();
  const expected = config.expected ?? (config.method === "DELETE" ? 204 : 200);
  if (response.status() !== expected) fail(`${config.method} ${config.path} failed with ${response.status()}: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
};

const expectNoVisibleText = async (page: Page, text: string, label = text) => {
  await page.waitForFunction(
    (needle) =>
      !!document.body &&
      !Array.from(document.body.querySelectorAll("*")).some((el) => {
        if (!el.textContent?.includes(needle)) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        return el.getClientRects().length > 0;
      }),
    text,
    { timeout: TIMEOUT },
  );
  ok(label);
};

const runLiveRefresh = async (browser: Browser, fixture: Fixture) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE_URL });
  await addSessionCookie(context, fixture.sessionToken);
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  pageA.setDefaultTimeout(TIMEOUT);
  pageB.setDefaultTimeout(TIMEOUT);
  const errors: string[] = [];
  const requests: string[] = [];
  watchPage(pageA, errors);
  watchPage(pageB, errors);
  for (const page of [pageA, pageB]) {
    page.on("request", (request) => requests.push(request.url()));
  }

  const tablePath = `/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}`;
  await Promise.all([pageA.goto(tablePath, { waitUntil: "domcontentloaded" }), pageB.goto(tablePath, { waitUntil: "domcontentloaded" })]);
  await expectVisibleText(pageB, "Review invoices", "live tab B table route renders");

  const suffix = `${Date.now()}`;
  const metadataTableName = `Live metadata ${suffix}`;
  await browserMutation<{ id: string; shortId: string }>(pageA, {
    method: "POST",
    path: `/api/grids/tables/by-base/${fixture.base.id}`,
    expected: 201,
    body: { name: metadataTableName, icon: "ti ti-table-plus" },
  });
  await expectVisibleText(pageB, metadataTableName, "live metadata table appears in second tab sidebar");

  const createdTitle = `Live create ${suffix}`;
  const updatedTitle = `Live update ${suffix}`;
  const created = await browserMutation<{ id: string; version: number }>(pageA, {
    method: "POST",
    path: `/api/grids/records/by-table/${fixture.table.id}`,
    expected: 201,
    body: {
      [fixture.fields.title]: createdTitle,
      [fixture.fields.amount]: "12.34",
      [fixture.fields.status]: ["open"],
      [fixture.fields.notes]: "Created from live smoke",
      [fixture.fields.due]: "2026-05-29",
    },
  });
  await expectVisibleText(pageB, createdTitle, "live create appears in second tab");

  await browserMutation(pageA, {
    method: "PATCH",
    path: `/api/grids/records/${fixture.table.id}/${created.id}`,
    body: {
      [fixture.fields.title]: updatedTitle,
      [fixture.fields.amount]: "12.34",
      [fixture.fields.status]: ["open"],
      [fixture.fields.notes]: "Updated from live smoke",
      [fixture.fields.due]: "2026-05-29",
    },
  });
  await expectVisibleText(pageB, updatedTitle, "live update appears in second tab");

  const filterTitle = `Live filtered ${suffix}`;
  await pageB.goto(`${tablePath}?q=${encodeURIComponent(filterTitle)}&qFields=${fixture.fields.title}`, { waitUntil: "domcontentloaded" });
  await expectNoVisibleText(pageB, filterTitle, "filtered live row starts absent");
  await browserMutation(pageA, {
    method: "POST",
    path: `/api/grids/records/by-table/${fixture.table.id}`,
    expected: 201,
    body: {
      [fixture.fields.title]: filterTitle,
      [fixture.fields.amount]: "1.00",
      [fixture.fields.status]: ["open"],
      [fixture.fields.notes]: "Filtered live smoke",
      [fixture.fields.due]: "2026-05-29",
    },
  });
  await expectVisibleText(pageB, filterTitle, "live create respects active search SQL query");

  await pageB.goto(`${tablePath}?record=${created.id}`, { waitUntil: "domcontentloaded" });
  await expectVisibleText(pageB, "History", "live detail panel route opens");
  await browserMutation(pageA, {
    method: "DELETE",
    path: `/api/grids/records/${fixture.table.id}/${created.id}`,
    expected: 204,
  });
  await expectNoVisibleText(pageB, updatedTitle, "live delete removes record from second tab");

  await pageB.goto(`/app/grids/${fixture.base.shortId}/dashboard/${fixture.dashboard.shortId}`, { waitUntil: "domcontentloaded" });
  await expectVisibleText(pageB, "Total amount", "live dashboard route renders stat widget");
  await expectVisibleText(pageB, "Amount by status", "live dashboard route renders chart widget");
  await expectVisibleText(pageB, "Status summary", "live dashboard route renders view-stats widget");
  await expectNoVisibleTextPattern(pageB, /12[,.]000/, "live dashboard chart starts before large event value");
  const dashboardTitle = `Live dashboard ${suffix}`;
  await browserMutation(pageA, {
    method: "POST",
    path: `/api/grids/records/by-table/${fixture.table.id}`,
    expected: 201,
    body: {
      [fixture.fields.title]: dashboardTitle,
      [fixture.fields.amount]: "12345.67",
      [fixture.fields.status]: ["open"],
      [fixture.fields.notes]: "Dashboard live smoke",
      [fixture.fields.due]: "2026-05-29",
    },
  });
  await expectVisibleText(pageB, dashboardTitle, "live dashboard embedded view refreshes from record event");
  await expectVisibleTextPattern(pageB, /12[,.]596[,.]66/, "live dashboard stat refreshes from record event");
  await expectVisibleTextPattern(pageB, /12[,.]000/, "live dashboard chart refreshes from record event");

  await pageB.goto(`/app/grids/${fixture.base.shortId}/dashboard/${fixture.dashboard.shortId}?edit=true`, {
    waitUntil: "domcontentloaded",
  });
  await expectVisibleText(pageB, "Done editing", "live dashboard edit mode renders");
  const editDashboardTitle = `Live dashboard edit ${suffix}`;
  await browserMutation(pageA, {
    method: "POST",
    path: `/api/grids/records/by-table/${fixture.table.id}`,
    expected: 201,
    body: {
      [fixture.fields.title]: editDashboardTitle,
      [fixture.fields.amount]: "22222.22",
      [fixture.fields.status]: ["open"],
      [fixture.fields.notes]: "Dashboard edit live smoke",
      [fixture.fields.due]: "2026-05-30",
    },
  });
  await expectVisibleText(pageB, editDashboardTitle, "live dashboard edit embedded view refreshes from record event");
  await expectVisibleTextPattern(pageB, /34[,.]818[,.]88/, "live dashboard edit stat refreshes from record event");

  await pageB.goto(`/app/grids/${fixture.base.shortId}/dashboard/${fixture.dashboard.shortId}`, {
    waitUntil: "domcontentloaded",
  });
  await expectVisibleText(pageB, "Task title", "dashboard form submit fields render");
  await pageB.locator('[data-grids-dashboard-form-ready="true"]').waitFor({ state: "attached", timeout: TIMEOUT });
  const dashboardTitleInput = pageB.getByLabel(/task title/i).first();
  const inlineDashboardTitle = `Inline dashboard ${suffix}`;
  await dashboardTitleInput.fill(inlineDashboardTitle);
  if ((await dashboardTitleInput.inputValue()) !== inlineDashboardTitle) fail("dashboard form title input was not filled");
  const dashboardBudget = pageB.getByLabel(/budget/i).first();
  if (await dashboardBudget.count()) await dashboardBudget.fill("33333.33");
  await pageB.waitForTimeout(100);
  const submitResponse = pageB.waitForResponse(
    (response) => response.url().includes(`/api/grids/forms/${fixture.form.id}/submit`) && response.request().method() === "POST",
    { timeout: TIMEOUT },
  );
  await pageB.getByRole("button", { name: /send task/i }).click();
  const submitted = await submitResponse;
  if (!submitted.ok()) {
    const formInputs = await pageB.getByLabel(/task title/i).evaluateAll((elements) =>
      elements.map((element) => ({
        tag: element.tagName,
        value: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : null,
        disabled: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.disabled : null,
      })),
    );
    fail(
      `dashboard form submit failed with ${submitted.status()}: ${(await submitted.text()).slice(0, 400)}; request=${submitted.request().postData()}; inputs=${JSON.stringify(formInputs)}`,
    );
  }
  const dashboardRefreshAfterSubmit = await pageB
    .waitForResponse((response) => response.url().includes("/api/grids/workspace/route") && response.ok(), { timeout: TIMEOUT })
    .catch(() => null);
  if (!dashboardRefreshAfterSubmit) fail("dashboard form submit did not request a dashboard refresh");
  await expectVisibleText(pageB, inlineDashboardTitle, "dashboard form submit refreshes embedded view");
  await expectVisibleTextPattern(pageB, /68[,.]152[,.]21/, "dashboard form submit refreshes stat widget");

  if (requests.some((url) => /events\/by-table|text\/event-stream/i.test(url))) fail("live smoke observed legacy SSE request");
  assertNoBrowserErrors(errors);
  ok("websocket live refresh create/update/delete flow works");
  await context.close();
};

const runAuthedDesktop = async (browser: Browser, fixture: Fixture) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE_URL });
  await addSessionCookie(context, fixture.sessionToken);
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors: string[] = [];
  watchPage(page, errors);

  await page.goto(`/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}`, { waitUntil: "domcontentloaded" });
  await expectVisibleText(page, "Tasks", "table route renders");
  await expectVisibleText(page, "Review invoices", "record row renders");
  await expectVisibleText(page, "Open", "select badge renders");
  const filterButton = page.locator("button", { hasText: "Filter" }).first();
  const filterDeadline = Date.now() + TIMEOUT;
  do {
    await filterButton.click();
    if (await page.getByText("where", { exact: true }).first().isVisible()) break;
    await page.waitForTimeout(250);
  } while (Date.now() < filterDeadline);
  await expectVisibleText(page, "where", "filter toolbar opens a draft row");
  await page.getByRole("button", { name: "Query" }).click();
  await page.getByLabel("GQL query").waitFor({ state: "visible", timeout: TIMEOUT });
  ok("table query panel opens");
  await expectVisibleText(page, "Sources", "table query panel source catalog renders");
  const queryEditorValue = await page.getByLabel("GQL query").inputValue();
  if (!queryEditorValue.includes(`from table {${fixture.table.id}}`)) {
    fail(`table query panel did not start from the active table source: ${queryEditorValue}`);
  }
  ok("table query panel initializes from active table");
  await page.getByRole("button", { name: "Done" }).click();
  await expectNoVisibleText(page, "Full workspace", "table query panel closes");
  await page.goto(`/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}/formula-reference`, {
    waitUntil: "domcontentloaded",
  });
  await expectVisibleText(page, "Formula reference", "formula reference route renders");
  await expectVisibleText(page, "Fields", "formula reference fields section renders");
  await expectVisibleText(page, "Functions", "formula reference functions section renders");
  await expectVisibleText(page, "Amount", "formula reference lists fields");
  await page.goto(`/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}`, { waitUntil: "domcontentloaded" });

  const navigationCountBeforeEnhanced = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  const sidebarScrollBeforeDashboard = await page.locator('[data-scroll-preserve="grids-sidebar"]').evaluate((el) => {
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(32, maxScroll);
    return el.scrollTop;
  });
  await page.locator('[data-scroll-preserve="grids-sidebar"] a', { hasText: "Operations dashboard" }).first().click();
  await expectVisibleText(page, "Operations dashboard", "enhanced dashboard sidebar navigation renders");
  const dashboardUrl = new URL(page.url());
  if (!dashboardUrl.pathname.endsWith(`/dashboard/${fixture.dashboard.shortId}`)) {
    fail(`enhanced dashboard navigation wrote wrong URL: ${dashboardUrl.pathname}`);
  }
  const sidebarScrollAfterDashboard = await page.locator('[data-scroll-preserve="grids-sidebar"]').evaluate((el) => el.scrollTop);
  if (sidebarScrollBeforeDashboard > 0 && sidebarScrollAfterDashboard !== sidebarScrollBeforeDashboard) {
    fail(`sidebar scroll was not preserved after enhanced navigation: ${sidebarScrollAfterDashboard}`);
  }
  const navigationCountAfterEnhanced = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  if (navigationCountAfterEnhanced !== navigationCountBeforeEnhanced) {
    fail("enhanced sidebar navigation performed a document navigation");
  }
  ok("enhanced dashboard sidebar navigation preserves scroll");

  await page
    .locator(`[data-scroll-preserve="grids-sidebar"] a[href$="/table/${fixture.table.shortId}/view/${fixture.view.shortId}"]`)
    .first()
    .click();
  await page.waitForURL(`**/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}/view/${fixture.view.shortId}`, {
    timeout: TIMEOUT,
  });
  await expectVisibleText(page, "Open task amounts", "enhanced view sidebar navigation renders");
  const viewUrl = new URL(page.url());
  if (!viewUrl.pathname.endsWith(`/table/${fixture.table.shortId}/view/${fixture.view.shortId}`)) {
    fail(`enhanced view navigation wrote wrong URL: ${viewUrl.pathname}`);
  }
  ok("enhanced view sidebar navigation updates URL");

  await page.locator(`[data-scroll-preserve="grids-sidebar"] a[href$="/table/${fixture.table.shortId}"]`).first().click();
  await page.waitForURL(`**/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}`, { timeout: TIMEOUT });
  await expectVisibleText(page, "Review invoices", "enhanced table sidebar navigation renders");
  const tableUrl = new URL(page.url());
  if (!tableUrl.pathname.endsWith(`/table/${fixture.table.shortId}`)) {
    fail(`enhanced table navigation wrote wrong URL: ${tableUrl.pathname}`);
  }
  ok("enhanced table sidebar navigation updates URL");

  await page.locator(`[data-scroll-preserve="grids-sidebar"] a[href$="/table/${fixture.table.shortId}"]`).first().click();
  await page.waitForURL(`**/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}`, { timeout: TIMEOUT });
  await page.getByRole("link", { name: "Edit mode" }).click();
  await page.waitForURL(/edit=true/, { timeout: TIMEOUT });
  await expectVisibleText(page, "Done editing", "enhanced edit-mode navigation renders");
  await page.getByRole("link", { name: "Done editing" }).click();
  await page.waitForURL((url) => !url.searchParams.has("edit"), { timeout: TIMEOUT });
  ok("enhanced edit-mode navigation updates URL");

  await page.goto(`/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}?record=${fixture.records.first}`, {
    waitUntil: "domcontentloaded",
  });
  await expectVisibleText(page, "History", "record detail opens");

  await page.goto(`/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}/view/${fixture.view.shortId}`, {
    waitUntil: "domcontentloaded",
  });
  await expectVisibleText(page, "Open task amounts", "view route renders");
  await expectVisibleText(page, "Review invoices", "view rows render");

  await page.goto(`/app/grids/${fixture.base.shortId}/dashboard/${fixture.dashboard.shortId}`, { waitUntil: "domcontentloaded" });
  await expectVisibleText(page, "Operations dashboard", "dashboard route renders");
  await expectVisibleText(page, "Dashboard notes", "markdown widget renders");
  await expectVisibleText(page, "Open tasks table", "link widget renders");
  await expectVisibleText(page, "Task intake", "form widget renders");

  await page.goto(`/app/grids/${fixture.base.shortId}/dashboard/${fixture.dashboard.shortId}?edit=true`, {
    waitUntil: "domcontentloaded",
  });
  const moveTotalRight = page.getByRole("button", { name: "Move Total amount in row 1, position 1 right" });
  const moveTotalLeft = page.getByRole("button", { name: "Move Total amount in row 1, position 2 left" });
  const waitForDashboardSave = () =>
    page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname.endsWith(`/api/grids/dashboards/${fixture.dashboard.id}`),
      { timeout: TIMEOUT },
    );
  const moveRightSaved = waitForDashboardSave();
  const dashboardHydrationDeadline = Date.now() + TIMEOUT;
  let movedRight = false;
  do {
    await moveTotalRight.click();
    await page.waitForTimeout(100);
    if ((await moveTotalLeft.count()) > 0 && (await moveTotalLeft.isEnabled())) {
      movedRight = true;
      break;
    }
  } while (Date.now() < dashboardHydrationDeadline);
  if (!movedRight) fail("dashboard move-right control did not hydrate");
  if (!(await moveRightSaved).ok()) fail("dashboard move-right save failed");
  await expectFocusedLabel(page, "Move Total amount in row 1, position 2 left");
  const moveLeftSaved = waitForDashboardSave();
  await moveTotalLeft.click();
  if (!(await moveLeftSaved).ok()) fail("dashboard move-left save failed");
  await expectFocusedLabel(page, "Move Total amount in row 1, position 1 right");
  await page.reload({ waitUntil: "domcontentloaded" });
  const persistedMoveRight = page.getByRole("button", { name: "Move Total amount in row 1, position 1 right" });
  const persistedMoveLeft = page.getByRole("button", { name: "Move Total amount in row 1, position 1 left" });
  await persistedMoveRight.waitFor({ state: "visible", timeout: TIMEOUT });
  if (!(await persistedMoveRight.isEnabled()) || (await persistedMoveLeft.isEnabled())) {
    fail("dashboard keyboard moves were not persisted in request order");
  }
  ok("dashboard keyboard moves retain focus and persist in request order");

  const exportResult = await page.evaluate(
    async ({ tableId, titleFieldId }) => {
      const res = await fetch(`/api/grids/records/by-table/${tableId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "csv", fields: [{ fieldId: titleFieldId, label: "Title" }] }),
      });
      return {
        ok: res.ok,
        status: res.status,
        disposition: res.headers.get("content-disposition"),
        body: await res.text(),
      };
    },
    { tableId: fixture.table.id, titleFieldId: fixture.fields.title },
  );
  if (!exportResult.ok || !exportResult.disposition?.includes("attachment") || !exportResult.body.includes("Review invoices")) {
    fail(`export failed: ${JSON.stringify(exportResult).slice(0, 400)}`);
  }
  ok("authenticated export works in browser context");

  assertNoBrowserErrors(errors);
  await context.close();
};

const runPublicForm = async (browser: Browser, fixture: Fixture) => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, baseURL: BASE_URL });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors: string[] = [];
  watchPage(page, errors);

  await page.goto(`/share/grids/forms/${fixture.form.publicToken}`, { waitUntil: "domcontentloaded" });
  await expectVisibleText(page, "Task intake", "public form route renders");
  await page.locator('[data-grids-public-form-ready="true"]').waitFor({ state: "attached", timeout: TIMEOUT });
  const titleBox = page.getByLabel(/task title/i).first();
  await titleBox.fill("Public smoke task");
  const budget = page.getByLabel(/budget/i).first();
  if (await budget.count()) await budget.fill("42.42");
  const textboxValues = await page
    .getByRole("textbox")
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : (node.textContent ?? ""),
      ),
    );
  if (!textboxValues.includes("Public smoke task")) {
    fail(`public form title textbox was not filled. Textbox values: ${JSON.stringify(textboxValues)}`);
  }
  await page.getByRole("button", { name: /send task/i }).click();
  await page
    .getByText("Task saved", { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT })
    .catch(async () => {
      const visibleText = (await page.locator("body").innerText({ timeout: 2_000 })).slice(0, 1_000);
      fail(`public form submit did not show success. Visible page text:\n${visibleText}`);
    });
  ok("public form submit succeeds");

  const query = await api<{ items?: Array<{ data: Record<string, unknown> }> }>(
    "POST",
    `/api/grids/tables/${fixture.table.id}/query`,
    { query: { search: { q: "Public smoke task", fieldIds: [fixture.fields.title] } } },
    fixture.sessionToken,
    200,
  );
  if (!query.items?.some((record) => record.data[fixture.fields.title] === "Public smoke task")) {
    fail("public form submission was not persisted");
  }
  ok("public form submission persisted");

  assertNoBrowserErrors(errors);
  await context.close();
};

const runResponsive = async (browser: Browser, fixture: Fixture) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE_URL, isMobile: true });
  await addSessionCookie(context, fixture.sessionToken);
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors: string[] = [];
  watchPage(page, errors);

  await page.goto(`/app/grids/${fixture.base.shortId}/dashboard/${fixture.dashboard.shortId}`, { waitUntil: "domcontentloaded" });
  await expectVisibleText(page, "Operations dashboard", "mobile dashboard route renders");
  await expectVisibleText(page, "Dashboard notes", "mobile dashboard content renders");
  assertNoBrowserErrors(errors);
  await context.close();
};

const cleanup = async (fixture: Fixture | null) => {
  if (!fixture || KEEP) return;
  await api("DELETE", `/api/grids/bases/${fixture.base.id}`, undefined, fixture.sessionToken, 204).catch((err) => {
    console.warn(`cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  });
};

const runFormulaPreviewSmoke = async (fixture: Fixture) => {
  const preview = await api<{
    ok: boolean;
    diagnostics: { message: string }[];
    fields: { id: string; name: string }[];
    rows: { values: Record<string, unknown>; result: unknown }[];
  }>(
    "POST",
    `/api/grids/formulas/by-table/${fixture.table.id}/check`,
    { expression: `{${fixture.fields.amount}} + {${fixture.fields.amount}}` },
    fixture.sessionToken,
    200,
  );
  if (!preview.ok) fail(`formula preview returned diagnostics: ${preview.diagnostics.map((d) => d.message).join(", ")}`);
  if (preview.fields.length !== 1 || preview.fields[0]?.id !== fixture.fields.amount) fail("formula preview referenced fields mismatch");
  if (preview.rows.length !== 2) fail(`formula preview row count mismatch: ${preview.rows.length}`);
  if (!preview.rows.some((row) => row.result === "199.98")) fail("formula preview did not preserve decimal precision");
  ok("formula preview endpoint preserves decimal values");
};

let fixture: Fixture | null = null;
let browser: Browser | null = null;

try {
  fixture = await createFixture();
  await runFormulaPreviewSmoke(fixture);
  browser = await chromium.launch({ headless: HEADLESS });
  await runAuthedDesktop(browser, fixture);
  await runLiveRefresh(browser, fixture);
  await runPublicForm(browser, fixture);
  await runResponsive(browser, fixture);
  ok("browser smoke complete");
} catch (err) {
  if (err instanceof Error) {
    console.error(`\nBrowser smoke failed: ${err.message}`);
    const apiErr = err as ApiError;
    if (apiErr.body) console.error(apiErr.body);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  await cleanup(fixture);
}
