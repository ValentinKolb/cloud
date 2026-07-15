import { afterEach, expect, test } from "bun:test";

const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

const runCli = async (server: string, args: string[]) => {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "../cloud-cli/src/index.ts", "--server", server, "--token", "test-token", ...args],
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stdout, stderr };
};

const notebookFixture = {
  id: "00000000-0000-4000-8000-000000000002",
  shortId: "wiki",
  name: "Wiki",
  description: null,
  icon: null,
  homepageNoteId: null,
  homepageNoteShortId: null,
  scriptsEnabled: false,
  defaultNoteTitleTemplate: "New Document",
  createdBy: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

test("global search forwards full-text and structured filters", async () => {
  const requestUrls: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      requestUrls.push(request.url);
      return Response.json({
        data: [
          {
            note: {
              id: "00000000-0000-4000-8000-000000000001",
              shortId: "abc123",
              notebookId: "00000000-0000-4000-8000-000000000002",
              parentId: null,
              title: "Search architecture",
              position: 0,
              hasChildren: false,
              yjsSnapshotAt: null,
              contentMd: "Native PostgreSQL search",
              createdBy: null,
              createdAt: "2026-07-01T00:00:00.000Z",
              updatedAt: "2026-07-10T00:00:00.000Z",
              lockedAt: null,
            },
            notebook: {
              id: "00000000-0000-4000-8000-000000000002",
              shortId: "nb1234",
              name: "Wiki",
              icon: null,
            },
            snippet: "Native \uE000PostgreSQL\uE001 search",
          },
        ],
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1, has_next: false },
      });
    },
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "notebooks",
    "search",
    "postgres search",
    "--all",
    "--tags",
    "architecture,database",
    "--updated-after",
    "2026-07-01T00:00:00.000Z",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const requestUrl = new URL(requestUrls[0]!);
  expect(requestUrl.pathname).toBe("/api/notebooks/search");
  expect(requestUrl.searchParams.get("q")).toBe("postgres search");
  expect(requestUrl.searchParams.get("tags")).toBe("architecture,database");
  expect(requestUrl.searchParams.get("updated_after")).toBe("2026-07-01T00:00:00.000Z");
});

test("destructive notebook deletion requires explicit confirmation", async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ message: "unexpected" }, { status: 500 }) });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, ["notebooks", "delete", "wiki"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("without --yes");
});

test("create-note sends markdown without a separate title", async () => {
  const createBodies: Record<string, unknown>[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/notebooks/wiki") return Response.json(notebookFixture);
      if (request.method === "POST" && url.pathname === "/api/notebooks/wiki/notes") {
        createBodies.push((await request.json()) as Record<string, unknown>);
        return Response.json({
          id: "00000000-0000-4000-8000-000000000003",
          shortId: "note01",
          notebookId: notebookFixture.id,
          parentId: null,
          title: "Incident review",
          position: 0,
          hasChildren: false,
          yjsSnapshotAt: null,
          contentMd: "# Incident review\n",
          createdBy: null,
          createdAt: notebookFixture.createdAt,
          updatedAt: notebookFixture.updatedAt,
          lockedAt: null,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "notebooks",
    "create-note",
    "--notebook",
    "wiki",
    "--content",
    "# Incident review\n",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(createBodies).toEqual([{ contentMd: "# Incident review\n" }]);
});

test("update forwards the default note title template", async () => {
  const updateBodies: Record<string, unknown>[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/notebooks/wiki") return Response.json(notebookFixture);
      if (request.method === "PATCH" && url.pathname === "/api/notebooks/wiki") {
        const body = (await request.json()) as Record<string, unknown>;
        updateBodies.push(body);
        return Response.json({ ...notebookFixture, ...body });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "notebooks",
    "update",
    "--notebook",
    "wiki",
    "--default-note-title-template",
    "{{ date }} Journal",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(updateBodies).toEqual([{ defaultNoteTitleTemplate: "{{ date }} Journal" }]);
});
