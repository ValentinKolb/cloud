import { describe, expect, test } from "bun:test";
import adminCli from "./admin";
import type { CloudCliContext, CloudCliFlags, CloudCliTableColumn } from "./index";

type FetchCall = {
  path: string;
  init?: RequestInit;
};

const jsonResponse = (value: unknown, status = 200) => Response.json(value, { status });

const textResponse = (value: string, status = 200) => new Response(value, { status });

const createContext = (args: string[], flags: CloudCliFlags = {}, responses: Response[] = []) => {
  const calls: FetchCall[] = [];
  const lines: string[] = [];
  const tables: unknown[][] = [];
  const tableColumns: CloudCliTableColumn<Record<string, unknown>>[][] = [];
  const ctx: CloudCliContext = {
    args,
    flags,
    options: { profile: "test", server: "http://cloud.test", token: "token", output: "text" },
    getDefault: async () => undefined,
    setDefault: async () => undefined,
    createApiClient: (() => {
      throw new Error("not needed");
    }) as CloudCliContext["createApiClient"],
    fetch: async (path, init) => {
      calls.push({ path, init });
      const response = responses.shift();
      if (!response) throw new Error(`Unexpected fetch: ${path}`);
      return response;
    },
    readJson: async (response) => {
      const value = await response.json();
      if (!response.ok) throw new Error(typeof value?.message === "string" ? value.message : response.statusText);
      return value;
    },
    print: (value = "") => lines.push(value),
    write: (value) => lines.push(value),
    error: (value) => lines.push(value),
    json: (value) => lines.push(JSON.stringify(value, null, 2)),
    jsonLine: (value) => lines.push(JSON.stringify(value)),
    table: (rows, columns) => {
      tables.push(rows);
      tableColumns.push(columns as CloudCliTableColumn<Record<string, unknown>>[]);
    },
  };
  return { ctx, calls, lines, tables, tableColumns };
};

describe("admin CLI", () => {
  test("lists gateway routes with filters", async () => {
    const { ctx, calls, tables, tableColumns } = createContext(
      ["routes", "list"],
      { q: "api", app: "contacts", errors: true, sort: "errors" },
      [
        jsonResponse({
          generatedAt: "2026-06-29T10:00:00.000Z",
          instanceId: "gw-1",
          total: 2,
          routeCount: 1,
          items: [
            {
              prefix: "/app/contacts",
              appId: "contacts",
              count: 12,
              errors: 1,
              lastSeen: "2026-06-29T09:59:00.000Z",
            },
          ],
        }),
      ],
    );

    await adminCli.run(ctx);

    expect(calls[0]?.path).toBe("/api/gateway/routes?search=api&app=contacts&errors=true&sort=errors");
    expect(tables[0]).toEqual([
      {
        prefix: "/app/contacts",
        app: "contacts",
        requests: 12,
        errors: 1,
        lastSeen: "2026-06-29T09:59:00.000Z",
      },
    ]);
    expect(tableColumns[0]?.map((column) => column.key)).toEqual(["prefix", "app", "requests", "errors", "lastSeen"]);
  });

  test("reads raw Prometheus metrics", async () => {
    const { ctx, calls, lines } = createContext(["metrics", "read"], {}, [textResponse("# HELP cloud_up\ncloud_up 1\n")]);

    await adminCli.run(ctx);

    expect(calls[0]?.path).toBe("/metrics");
    expect(lines).toEqual(["# HELP cloud_up\ncloud_up 1"]);
  });

  test("creates metrics tokens with normalized expiry", async () => {
    const { ctx, calls, lines } = createContext(["metrics", "tokens", "create", "grafana"], { "expires-at": "never" }, [
      jsonResponse({
        token: "cld_metric_secret",
        credential: {
          id: "tok_1",
          name: "grafana",
          tokenPrefix: "cld_metric",
          expiresAt: null,
          lastUsedAt: null,
          createdAt: "2026-06-29T10:00:00.000Z",
        },
      }),
    ]);

    await adminCli.run(ctx);

    expect(calls[0]?.path).toBe("/api/gateway/metrics/tokens");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ name: "grafana", expiresAt: null });
    expect(lines[0]).toContain("Token: cld_metric_secret");
  });
});
