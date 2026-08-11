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

test("uses only six-character Space IDs as direct resource references", async () => {
  const legacyUuid = "11111111-1111-4111-8111-111111111111";
  const requestUrls: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      requestUrls.push(request.url);
      const url = new URL(request.url);
      if (url.pathname === "/api/spaces/space1") {
        return Response.json({
          id: "space1",
          name: "Roadmap",
          description: null,
          color: "#3b82f6",
          icalToken: null,
          createdAt: "2026-08-11T08:00:00.000Z",
          updatedAt: "2026-08-11T09:00:00.000Z",
          columns: [],
          tags: [],
        });
      }
      return Response.json([]);
    },
  });
  servers.push(server);

  const direct = await runCli(`http://127.0.0.1:${server.port}`, ["--json", "spaces", "get", "space1"]);
  expect(direct.exitCode).toBe(0);
  expect(direct.stdout).toContain('"id": "space1"');

  const legacy = await runCli(`http://127.0.0.1:${server.port}`, ["spaces", "get", legacyUuid]);
  expect(legacy.exitCode).toBe(1);
  expect(requestUrls.map((value) => new URL(value).pathname)).toEqual(["/api/spaces/space1", "/api/spaces"]);
});
