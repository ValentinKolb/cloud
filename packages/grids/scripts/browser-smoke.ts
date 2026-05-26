#!/usr/bin/env bun
/**
 * Grids browser regression smoke.
 *
 * This intentionally stays small: fixtures are created through the API,
 * then a real browser checks the routes and interactions most likely to
 * regress during v1 polish. Avoid golden screenshots and fragile full-app
 * snapshots; assert visible user-facing behaviour.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin";
const HEADLESS = process.env.HEADLESS !== "0";
const KEEP = process.env.KEEP === "1";
const TIMEOUT = Number(process.env.BROWSER_SMOKE_TIMEOUT_MS ?? 10_000);

type ApiError = Error & { status?: number; body?: string };

type Fixture = {
  sessionToken: string;
  base: { id: string; shortId: string };
  table: { id: string; shortId: string };
  view: { id: string; shortId: string };
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
      query: {
        columns: [
          { fieldId: title.id },
          { fieldId: status.id },
          { fieldId: amount.id, format: { kind: "decimal", precision: 2, thousandsSeparator: true } },
        ],
        sort: [{ fieldId: title.id, direction: "asc" }],
        aggregations: [{ fieldId: amount.id, agg: "sum", label: "Total amount", format: { kind: "decimal", precision: 2 } }],
      },
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
                source: { tableId: table.id, aggregations: [{ fieldId: amount.id, agg: "sum" }] },
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
                source: { kind: "view", viewId: view.id },
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

const assertNoBrowserErrors = (errors: string[]) => {
  if (errors.length > 0) {
    fail(`browser errors:\n${errors.slice(0, 8).join("\n")}`);
  }
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
  await page.goto(`/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}?record=${fixture.records.first}`, {
    waitUntil: "domcontentloaded",
  });
  await expectVisibleText(page, "History", "record detail opens");

  await page.goto(`/app/grids/${fixture.base.shortId}/table/${fixture.table.shortId}/view/${fixture.view.shortId}`, { waitUntil: "domcontentloaded" });
  await expectVisibleText(page, "Open task amounts", "view route renders");
  await expectVisibleText(page, "Total amount", "view aggregate footer renders");

  await page.goto(`/app/grids/${fixture.base.shortId}/dashboard/${fixture.dashboard.shortId}`, { waitUntil: "domcontentloaded" });
  await expectVisibleText(page, "Operations dashboard", "dashboard route renders");
  await expectVisibleText(page, "Dashboard notes", "markdown widget renders");
  await expectVisibleText(page, "Open tasks table", "link widget renders");
  await expectVisibleText(page, "Task intake", "form widget renders");

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
  const titleBox = page.getByRole("textbox").nth(0);
  await titleBox.click();
  await titleBox.pressSequentially("Public smoke task");
  const budget = page.getByRole("textbox").nth(1);
  if (await budget.count()) await budget.fill("42.42");
  const textboxValues = await page.getByRole("textbox").evaluateAll((nodes) =>
    nodes.map((node) => (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : node.textContent ?? "")),
  );
  if (!textboxValues.includes("Public smoke task")) {
    fail(`public form title textbox was not filled. Textbox values: ${JSON.stringify(textboxValues)}`);
  }
  await page.getByRole("button", { name: /send task/i }).click();
  await page.getByText("Task saved", { exact: false }).first().waitFor({ state: "visible", timeout: TIMEOUT }).catch(async () => {
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

let fixture: Fixture | null = null;
let browser: Browser | null = null;

try {
  fixture = await createFixture();
  browser = await chromium.launch({ headless: HEADLESS });
  await runAuthedDesktop(browser, fixture);
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
