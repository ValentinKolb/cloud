import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";

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
const FOLDER_ID = "00000000-0000-4000-8000-000000000009";
const REMOTE_MESSAGE_REF_ID = "00000000-0000-4000-8000-000000000010";

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
  result: {},
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

test("status reads the aggregate operational health endpoint", async () => {
  const server = withMailbox((request) =>
    new URL(request.url).pathname === `/api/mail/mailboxes/${MAILBOX_ID}/health`
      ? api({
          mailboxId: MAILBOX_ID,
          health: "active",
          healthReason: null,
          syncEnabled: true,
          bindings: { total: 2, active: 1, degraded: 1, pending: 0, revoked: 0, lastVerifiedAt: null, rightsSources: { acl: 1 } },
          discovery: { generation: 3, lastAt: null, activeFolders: 4, missingFolders: 1, ambiguousFolders: 0, subscribedFolders: 4 },
          sync: { lastAt: null, lagSeconds: null, runningRuns: 0, failedRuns: 0, folderStates: { current: 4 } },
          hydration: { complete: 20, pending: 2, failed: 1 },
          commands: { states: { confirmed: 3 }, maintenanceQueued: 0 },
          outbox: { states: {} },
          search: { configuredBackend: "auto", pgTextsearchInstalled: false, bm25Ready: false },
        })
      : api({ message: "unexpected" }, { status: 500 }),
  );
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, ["--json", "mail", "status", "--mailbox", MAILBOX_ID]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ mailboxId: MAILBOX_ID, bindings: { active: 1 }, discovery: { missingFolders: 1 } });
});

test("rediscover submits a typed durable maintenance command and can wait", async () => {
  const bodies: unknown[] = [];
  let reads = 0;
  const server = withMailbox(async (request) => {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands`) {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return api({ ...mailCommand("queued"), kind: body.kind });
    }
    if (request.method === "GET" && url.pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands/${COMMAND_ID}`) {
      reads += 1;
      return api({ ...mailCommand("confirmed"), kind: "discover_folders", result: { bindings: [] } });
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "rediscover",
    "--mailbox",
    MAILBOX_ID,
    "--binding",
    CONNECTION_ID,
    "--idempotency-key",
    "rediscovery-test",
    "--wait",
    "--timeout-seconds",
    "2",
  ]);

  expect(result.exitCode).toBe(0);
  expect(reads).toBe(1);
  expect(bodies).toEqual([
    {
      kind: "discover_folders",
      bindingId: CONNECTION_ID,
      idempotencyKey: "rediscovery-test",
    },
  ]);
  expect(JSON.parse(result.stdout)).toMatchObject({ kind: "discover_folders", state: "confirmed" });
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

test("folder create submits one durable provider command and waits for rediscovery", async () => {
  let body: unknown;
  const server = withMailbox(async (request) => {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands`) {
      body = await request.json();
      return api({ ...mailCommand("queued"), kind: "create_folder" });
    }
    if (request.method === "GET" && url.pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands/${COMMAND_ID}`) {
      return api({ ...mailCommand("confirmed"), kind: "create_folder", result: { path: "Cloud Smoke" } });
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "folder",
    "create",
    "Cloud Smoke",
    "--mailbox",
    MAILBOX_ID,
    "--parent",
    FOLDER_ID,
    "--idempotency-key",
    "folder-create-test",
    "--wait",
    "--timeout-seconds",
    "2",
  ]);

  expect(result.exitCode).toBe(0);
  expect(body).toEqual({
    kind: "create_folder",
    parentFolderId: FOLDER_ID,
    name: "Cloud Smoke",
    subscribe: true,
    idempotencyKey: "folder-create-test",
  });
  expect(JSON.parse(result.stdout)).toMatchObject({ kind: "create_folder", state: "confirmed" });
});

test("message read uses an additive state command", async () => {
  let body: unknown;
  const server = withMailbox(async (request) => {
    if (request.method === "POST" && new URL(request.url).pathname === `/api/mail/mailboxes/${MAILBOX_ID}/commands`) {
      body = await request.json();
      return api({ ...mailCommand("queued"), kind: "change_message_state" });
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "message",
    "read",
    REMOTE_MESSAGE_REF_ID,
    "--mailbox",
    MAILBOX_ID,
    "--folder",
    FOLDER_ID,
    "--idempotency-key",
    "message-read-test",
  ]);

  expect(result.exitCode).toBe(0);
  expect(body).toEqual({
    kind: "change_message_state",
    remoteMessageRefId: REMOTE_MESSAGE_REF_ID,
    folderId: FOLDER_ID,
    change: { addFlags: ["seen"] },
    idempotencyKey: "message-read-test",
  });
});

test("conversation archive targets the configured semantic role", async () => {
  let body: unknown;
  const server = withMailbox(async (request) => {
    const expectedPath = `/api/mail/mailboxes/${MAILBOX_ID}/conversations/${CONVERSATION_ID}/actions`;
    if (request.method === "POST" && new URL(request.url).pathname === expectedPath) {
      body = await request.json();
      return api({ correlationId: "archive-correlation", commands: [{ ...mailCommand("queued"), kind: "move" }] });
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "conversation",
    "archive",
    CONVERSATION_ID,
    "--mailbox",
    MAILBOX_ID,
    "--source",
    FOLDER_ID,
    "--idempotency-key",
    "conversation-archive-test",
  ]);

  expect(result.exitCode).toBe(0);
  expect(body).toEqual({
    kind: "move_to_role",
    sourceFolderId: FOLDER_ID,
    role: "archive",
    idempotencyKey: "conversation-archive-test",
  });
  expect(JSON.parse(result.stdout)).toMatchObject({ correlationId: "archive-correlation", commands: [{ kind: "move" }] });
});

test("draft attachment add streams the exact local file at the expected revision", async () => {
  const path = `/tmp/cloud-mail-draft-attachment-${crypto.randomUUID()}.txt`;
  const bytes = Buffer.from("streamed draft attachment\n");
  await writeFile(path, bytes);
  temporaryFiles.push(path);
  let uploaded = Buffer.alloc(0);
  let query: URLSearchParams | undefined;
  const server = withMailbox(async (request) => {
    const expectedPath = `/api/mail/mailboxes/${MAILBOX_ID}/drafts/${DRAFT_ID}/attachments`;
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === expectedPath) {
      query = url.searchParams;
      uploaded = Buffer.from(await request.arrayBuffer());
      return api({
        id: DRAFT_ID,
        mailboxId: MAILBOX_ID,
        conversationId: null,
        senderIdentityId: IDENTITY_ID,
        to: [],
        cc: [],
        bcc: [],
        subject: "Attachment",
        body: "Body",
        format: "plain",
        attachments: [
          {
            id: ATTACHMENT_ID,
            filename: "upload.txt",
            contentType: "text/plain",
            byteLength: bytes.length,
            contentHash: "a".repeat(64),
            position: 0,
            createdAt: "2026-07-12T00:00:00.000Z",
          },
        ],
        revision: 4,
        state: "draft",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:01.000Z",
      });
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "draft",
    "attachment",
    "add",
    DRAFT_ID,
    path,
    "--mailbox",
    MAILBOX_ID,
    "--revision",
    "3",
    "--name",
    "upload.txt",
    "--content-type",
    "text/plain",
  ]);

  expect(result.exitCode).toBe(0);
  expect(uploaded).toEqual(bytes);
  expect(query?.get("expectedRevision")).toBe("3");
  expect(query?.get("filename")).toBe("upload.txt");
  expect(JSON.parse(result.stdout)).toMatchObject({ revision: 4, attachments: [{ id: ATTACHMENT_ID }] });
});

test("default sender setup preserves an existing display name when no name is passed", async () => {
  let body: unknown;
  const server = withMailbox(async (request) => {
    const expectedPath = `/api/mail/mailboxes/${MAILBOX_ID}/sender-identities/default/setup`;
    if (request.method === "POST" && new URL(request.url).pathname === expectedPath) {
      body = await request.json();
      return api({
        id: IDENTITY_ID,
        mailboxId: MAILBOX_ID,
        displayName: "Existing sender",
        fromAddress: "sender@example.com",
        replyTo: null,
        envelopeSender: null,
        authenticationPolicy: { interactive: "mailbox", automation: "disabled" },
        sentFolderId: FOLDER_ID,
        draftsFolderId: null,
        isDefault: true,
        status: "verified",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:01.000Z",
      });
    }
    return api({ message: "unexpected" }, { status: 500 });
  });
  servers.push(server);

  const result = await runCli(`http://127.0.0.1:${server.port}`, [
    "--json",
    "mail",
    "identity",
    "setup-default",
    CONNECTION_ID,
    "--mailbox",
    MAILBOX_ID,
  ]);

  expect(result.exitCode).toBe(0);
  expect(body).toEqual({ bindingId: CONNECTION_ID, savesSentAutomatically: false });
  expect(JSON.parse(result.stdout)).toMatchObject({ displayName: "Existing sender", status: "verified" });
});
