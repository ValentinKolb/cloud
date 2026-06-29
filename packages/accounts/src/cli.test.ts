import { describe, expect, test } from "bun:test";
import type { CloudCliContext, CloudCliFlags } from "@valentinkolb/cloud/cli";
import accountsCli from "./cli";

type FetchCall = {
  path: string;
  init?: RequestInit;
};

const jsonResponse = (value: unknown, status = 200) => Response.json(value, { status });

const createContext = (args: string[], flags: CloudCliFlags = {}, responses: Response[] = []) => {
  const calls: FetchCall[] = [];
  const lines: string[] = [];
  const tables: unknown[][] = [];
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
    json: (value) => lines.push(JSON.stringify(value, null, 2)),
    table: (rows) => tables.push(rows),
  };
  return { ctx, calls, lines, tables };
};

const pagination = { page: 1, per_page: 100, total: 1, total_pages: 1, has_next: false };

describe("accounts CLI", () => {
  test("lists users through the accounts API with filters", async () => {
    const { ctx, calls, tables } = createContext(
      ["users", "list"],
      { page: "2", "per-page": "3", q: "alice", provider: "local", profile: "user" },
      [
        jsonResponse({
          users: [
            {
              id: "u1",
              uid: "alice",
              roles: ["user"],
              provider: "local",
              profile: "user",
              givenname: "Alice",
              sn: "Example",
              displayName: "Alice Example",
              mail: "alice@example.org",
              avatarHash: null,
            },
          ],
          pagination: { page: 2, per_page: 3, total: 1, total_pages: 1, has_next: false },
        }),
      ],
    );

    await accountsCli.run(ctx);

    expect(calls[0]?.path).toBe("/api/accounts/users?page=2&per_page=3&search=alice&provider=local&profile=user");
    expect(tables[0]).toEqual([
      {
        uid: "alice",
        name: "Alice Example",
        email: "alice@example.org",
        provider: "local",
        profile: "user",
        roles: "user",
        id: "u1",
      },
    ]);
  });

  test("guards destructive user mutations before resolving refs", async () => {
    const { ctx, calls } = createContext(["users", "set-admin", "alice"], { enabled: true }, []);

    await expect(accountsCli.run(ctx)).rejects.toThrow("without --yes");
    expect(calls).toHaveLength(0);
  });

  test("adds group members through the user-accessible group relation endpoint", async () => {
    const { ctx, calls, lines } = createContext(
      ["groups", "members", "add", "team"],
      { user: "alice", yes: true },
      [
        jsonResponse({
          groups: [{ id: "g1", provider: "local", name: "team", description: null, gidnumber: null }],
          pagination,
        }),
        jsonResponse({
          items: [
            {
              kind: "user",
              user: {
                id: "u1",
                uid: "alice",
                roles: ["user"],
                provider: "local",
                profile: "user",
                givenname: "Alice",
                sn: "Example",
                displayName: "Alice Example",
                mail: "alice@example.org",
                avatarHash: null,
              },
            },
          ],
          pagination,
        }),
        jsonResponse({ message: "User added as member." }),
      ],
    );

    await accountsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      "/api/accounts/groups?page=1&per_page=100&search=team&scope=all",
      "/api/accounts/entities?page=1&per_page=100&search=alice&kinds=user",
      "/api/accounts/groups/g1/members",
    ]);
    expect(calls[2]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ type: "user", id: "u1" });
    expect(lines).toEqual(["User added as member."]);
  });

  test("filters service account keys by resolved user", async () => {
    const { ctx, calls } = createContext(
      ["service-accounts", "list"],
      { user: "alice" },
      [
        jsonResponse({
          users: [
            {
              id: "u1",
              uid: "alice",
              roles: ["user"],
              provider: "local",
              profile: "user",
              givenname: "Alice",
              sn: "Example",
              displayName: "Alice Example",
              mail: "alice@example.org",
              avatarHash: null,
            },
          ],
          pagination,
        }),
        jsonResponse({ credentials: [], pagination: { page: 1, per_page: 50, total: 0, total_pages: 0, has_next: false } }),
      ],
    );

    await accountsCli.run(ctx);

    expect(calls.map((call) => call.path)).toEqual([
      "/api/accounts/users?page=1&per_page=100&search=alice",
      "/api/accounts/service-accounts?page=1&per_page=50&userId=u1",
    ]);
  });

  test("validates avatar input before resolving the user", async () => {
    const { ctx, calls } = createContext(["users", "avatar", "set", "alice"], {}, []);

    await expect(accountsCli.run(ctx)).rejects.toThrow("Missing avatar input");
    expect(calls).toHaveLength(0);
  });
});
