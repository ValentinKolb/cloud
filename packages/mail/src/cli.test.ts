import { afterEach, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";

const servers: ReturnType<typeof Bun.serve>[] = [];
const temporaryFiles: string[] = [];

const MAILBOX_ID = "00000000-0000-4000-8000-000000000001";
const COMMAND_ID = "00000000-0000-4000-8000-000000000002";
const IDENTITY_ID = "00000000-0000-4000-8000-000000000003";
const DRAFT_ID = "00000000-0000-4000-8000-000000000004";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000005";
const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000006";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000007";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000008";

const mailbox = {
  id: MAILBOX_ID,
  name: "Support",
  description: null,
  connectionPolicy: "shared_connection",
  health: "active",
  healthReason: null,
  syncEnabled: true,
  searchBackend: "auto",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
};

const mailCommand = (state: string) => ({
  id: COMMAND_ID,
  mailboxId: MAILBOX_ID,
  kind: "send",
  state,
  actor: { kind: "user", userId: "00000000-0000-4000-8000-000000000099" },
  idempotencyKey: "mail-cli-test",
  correlationId: null,
  target: { draftId: DRAFT_ID },
  payload: {},
  selectedBindingId: null,
  rightsSnapshot: null,
  transportMetadata: {},
  attempt: state === "queued" ? 0 : 1,
  lastError: state === "failed" ? "SMTP rejected the message" : null,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:01.000Z",
});

const api = (data: unknown, init?: ResponseInit) => Response.json(data, init);

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(temporaryFiles.splice(0).map((path) => rm(path, { force: true })));
});

const runCli = async (server: string, args: string[], input?: string) => {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", "../cloud-cli/src/index.ts", "--server", server, "--token", "test-token", ...args],
    cwd: new URL("..", import.meta.url).pathname,
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined && proc.stdin) {
    proc.stdin.write(input);
    proc.stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stdout, stderr };
};

const withMailbox = (handler: (request: Request) => Response | Promise<Response>) =>
  Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/mail/mailboxes") return api([{ ...mailbox, permission: "admin" }]);
      return handler(request);
    },
  });

test("search forwards nested expressions and cursors", async () => {
  let requestBody: unknown;
  const server = withMailbox(async (request) => {
    if (new URL(request.url).pathname === `/api/mail/mailboxes/${MAILBOX_ID}/search`) {
      requestBody = await request.json();
      return api({ items: [], nextCursor: null, backend: "native" });
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(
    `http://127.0.0.1:${server.port}`,
    ["--json", "mail", "search", "--mailbox", MAILBOX_ID, "--expression-stdin", "--cursor", "next-page", "--sort", "newest"],
    JSON.stringify({ and: [{ field: "subject", query: "invoice", match: "contains" }, { not: { field: "from", query: "bot" } }] }),
  );

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(requestBody).toEqual({
    expression: {
      and: [{ field: "subject", query: "invoice", match: "contains" }, { not: { field: "from", query: "bot", match: "words" } }],
    },
    sort: "newest",
    cursor: "next-page",
    limit: 50,
  });
});

test("command wait polls until a successful terminal state", async () => {
  let reads = 0;
  const server = withMailbox((request) => {
    if (new URL(request.url).pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands/${COMMAND_ID}`) {
      reads += 1;
      return api(mailCommand(reads === 1 ? "queued" : "confirmed"));
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "command",
    "wait",
    COMMAND_ID,
    "--mailbox",
    MAILBOX_ID,
    "--timeout-seconds",
    "2",
  ]);

  expect(result.exitCode).toBe(0);
  expect(reads).toBe(2);
  expect(JSON.parse(result.stdout).state).toBe("confirmed");
});

test("command wait exits non-zero for a terminal failure", async () => {
  const server = withMailbox((request) =>
    new URL(request.url).pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands/${COMMAND_ID}`
      ? api(mailCommand("failed"))
      : api({ message: "unexpected" }, { status: 500 }),
  );
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, ["mail", "command", "wait", COMMAND_ID, "--mailbox", MAILBOX_ID]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("SMTP rejected the message");
});

test("command wait has a bounded timeout", async () => {
  const server = withMailbox((request) =>
    new URL(request.url).pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands/${COMMAND_ID}`
      ? api(mailCommand("queued"))
      : api({ message: "unexpected" }, { status: 500 }),
  );
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "mail",
    "command",
    "wait",
    COMMAND_ID,
    "--mailbox",
    MAILBOX_ID,
    "--timeout-seconds",
    "1",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`Timed out waiting for mail command ${COMMAND_ID}`);
});

test("message wait polls indexed search for the expected message", async () => {
  let searches = 0;
  const server = withMailbox(async (request) => {
    if (new URL(request.url).pathname !== `/api/mail/mailboxes/${MAILBOX_ID}/search`) {
      return api({ message: "unexpected" }, { status: 500 });
    }
    searches += 1;
    const body = (await request.json()) as { expression?: unknown };
    expect(body.expression).toEqual({ field: "subject", query: "smoke-marker", match: "exact" });
    return api({
      items:
        searches === 1
          ? []
          : [
              {
                id: MESSAGE_ID,
                conversationId: CONVERSATION_ID,
                subject: "smoke-marker",
                messageId: "<smoke-marker@example.com>",
                internalDate: "2026-07-12T00:00:00.000Z",
                sentAt: "2026-07-12T00:00:00.000Z",
                from: [{ name: null, address: "sender@example.com" }],
                to: [{ name: null, address: "recipient@example.com" }],
                flags: [],
                snippet: "body",
                rank: 1,
              },
            ],
      nextCursor: null,
      backend: "native",
    });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "message",
    "wait",
    "--mailbox",
    MAILBOX_ID,
    "--subject",
    "smoke-marker",
    "--match",
    "exact",
    "--timeout-seconds",
    "2",
  ]);

  expect(result.exitCode).toBe(0);
  expect(searches).toBe(2);
  expect(JSON.parse(result.stdout).id).toBe(MESSAGE_ID);
});

test("send carries reply context and can wait for delivery", async () => {
  const bodies: unknown[] = [];
  const server = withMailbox(async (request) => {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === `/api/mail/mailboxes/${MAILBOX_ID}/drafts`) {
      bodies.push(await request.json());
      return api({
        id: DRAFT_ID,
        mailboxId: MAILBOX_ID,
        conversationId: CONVERSATION_ID,
        senderIdentityId: IDENTITY_ID,
        to: [{ name: null, address: "recipient@example.com" }],
        cc: [],
        bcc: [],
        subject: "Re: CLI test",
        body: "Reply body",
        format: "markdown",
        revision: 1,
        state: "draft",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      });
    }
    if (request.method === "POST" && url.pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands`) {
      bodies.push(await request.json());
      return api(mailCommand("queued"));
    }
    if (request.method === "GET" && url.pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands/${COMMAND_ID}`) {
      return api(mailCommand("confirmed"));
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(
    `http://127.0.0.1:${server.port}`,
    [
      "--json",
      "mail",
      "send",
      "--mailbox",
      MAILBOX_ID,
      "--identity",
      IDENTITY_ID,
      "--to",
      "recipient@example.com",
      "--conversation",
      CONVERSATION_ID,
      "--subject",
      "Re: CLI test",
      "--body-stdin",
      "--undo",
      "0",
      "--wait",
      "--timeout-seconds",
      "2",
    ],
    "Reply body",
  );

  expect(result.exitCode).toBe(0);
  expect(bodies[0]).toMatchObject({ conversationId: CONVERSATION_ID, body: "Reply body" });
  expect(bodies[1]).toMatchObject({ kind: "send", undoSeconds: 0 });
  expect(JSON.parse(result.stdout).command.state).toBe("confirmed");
});

test("provider credentials are accepted from stdin and never printed", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const server = withMailbox(async (request) => {
    if (request.method === "POST" && new URL(request.url).pathname === "/api/mail/connections") {
      requestBody = (await request.json()) as Record<string, unknown>;
      return api({
        connection: {
          id: CONNECTION_ID,
          name: "Provider",
          email: "sender@example.com",
          owner: { type: "mailbox", mailboxId: MAILBOX_ID },
        },
        verification: {},
      });
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(
    `http://127.0.0.1:${server.port}`,
    [
      "mail",
      "provider",
      "add",
      "--mailbox",
      MAILBOX_ID,
      "--name",
      "Provider",
      "--email",
      "sender@example.com",
      "--username",
      "sender@example.com",
      "--imap-host",
      "imap.example.com",
      "--smtp-host",
      "smtp.example.com",
      "--secret-stdin",
    ],
    "not-a-real-secret",
  );

  expect(result.exitCode).toBe(0);
  expect(requestBody).toMatchObject({ connection: { secret: { kind: "password", password: "not-a-real-secret" } } });
  expect(result.stdout).not.toContain("not-a-real-secret");
  expect(result.stderr).not.toContain("not-a-real-secret");
});

test("attachment download writes the exact response bytes", async () => {
  const expected = new TextEncoder().encode("attachment bytes\n");
  const output = `/tmp/cloud-mail-cli-${crypto.randomUUID()}.txt`;
  temporaryFiles.push(output);
  const server = withMailbox((request) => {
    const expectedPath = `/api/mail/mailboxes/${MAILBOX_ID}/messages/${MESSAGE_ID}/attachments/${ATTACHMENT_ID}`;
    if (new URL(request.url).pathname === expectedPath) {
      return new Response(expected, { headers: { "Content-Type": "text/plain", ETag: '"attachment-etag"' } });
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "attachment",
    "download",
    MESSAGE_ID,
    ATTACHMENT_ID,
    "--mailbox",
    MAILBOX_ID,
    "--out",
    output,
  ]);

  expect(result.exitCode).toBe(0);
  expect(new Uint8Array(await readFile(output))).toEqual(expected);
  expect(JSON.parse(result.stdout)).toMatchObject({ path: output, bytes: expected.byteLength, contentType: "text/plain" });
});

test("message deletion requires explicit confirmation before the API call", async () => {
  let mutationRequested = false;
  const server = withMailbox(() => {
    mutationRequested = true;
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "mail",
    "message",
    "delete",
    ATTACHMENT_ID,
    "--mailbox",
    MAILBOX_ID,
    "--folder",
    CONVERSATION_ID,
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Pass --yes");
  expect(mutationRequested).toBe(false);
});

test("send cancellation uses the public command id", async () => {
  let requestedPath = "";
  const server = withMailbox((request) => {
    requestedPath = new URL(request.url).pathname;
    return api(null);
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "command",
    "cancel",
    COMMAND_ID,
    "--mailbox",
    MAILBOX_ID,
  ]);

  expect(result.exitCode).toBe(0);
  expect(requestedPath).toBe(`/api/mail/mailboxes/${MAILBOX_ID}/commands/${COMMAND_ID}/cancel`);
  expect(JSON.parse(result.stdout)).toEqual({ cancelled: true, commandId: COMMAND_ID });
});
