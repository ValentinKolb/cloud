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
