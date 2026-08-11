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

test("uses only six-character Contact book IDs as direct resource references", async () => {
  const legacyUuid = "11111111-1111-4111-8111-111111111111";
  const requestUrls: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      requestUrls.push(request.url);
      const url = new URL(request.url);
      if (url.pathname === "/api/contacts/books/Book01") {
        return Response.json({ id: "Book01", name: "Customers", description: null, createdAt: null, updatedAt: null });
      }
      return Response.json({ data: [], pagination: { page: 1, per_page: 100, total: 0, total_pages: 0, has_next: false } });
    },
  });
  servers.push(server);

  const direct = await runCli(`http://127.0.0.1:${server.port}`, ["--json", "contacts", "book", "Book01"]);
  expect(direct.exitCode).toBe(0);
  expect(direct.stdout).toContain('"id": "Book01"');

  const legacy = await runCli(`http://127.0.0.1:${server.port}`, ["contacts", "book", legacyUuid]);
  expect(legacy.exitCode).toBe(1);
  expect(requestUrls.map((value) => new URL(value).pathname)).toEqual(["/api/contacts/books/Book01", "/api/contacts/books"]);
});

test("rejects legacy UUID note IDs before sending a note request", async () => {
  const legacyUuid = "11111111-1111-4111-8111-111111111111";
  const requestPaths: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      requestPaths.push(path);
      if (path === "/api/contacts/books/Book01") {
        return Response.json({ id: "Book01", name: "Customers", description: null, createdAt: null, updatedAt: null });
      }
      if (path === "/api/contacts/books/Book01/contacts/Cont01") {
        return Response.json({ id: "Cont01", bookId: "Book01", label: "Ada", firstName: null, lastName: null, companyName: null });
      }
      return new Response("Unexpected request", { status: 500 });
    },
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "contacts",
    "update-note",
    "Book01",
    "Cont01",
    legacyUuid,
    "--content",
    "Changed",
  ]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Note must be a six-character Contacts ID");
  expect(requestPaths).toEqual(["/api/contacts/books/Book01", "/api/contacts/books/Book01/contacts/Cont01"]);
});
