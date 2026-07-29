#!/usr/bin/env bun
/**
 * Mail browser regression smoke.
 *
 * The fixture is created through the authenticated API and seeded through the
 * Mail persistence boundary because no public API exists for receiving a
 * provider message. The exact mailbox is removed in finally.
 */
import { Readable } from "node:stream";
import { sql } from "bun";
import { type BrowserContext, chromium, type Locator, type Page } from "playwright";
import type { ConnectorEnvelope } from "../src/service/connectors";
import { hydrateMessageFromSource } from "../src/service/message-hydration";
import { ingestEnvelope } from "../src/service/sync-runtime";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin";
const SESSION_TOKEN = process.env.SESSION_TOKEN;
const HEADLESS = process.env.HEADLESS !== "0";
const KEEP = process.env.KEEP === "1";
const TIMEOUT = Number(process.env.BROWSER_SMOKE_TIMEOUT_MS ?? 20_000);

type Fixture = {
  sessionToken: string;
  mailboxId: string;
  mailboxName: string;
  conversationId: string;
  messageId: string;
  subject: string;
};

let createdMailboxId: string | null = null;

const ok = (message: string) => console.log(`✓ ${message}`);
const fail = (message: string): never => {
  throw new Error(message);
};

const assertLocalTarget = () => {
  const url = new URL(BASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    fail(`browser smoke only runs against a local loopback URL, received ${url.origin}`);
  }
};

const api = async <T>(
  method: string,
  path: string,
  body?: unknown,
  sessionToken?: string,
  expected = method === "DELETE" ? 204 : 200,
): Promise<T> => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await response.text();
  if (response.status !== expected) {
    fail(`${method} ${path} expected ${expected}, got ${response.status}: ${text.slice(0, 800)}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
};

const login = async (): Promise<string> => {
  if (SESSION_TOKEN) return SESSION_TOKEN;
  const result = await api<{ session_token: string }>("POST", "/api/auth/admin-login", { token: ADMIN_TOKEN });
  if (!result.session_token) fail("admin-login returned no session token");
  return result.session_token;
};

const createFixture = async (): Promise<Fixture> => {
  const sessionToken = await login();
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const subject = `Mail browser smoke ${suffix}`;
  const mailboxName = `Mail browser smoke ${suffix}`;
  const mailbox = await api<{ id: string }>(
    "POST",
    "/api/mail/mailboxes",
    {
      name: mailboxName,
      description: "Disposable browser regression fixture",
    },
    sessionToken,
  );
  createdMailboxId = mailbox.id;
  const scope = "a".repeat(64);

  const [connection] = await sql<{ id: string }[]>`
    INSERT INTO mail.provider_connections (
      owner_mailbox_id, name, email, username, imap_host, imap_port,
      imap_tls_mode, smtp_host, smtp_port, smtp_tls_mode, secret_kind,
      encrypted_secret, authenticated_principal, capabilities, server_identity,
      last_verified_at
    ) VALUES (
      ${mailbox.id}::uuid, 'Browser fixture', 'sender@example.test',
      'sender@example.test', 'imap.example.test', 993, 'implicit',
      'smtp.example.test', 587, 'starttls', 'password', 'browser-fixture',
      'sender@example.test', '{}'::jsonb, '{}'::jsonb, now()
    )
    RETURNING id
  `;
  const [resource] = await sql<{ id: string }[]>`
    INSERT INTO mail.remote_resources (
      mailbox_id, remote_locator, server_identity, scope_fingerprint, status
    ) VALUES (
      ${mailbox.id}::uuid, '{}'::jsonb, '{}'::jsonb, ${scope}, 'active'
    )
    RETURNING id
  `;
  const [binding] = await sql<{ id: string }[]>`
    INSERT INTO mail.provider_bindings (
      remote_resource_id, connection_id, state, remote_locator, capabilities,
      rights, verification_evidence, verified_scope_fingerprint,
      last_verified_at
    ) VALUES (
      ${resource!.id}::uuid, ${connection!.id}::uuid, 'active', '{}'::jsonb,
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, ${scope}, now()
    )
    RETURNING id
  `;
  // The smoke owns the mailbox health state; background sync must not race its assertions.
  const [folder] = await sql<{ id: string }[]>`
    INSERT INTO mail.folders (
      remote_resource_id, stable_key, name, role, selected_for_sync, sync_status
    ) VALUES (
      ${resource!.id}::uuid, 'browser-inbox', 'Inbox', 'inbox', false, 'current'
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO mail.binding_folder_refs (
      binding_id, folder_id, remote_path, uid_validity, uid_next,
      effective_rights, last_verified_at
    ) VALUES (
      ${binding!.id}::uuid, ${folder!.id}::uuid, 'INBOX', 1, 2,
      ARRAY['read', 'write_flags', 'insert', 'move', 'delete_messages']::text[],
      now()
    )
  `;
  const [identity] = await sql<{ id: string }[]>`
    INSERT INTO mail.sender_identities (
      mailbox_id, label, display_name, from_address, automation_policy,
      is_default, status
    ) VALUES (
      ${mailbox.id}::uuid, 'Browser fixture', 'Browser Fixture',
      'sender@example.test', 'disabled', true, 'verified'
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO mail.sender_identity_bindings (
      sender_identity_id, binding_id, provider_principal, verified_at,
      saves_sent_automatically
    ) VALUES (
      ${identity!.id}::uuid, ${binding!.id}::uuid, 'sender@example.test',
      now(), true
    )
  `;
  await sql`
    UPDATE mail.mailboxes
    SET
      health = 'degraded',
      health_reason = 'Failed to establish connection in required time',
      updated_at = now()
    WHERE id = ${mailbox.id}::uuid
  `;

  const internalDate = new Date();
  const envelope: ConnectorEnvelope = {
    remoteRef: {
      folderStableKey: "browser-inbox",
      uidValidity: "1",
      uid: "1",
      modseq: "1",
    },
    providerMessageId: null,
    providerThreadId: null,
    messageId: `<mail-browser-${suffix}@example.test>`,
    inReplyTo: null,
    references: [],
    subject,
    sentAt: internalDate,
    internalDate,
    sizeBytes: 256,
    flags: [],
    labels: [],
    addresses: {
      from: [{ name: "Customer", address: "customer@example.test" }],
      replyTo: [],
      to: [{ name: "Browser Fixture", address: "sender@example.test" }],
      cc: [],
      bcc: [],
    },
    mimeStructure: {},
  };
  const messageId = await ingestEnvelope({
    db: sql,
    mailboxId: mailbox.id,
    remoteResourceId: resource!.id,
    folderId: folder!.id,
    message: envelope,
    captureWorkflowTriggers: false,
  });
  const messageBody = [
    "Please confirm that the reply composer stays focused.",
    "",
    ...Array.from(
      { length: 24 },
      (_, index) =>
        `Operational note ${index + 1}: keep the message readable in the conversation without introducing a nested vertical scrollbar.`,
    ),
    "",
    "> Previous message content remains available on demand.",
  ].join("\r\n");
  const source = Buffer.from(
    [
      `Message-ID: ${envelope.messageId}`,
      `Date: ${internalDate.toUTCString()}`,
      "From: Customer <customer@example.test>",
      "To: Browser Fixture <sender@example.test>",
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      messageBody,
    ].join("\r\n"),
  );
  await hydrateMessageFromSource({
    messageId,
    source: Readable.from([source]),
    expectedSize: source.byteLength,
  });
  const [conversation] = await sql<{ id: string }[]>`
    SELECT conversation_id AS id
    FROM mail.conversation_messages
    WHERE message_id = ${messageId}::uuid
  `;
  if (!conversation) fail("fixture message has no conversation");
  ok("fixture created");
  return {
    sessionToken,
    mailboxId: mailbox.id,
    mailboxName,
    conversationId: conversation.id,
    messageId,
    subject,
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
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500 && !response.url().includes("/favicon")) {
      errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });
};

const expectUrl = async (page: Page, predicate: (url: URL) => boolean, label: string) => {
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    if (predicate(new URL(page.url()))) {
      ok(label);
      return;
    }
    await page.waitForTimeout(50);
  }
  fail(`timed out waiting for ${label}; current URL is ${page.url()}`);
};

const clickHydratedDropdownTrigger = async (page: Page, locator: Locator) => {
  await locator.waitFor();
  const element = await locator.elementHandle();
  if (!element) fail("interactive control disappeared before hydration");
  await page.waitForFunction((control) => (control as HTMLElement).getAttribute("aria-haspopup") === "menu", element);
  await locator.click();
};

const continueDraft = async (page: Page) => {
  const dialog = page.getByRole("dialog").filter({ hasText: "Continue a draft?" });
  await dialog.getByText("Continue", { exact: true }).first().click();
};

const assertMailboxToolsMenu = async (menu: Locator) => {
  const sectionLabels = (await menu.locator(".menu-label").allTextContents()).map((label) => label.trim());
  const expectedSections = ["Mailbox", "Automation", "Manage", "This browser"];
  if (JSON.stringify(sectionLabels) !== JSON.stringify(expectedSections)) {
    fail(`mailbox tools sections are not stable: ${JSON.stringify(sectionLabels)}`);
  }
  for (const item of [
    "Sync mailbox",
    "Mailbox health",
    "Automations",
    "Sender rules",
    "Subscriptions",
    "Remote images",
    "Shared links",
    "Open email links with Cloud Mail",
  ]) {
    await menu.getByText(item, { exact: true }).waitFor();
  }
};

const runSmoke = async (fixture: Fixture) => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
  });
  await addSessionCookie(context, fixture.sessionToken);
  const errors: string[] = [];
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  watchPage(page, errors);

  try {
    const mailboxPath = `/app/mail/${fixture.mailboxId}`;
    await page.goto(`/app/mail?q=${encodeURIComponent(fixture.mailboxName)}`, { waitUntil: "domcontentloaded" });
    await page.getByText(fixture.mailboxName, { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        typeof (document.querySelector('[aria-label="Search mailboxes"]') as HTMLInputElement & { $$input?: unknown })?.$$input ===
        "function",
    );
    const mailboxSearch = page.getByRole("searchbox", { name: "Search mailboxes" });
    const literalWildcardQuery = `%${fixture.mailboxName}%`;
    await mailboxSearch.fill(literalWildcardQuery);
    await expectUrl(page, (url) => url.searchParams.get("q") === literalWildcardQuery, "mailbox search updates the URL");
    await page.getByText("No matching mailboxes", { exact: true }).waitFor();
    await mailboxSearch.fill(fixture.mailboxName);
    await page.getByText(fixture.mailboxName, { exact: true }).waitFor();
    ok("mailbox search uses server-owned literal matching");

    await page.goto(mailboxPath, { waitUntil: "domcontentloaded" });
    await clickHydratedDropdownTrigger(page, page.getByRole("button", { name: "Choose list view", exact: true }));
    await page.locator('[role="menu"]:popover-open').getByText("Message view", { exact: true }).click();
    await page
      .locator('[role="list"][aria-label$=" messages"]')
      .waitFor()
      .catch(async () => fail(`message view did not load\n${(await page.locator("body").innerText()).slice(-2_000)}`));
    const messageViewCookie = (await context.cookies()).find((cookie) => cookie.name === "cloud_mail_workspace");
    const messageViewPreference = messageViewCookie ? JSON.parse(decodeURIComponent(messageViewCookie.value)) : null;
    if (messageViewPreference?.listMode !== "messages") fail("message view was not persisted in the workspace cookie");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[role="list"][aria-label$=" messages"]').waitFor();
    await clickHydratedDropdownTrigger(page, page.getByRole("button", { name: "Choose list view", exact: true }));
    await page.locator('[role="menu"]:popover-open').getByText("Conversation view", { exact: true }).click();
    await page.locator('[role="list"][aria-label$=" conversations"]').waitFor();
    ok("message list mode survives SSR reload and returns to conversation view");

    const desktopSidebar = page.locator(".workspace-sidebar");
    const desktopDirectActions = (await desktopSidebar.locator(".sidebar-footer > button, .sidebar-footer > a").allTextContents()).map(
      (label) => label.trim(),
    );
    if (desktopDirectActions.some((label) => label.includes("Sync mailbox") || label.includes("Automations"))) {
      fail(`desktop sidebar still exposes standalone mailbox tools: ${JSON.stringify(desktopDirectActions)}`);
    }
    if (!desktopDirectActions.includes("Settings")) fail("desktop sidebar lost its direct Settings action");
    await desktopSidebar.getByRole("button", { name: "Mailbox tools", exact: true }).click();
    const desktopToolsMenu = page.locator('[role="menu"]:popover-open');
    await assertMailboxToolsMenu(desktopToolsMenu);
    await desktopToolsMenu.getByText("Automations", { exact: true }).click();
    await expectUrl(
      page,
      (url) => url.pathname === `/app/mail/${fixture.mailboxId}/automations`,
      "mailbox tools open the automation workspace",
    );
    await page.goto(`${mailboxPath}/automations/rules?new=1`, { waitUntil: "domcontentloaded" });
    const ruleDialog = page.getByRole("dialog").filter({ hasText: "Create mail rule" });
    const ruleValue = ruleDialog.getByRole("textbox", { name: "Value", exact: true });
    await ruleValue.pressSequentially("focus-stays");
    if ((await ruleValue.inputValue()) !== "focus-stays") fail("mail rule condition input lost keystrokes");
    if (!(await ruleValue.evaluate((input) => document.activeElement === input))) {
      fail("mail rule condition input lost focus while typing");
    }
    ok("mail rule condition input preserves focus while updating immutable state");
    await page.goto(mailboxPath, { waitUntil: "domcontentloaded" });

    await page.setViewportSize({ width: 390, height: 812 });
    const mobileSidebar = page.locator(".workspace-sidebar-mobile");
    await mobileSidebar.locator("summary.sidebar-mobile-toggle").click();
    const mobileDirectActions = (
      await mobileSidebar.locator(".sidebar-mobile-actions > button, .sidebar-mobile-actions > a").allTextContents()
    ).map((label) => label.trim());
    if (mobileDirectActions.some((label) => label.includes("Automations"))) {
      fail(`mobile sidebar still exposes standalone Automations: ${JSON.stringify(mobileDirectActions)}`);
    }
    if (!mobileDirectActions.includes("Settings")) fail("mobile sidebar lost its direct Settings action");
    await mobileSidebar.getByRole("button", { name: "Mailbox tools", exact: true }).click();
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await assertMailboxToolsMenu(page.locator('[role="menu"]:popover-open'));
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.keyboard.press("Escape");
    await mobileSidebar.locator("summary.sidebar-mobile-toggle").click();
    await page.setViewportSize({ width: 1440, height: 900 });
    ok("mailbox tools consolidate sync and automation navigation on desktop and mobile");

    const healthNotice = page.locator('[data-mailbox-health="degraded"]');
    await healthNotice.getByText("Mail is taking longer to connect.", { exact: false }).waitFor();
    if (await healthNotice.getByText("Check its provider settings.", { exact: false }).isVisible()) {
      fail("degraded mailbox health still points users at valid provider settings");
    }
    await healthNotice.getByRole("button", { name: "View status", exact: true }).click();
    const healthDialog = page.getByRole("dialog").filter({ hasText: "Mailbox health" });
    await healthDialog.getByText("Failed to establish connection in required time", { exact: true }).waitFor();
    await healthDialog.getByRole("button", { name: "close dialog", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("region", { name: "Mailbox settings" });
    await settings.getByRole("tab", { name: "Delivery", exact: true }).click();
    await settings.getByText("The saved account is valid, but the latest synchronization timed out.", { exact: false }).waitFor();
    await settings.getByRole("button", { name: "Close settings", exact: true }).click();
    ok("mailbox health explains the runtime problem in the workspace, diagnostics, and settings");

    const conversation = page.getByTitle(new RegExp(`${fixture.subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await conversation.waitFor({ state: "visible" });
    await conversation.click();
    await expectUrl(
      page,
      (url) => url.searchParams.get("conversation") === fixture.conversationId,
      "conversation navigation updates the URL",
    );
    const messageCard = page.locator(`[data-mail-message-id="${fixture.messageId}"]`);
    await messageCard.getByText("Please confirm that the reply composer stays focused.", { exact: false }).waitFor();
    if ((await messageCard.getAttribute("data-mail-direction")) !== "incoming") fail("incoming message direction is not exposed");
    const readerScroll = page.locator(`[data-scroll-preserve="mail-reader-${fixture.conversationId}"]`);
    const readerState = await readerScroll.evaluate((element) => {
      const message = element.querySelector<HTMLElement>("[data-mail-message-id]");
      const body = element.querySelector<HTMLElement>(".mail-message-body");
      if (!message || !body) return null;
      return {
        messageOffset: Math.round(message.getBoundingClientRect().top - element.getBoundingClientRect().top),
        nestedVerticalScroll: body.scrollHeight > body.clientHeight + 1,
      };
    });
    if (!readerState || readerState.messageOffset < -1 || readerState.messageOffset > 24)
      fail(`long message did not open at its header: ${JSON.stringify(readerState)}`);
    if (readerState.nestedVerticalScroll) fail("long message body introduced a nested vertical scrollbar");
    await page.getByText("Show quoted text", { exact: true }).click();
    await page.getByText("Previous message content remains available on demand.", { exact: false }).waitFor();
    ok("long messages open at the header and reveal quoted text without nested scrolling");
    const readerHasHistory = await readerScroll.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
      return element.scrollHeight - element.clientHeight > 96;
    });
    if (!readerHasHistory) fail("long-message fixture did not create a meaningful reader scroll range");

    await page.getByRole("button", { name: "More conversation actions", exact: true }).click();
    const conversationMenu = page.locator('[role="menu"]:popover-open');
    if ((await conversationMenu.getByText("Split conversation from latest message", { exact: true }).count()) !== 0) {
      fail("a one-message conversation exposed a split action");
    }
    await conversationMenu.getByText("Customize toolbar", { exact: true }).click();
    const toolbarDialog = page.getByRole("dialog").filter({ hasText: "Customize toolbar" });
    for (const section of ["Respond", "Organize", "Mark", "Conversation", "Other"]) {
      await toolbarDialog.getByText(section, { exact: true }).waitFor();
    }
    await toolbarDialog
      .locator("label")
      .filter({ hasText: /^Delete/u })
      .locator('input[type="checkbox"]')
      .uncheck();
    await toolbarDialog.locator("label").filter({ hasText: /^Tags/u }).locator('input[type="checkbox"]').check();
    await toolbarDialog
      .locator("label")
      .filter({ hasText: /^Split conversation/u })
      .locator('input[type="checkbox"]')
      .check();
    await toolbarDialog.getByRole("button", { name: "Save toolbar", exact: true }).click();
    await page.waitForTimeout(250);
    const tagsToolbarAction = page.locator('[data-mail-toolbar-action="tags"]');
    if ((await tagsToolbarAction.count()) === 0) {
      const workspaceCookie = (await context.cookies()).find((cookie) => cookie.name === "cloud_mail_workspace");
      fail(`saved Tags action did not reach the toolbar; workspace cookie: ${workspaceCookie?.value ?? "(missing)"}`);
    }
    await tagsToolbarAction.waitFor();
    await page.locator('[data-mail-toolbar-section="respond"]').waitFor();
    await page.locator('[data-mail-toolbar-section="organize"]').waitFor();
    await page.locator('[data-mail-toolbar-section="mark"]').waitFor();
    if ((await page.locator('[data-mail-toolbar-action="split"]').count()) !== 0) {
      fail("the configured split action ignored one-message availability");
    }
    if ((await page.locator('[data-mail-toolbar-action="trash"]').count()) !== 0) {
      fail("removed toolbar action remained visible");
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await tagsToolbarAction.waitFor();
    if ((await page.locator('[data-mail-toolbar-action="trash"]').count()) !== 0) {
      fail("removed toolbar action returned after SSR reload");
    }
    await page.setViewportSize({ width: 390, height: 812 });
    if (await tagsToolbarAction.isVisible()) fail("direct toolbar actions crowd the compact conversation header");
    const compactOverflow = page.getByRole("button", { name: "More conversation actions", exact: true });
    await compactOverflow.click();
    const compactMenu = page.locator('[role="menu"]:popover-open');
    await compactMenu.getByText("Tags", { exact: true }).waitFor();
    await compactMenu.getByText("Customize toolbar", { exact: true }).waitFor();
    await compactMenu.getByText("Customize toolbar", { exact: true }).click();
    const compactToolbarDialog = page.getByRole("dialog").filter({ hasText: "Customize toolbar" });
    const compactDialogBounds = await compactToolbarDialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    if (
      compactDialogBounds.left < 0 ||
      compactDialogBounds.right > compactDialogBounds.viewportWidth ||
      compactDialogBounds.top < 0 ||
      compactDialogBounds.bottom > compactDialogBounds.viewportHeight
    ) {
      fail(`compact toolbar dialog escaped the viewport: ${JSON.stringify(compactDialogBounds)}`);
    }
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await compactToolbarDialog.getByText("Split conversation", { exact: true }).waitFor();
    await compactToolbarDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await tagsToolbarAction.waitFor();
    ok("conversation toolbar customization survives SSR reload");

    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await expectUrl(
      page,
      (url) => new RegExp(`/app/mail/${fixture.mailboxId}/compose/local/[^/]+$`).test(url.pathname),
      "reply opens a local draft seed without persisting an untouched draft",
    );
    const [untouchedDraftCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM mail.drafts
      WHERE mailbox_id = ${fixture.mailboxId}::uuid
    `;
    if (untouchedDraftCount?.count !== 0) {
      fail(`opening an untouched reply persisted ${untouchedDraftCount?.count ?? "unknown"} drafts`);
    }
    const body = page.getByRole("combobox", { name: "Message body" });
    await body.waitFor({ state: "visible" }).catch(async () => {
      fail(`reply composer did not open\n${errors.join("\n")}\n${(await page.locator("body").innerText()).slice(-2_000)}`);
    });
    const materializeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/mail\/mailboxes\/[^/]+\/draft-seeds\/materialize$/.test(new URL(response.url()).pathname),
    );
    await body.click();
    await body.pressSequentially("A");
    if (!(await body.evaluate((element) => document.activeElement === element))) {
      fail("message body lost focus after the first keystroke");
    }
    if (await page.getByText("Draft recovered", { exact: true }).isVisible()) {
      fail("a fresh reply reported a recovered draft after the first keystroke");
    }
    await body.pressSequentially(" stable reply");
    if ((await body.inputValue()) !== "A stable reply") {
      fail(`reply body changed unexpectedly: ${await body.inputValue()}`);
    }
    ok("reply keeps focus and content across the first keystroke");

    const materialized = (await (await materializeResponse).json()) as { id?: unknown };
    if (typeof materialized.id !== "string") fail("materialized reply returned no draft id");
    await expectUrl(
      page,
      (url) => url.pathname === `/app/mail/${fixture.mailboxId}/compose/${materialized.id}`,
      "meaningful input promotes the local seed to its canonical draft route",
    );
    await page.getByRole("button", { name: "Back to mailbox" }).click();
    await body.waitFor({ state: "detached" });
    await expectUrl(
      page,
      (url) => url.pathname === mailboxPath && url.searchParams.get("conversation") === fixture.conversationId,
      "composer returns to the originating conversation",
    );
    ok("draft saves and the focused composer closes cleanly");

    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await continueDraft(page);
    await expectUrl(
      page,
      (url) => new RegExp(`/app/mail/${fixture.mailboxId}/compose/[^/]+$`).test(url.pathname),
      "existing reply reopens its canonical draft route",
    );
    await body.waitFor({ state: "visible" });
    await body.click();
    await body.pressSequentially(" recovered locally");
    await page.reload({ waitUntil: "domcontentloaded" });
    await body.waitFor({ state: "visible" }).catch(async () => {
      fail(`composer did not recover after reload at ${page.url()}\n${(await page.locator("body").innerText()).slice(-2_000)}`);
    });
    await page.getByText("Draft recovered", { exact: true }).waitFor();
    if (!(await body.inputValue()).endsWith(" recovered locally")) {
      fail(`recovered draft body is incomplete: ${await body.inputValue()}`);
    }
    await page.getByRole("button", { name: "Back to mailbox" }).click();
    await body.waitFor({ state: "detached" });
    await expectUrl(
      page,
      (url) => url.pathname === mailboxPath && url.searchParams.get("conversation") === fixture.conversationId,
      "recovered composer returns to the conversation",
    );
    ok("local draft recovery survives a page lifecycle");
    await page.getByText(fixture.subject, { exact: true }).first().waitFor();

    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await continueDraft(page);
    await body.waitFor({ state: "visible" });
    const sendResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && /\/api\/mail\/mailboxes\/[^/]+\/commands$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    const sendAnyway = page.getByRole("button", { name: "Send anyway", exact: true });
    await sendAnyway
      .waitFor({ state: "visible", timeout: 1_000 })
      .then(() => sendAnyway.click())
      .catch(() => undefined);
    await sendResponse;
    await body.waitFor({ state: "detached" }).catch(async () => {
      fail(
        `composer did not close after send at ${page.url()}\n${errors.join("\n")}\n${(await page.locator("body").innerText()).slice(-2_000)}`,
      );
    });
    await expectUrl(
      page,
      (url) => url.pathname === mailboxPath && url.searchParams.get("conversation") === fixture.conversationId,
      "sent reply returns to its conversation",
    );
    const newMessageJump = page.getByRole("button", { name: "1 new message", exact: true });
    if (await newMessageJump.isVisible()) await newMessageJump.click();
    await page.locator('[data-mail-direction="outgoing"]').waitFor();
    if ((await page.locator('[data-mail-direction="outgoing"]').count()) !== 1) {
      fail("the queued reply did not appear as an outgoing message");
    }
    await page.locator('[data-mail-toolbar-action="split"]').waitFor();
    await page.locator('[data-mail-toolbar-section="conversation"]').waitFor();
    ok("split action becomes available when the conversation has multiple messages");
    const outgoingMessage = page.locator('[data-mail-direction="outgoing"]');
    const undoSend = outgoingMessage.locator("[data-mail-undo-send]");
    await undoSend.waitFor();
    const firstUndoLabel = (await undoSend.textContent())?.trim() ?? "";
    const firstUndoSeconds = Number(firstUndoLabel.match(/Undo send · (\d+)s/u)?.[1]);
    if (!Number.isInteger(firstUndoSeconds) || firstUndoSeconds < 2) {
      fail(`undo-send countdown did not expose a usable server deadline: ${JSON.stringify(firstUndoLabel)}`);
    }
    if (await outgoingMessage.getByText("Queued", { exact: true }).isVisible()) {
      fail("undo-window delivery still exposes the internal queued status");
    }
    await page.waitForTimeout(1_100);
    const nextUndoLabel = (await undoSend.textContent())?.trim() ?? "";
    const nextUndoSeconds = Number(nextUndoLabel.match(/Undo send · (\d+)s/u)?.[1]);
    if (!Number.isInteger(nextUndoSeconds) || nextUndoSeconds >= firstUndoSeconds) {
      fail(`undo-send countdown did not advance: ${JSON.stringify({ firstUndoLabel, nextUndoLabel })}`);
    }
    ok("undo window is one compact countdown action without a queued badge");
    if ((await messageCard.locator("[data-mail-direct-actions]").count()) !== 0) {
      fail("an older message still exposes direct response actions");
    }
    await messageCard.getByRole("button", { name: "Message actions", exact: true }).click();
    const openMessageMenu = page.locator('[role="menu"]:popover-open');
    await openMessageMenu.waitFor();
    const openMessageMenuText = await openMessageMenu.innerText();
    if (!openMessageMenuText.split("\n").includes("Reply")) {
      fail(`an older message lost its Reply action from the message menu: ${openMessageMenuText}`);
    }
    await page.keyboard.press("Escape");
    ok("older message response actions move into the message menu");
    ok("saved reply queues, returns to the conversation, and announces its live append");
    await undoSend.waitFor({ state: "detached", timeout: (firstUndoSeconds + 3) * 1000 });
    ok("undo action disappears when the server undo deadline expires");

    const mailto = "mailto:recipient@example.test?subject=Browser%20mailto&body=Created%20from%20an%20email%20link";
    await page.goto(`/app/mail/compose?mailbox=${fixture.mailboxId}&mailto=${encodeURIComponent(mailto)}`, {
      waitUntil: "domcontentloaded",
    });
    const continueIntent = page.getByRole("button", { name: "Continue", exact: true });
    await continueIntent.waitFor();
    const [draftCountBeforeMailto] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM mail.drafts
      WHERE mailbox_id = ${fixture.mailboxId}::uuid
    `;
    await continueIntent.click();
    await expectUrl(
      page,
      (url) => new RegExp(`/app/mail/${fixture.mailboxId}/compose/local/[^/]+$`).test(url.pathname),
      "mailto opens a local draft seed",
    );
    const [draftCountAfterMailto] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM mail.drafts
      WHERE mailbox_id = ${fixture.mailboxId}::uuid
    `;
    if (draftCountAfterMailto?.count !== draftCountBeforeMailto?.count) {
      fail("opening an untouched mailto intent persisted a draft");
    }
    await page.getByRole("button", { name: "Remove recipient@example.test", exact: true }).waitFor();
    if ((await page.getByRole("textbox", { name: "Subject" }).inputValue()) !== "Browser mailto") {
      fail("mailto subject was not preserved");
    }
    const mailtoBody = await body.inputValue();
    if (!mailtoBody.startsWith("Created from an email link")) fail(`mailto body was not preserved: ${JSON.stringify(mailtoBody)}`);
    const editedMailtoBody = `${mailtoBody}\nAcceptance edit`;
    const mailtoMaterializeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/mail\/mailboxes\/[^/]+\/draft-seeds\/materialize$/.test(new URL(response.url()).pathname),
    );
    await body.fill(editedMailtoBody);
    const materializedMailto = (await (await mailtoMaterializeResponse).json()) as { id?: unknown };
    if (typeof materializedMailto.id !== "string") fail("materialized mailto draft returned no draft id");
    await expectUrl(
      page,
      (url) => url.pathname === `/app/mail/${fixture.mailboxId}/compose/${materializedMailto.id}`,
      "editing mailto content promotes it to a canonical draft",
    );
    const storedMailtoBody = await page.evaluate(
      async ({ mailboxId, draftId }) => {
        const response = await fetch(`/api/mail/mailboxes/${mailboxId}/drafts/${draftId}`);
        return ((await response.json()) as { body?: unknown }).body;
      },
      { mailboxId: fixture.mailboxId, draftId: materializedMailto.id },
    );
    if (storedMailtoBody !== editedMailtoBody) {
      fail(`stored mailto draft did not preserve the body: ${JSON.stringify(storedMailtoBody)}`);
    }
    await page.getByRole("button", { name: "Discard draft", exact: true }).click();
    const discardDialog = page.getByRole("dialog").filter({ hasText: "Discard draft?" });
    await discardDialog.getByRole("button", { name: "Discard draft", exact: true }).click();
    await expectUrl(page, (url) => url.pathname === mailboxPath, "discarded mailto draft returns to its mailbox");
    ok("mailto intent selects mailbox and sender without bypassing the ordinary draft lifecycle");

    if (errors.length > 0) fail(`browser errors:\n${errors.join("\n")}`);
    ok("browser smoke complete");
  } finally {
    await context.close();
    await browser.close();
  }
};

const cleanup = async (fixture: Fixture | null) => {
  const mailboxId = fixture?.mailboxId ?? createdMailboxId;
  if (!mailboxId || KEEP) return;
  await sql.begin(async (tx) => {
    const accessRows = await tx<{ access_id: string }[]>`
      SELECT access_id
      FROM mail.mailbox_access
      WHERE mailbox_id = ${mailboxId}::uuid
    `;
    await tx`
      DELETE FROM mail.mailboxes
      WHERE id = ${mailboxId}::uuid
    `;
    for (const access of accessRows) {
      await tx`
        DELETE FROM auth.access
        WHERE id = ${access.access_id}::uuid
      `;
    }
    const [remainingMailbox] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM mail.mailboxes
      WHERE id = ${mailboxId}::uuid
    `;
    if (!remainingMailbox || remainingMailbox.count !== 0) fail(`fixture cleanup incomplete for mailbox ${mailboxId}`);
    for (const access of accessRows) {
      const [remainingAccess] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM auth.access
        WHERE id = ${access.access_id}::uuid
      `;
      if (!remainingAccess || remainingAccess.count !== 0) {
        fail(`fixture cleanup incomplete for access ${access.access_id}`);
      }
    }
  });
  createdMailboxId = null;
  ok("fixture removed");
};

let fixture: Fixture | null = null;
try {
  assertLocalTarget();
  fixture = await createFixture();
  await runSmoke(fixture);
} catch (error) {
  console.error(`\nMail browser smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup(fixture).catch((error) => {
    console.error(`fixture cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
