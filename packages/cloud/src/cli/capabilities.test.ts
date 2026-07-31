import { describe, expect, test } from "bun:test";
import capabilitiesCliModule from "./capabilities";
import type { CloudCliContext, CloudCliFlags } from "./index";

const createContext = (args: string[], flags: CloudCliFlags, fetch: CloudCliContext["fetch"]) => {
  const lines: string[] = [];
  const ctx: CloudCliContext = {
    args,
    flags,
    options: { profile: "test", server: "http://cloud.test", token: "token", output: "json" },
    getDefault: async () => undefined,
    setDefault: async () => undefined,
    createApiClient: (() => {
      throw new Error("not needed");
    }) as CloudCliContext["createApiClient"],
    fetch,
    readJson: async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(`${response.status} ${(body as { message?: string }).message ?? "Request failed"}`);
      return body;
    },
    print: (value = "") => lines.push(value),
    write: async (value) => void lines.push(value),
    error: (value) => lines.push(value),
    json: (value) => lines.push(JSON.stringify(value)),
    jsonLine: (value) => lines.push(JSON.stringify(value)),
    table: () => undefined,
  };
  return { ctx, lines };
};

describe("capabilities CLI", () => {
  test("invokes a query with strict JSON input", async () => {
    let request: { path: string; init?: RequestInit } | undefined;
    const { ctx, lines } = createContext(
      ["query", "contacts", "search"],
      { input: '{"query":"Ada","tags":[],"limit":5}' },
      async (path, init) => {
        request = { path, init };
        return Response.json({ data: [] });
      },
    );
    await capabilitiesCliModule.run(ctx);
    expect(request?.path).toBe("/api/capabilities/v1/queries/contacts/search");
    expect(JSON.parse(String(request?.init?.body))).toEqual({ input: { query: "Ada", tags: [], limit: 5 } });
    expect(lines).toEqual(['{"data":[]}']);
  });

  test("requires a stable idempotency key for actions", async () => {
    const { ctx } = createContext(["action", "contacts", "create"], { input: '{"bookId":"one","label":"Ada"}' }, async () =>
      Response.json({}),
    );
    await expect(capabilitiesCliModule.run(ctx)).rejects.toThrow("Missing required flag --idempotency-key");
  });

  test("forwards the idempotency key", async () => {
    const keys: Array<string | null> = [];
    const { ctx } = createContext(
      ["action", "contacts", "create"],
      { input: '{"bookId":"one","label":"Ada"}', "idempotency-key": "contact-ada" },
      async (_path, init) => {
        keys.push(new Headers(init?.headers).get("idempotency-key"));
        return Response.json({ data: { id: "one" } });
      },
    );
    await capabilitiesCliModule.run(ctx);
    expect(keys).toEqual(["contact-ada"]);
  });
});
