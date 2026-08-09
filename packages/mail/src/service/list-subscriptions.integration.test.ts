import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { grantMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import { applyMailingListDisposition, listSubscriptions, requestUnsubscribe } from "./list-subscriptions";
import { createMailbox } from "./mailboxes";
import { EMPTY_MESSAGE_PROTOCOL_FACTS } from "./message-protocol";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

const contextFor = (user: { id: string; uid: string }): MailRequestContext => ({
  actor: {
    kind: "user",
    user: {
      id: user.id,
      uid: user.uid,
      provider: "local",
      profile: "user",
      displayName: user.uid,
      givenName: "Mail",
      sn: "Test",
      mail: `${user.uid}@example.test`,
      roles: ["user"],
      memberofGroupIds: [],
      memberofGroups: [],
    } as never,
  },
  accessSubject: { type: "user", userId: user.id },
  requestId: `mail-list-subscription-${user.uid}`,
});

suite("mailing-list subscriptions", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  let mailboxId = "";
  let ownerContext: MailRequestContext;
  let readerContext: MailRequestContext;
  let outsiderContext: MailRequestContext;

  beforeAll(async () => {
    await migrate();
    const createUser = async (label: string) => {
      const uid = `mail-list-${label}-${suffix}`;
      const [user] = await sql<{ id: string }[]>`
        INSERT INTO auth.users (uid, provider, profile, display_name, admin)
        VALUES (${uid}, 'local', 'user', ${uid}, false)
        RETURNING id
      `;
      if (!user) throw new Error("Failed to create mailing-list test user");
      userIds.push(user.id);
      return { id: user.id, uid };
    };
    ownerContext = contextFor(await createUser("owner"));
    const reader = await createUser("reader");
    readerContext = contextFor(reader);
    outsiderContext = contextFor(await createUser("outsider"));
    const mailbox = await createMailbox(ownerContext, { name: `Lists ${suffix}` });
    if (!mailbox.ok) throw new Error(mailbox.error.message);
    mailboxId = mailbox.data.id;
    const access = await grantMailboxAccess({
      context: ownerContext,
      mailboxId,
      principal: { type: "user", userId: reader.id },
      permission: "read",
    });
    if (!access.ok) throw new Error(access.error.message);

    for (const [index, listId] of ["Updates <updates.example.test>", "Alerts <alerts.example.test>"].entries()) {
      const protocolFacts = {
        ...EMPTY_MESSAGE_PROTOCOL_FACTS,
        list: {
          ...EMPTY_MESSAGE_PROTOCOL_FACTS.list,
          id: listId,
          unsubscribe: [`https://lists.example.test/${index}/unsubscribe`],
          unsubscribePost: "List-Unsubscribe=One-Click",
          post: [`mailto:${index}@example.test`],
          help: [`https://lists.example.test/${index}/help`],
          archive: [`https://lists.example.test/${index}/archive`],
        },
      };
      await sql`
        INSERT INTO mail.message_contents (
          mailbox_id, message_id, subject, internal_date, size_bytes, content_hash,
          hydration_status, protocol_facts
        ) VALUES (
          ${mailboxId}::uuid,
          ${`<list-${index}-${suffix}@example.test>`},
          ${`List fixture ${index}`},
          ${new Date(Date.now() - index * 60_000)},
          128,
          ${`${index}`.repeat(64)},
          'complete',
          ${protocolFacts}::jsonb
        )
      `;
    }
  });

  afterAll(async () => {
    if (mailboxId) {
      const access = await sql<{ access_id: string }[]>`
        SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${mailboxId}::uuid
      `;
      await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
      if (access.length > 0) {
        await sql`
          DELETE FROM auth.access
          WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${access.map((item) => item.access_id)}::jsonb))
        `;
      }
    }
    if (userIds.length > 0) {
      await sql`
        DELETE FROM auth.users
        WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${userIds}::jsonb))
      `;
    }
  });

  test("paginates by cursor and fails closed outside the mailbox", async () => {
    const first = await listSubscriptions({ context: ownerContext, mailboxId, limit: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.items).toHaveLength(1);
    expect(first.data.nextCursor).not.toBeNull();

    const second = await listSubscriptions({
      context: ownerContext,
      mailboxId,
      cursor: first.data.nextCursor ?? undefined,
      limit: 1,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.items).toHaveLength(1);

    const focused = await listSubscriptions({
      context: ownerContext,
      mailboxId,
      focusedListKey: "alerts.example.test",
      limit: 1,
    });
    expect(focused.ok).toBe(true);
    if (focused.ok) {
      expect(focused.data.items.map((item) => item.listKey)).toEqual(["alerts.example.test", "updates.example.test"]);
      expect(focused.data.nextCursor).not.toBeNull();
    }

    const denied = await listSubscriptions({ context: outsiderContext, mailboxId });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.status).toBe(403);
  });

  test("executes a verified one-click endpoint only once", async () => {
    let requestCount = 0;
    const current = await listSubscriptions({ context: ownerContext, mailboxId });
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    const subscription = current.data.items.find((item) => item.listKey === "updates.example.test");
    expect(subscription?.unsubscribe?.kind).toBe("one_click");
    if (!subscription?.unsubscribe) return;

    const request = () => {
      requestCount += 1;
      return Promise.resolve({ statusCode: 204, location: null });
    };
    const lookup = async () => [{ address: "93.184.216.34", family: 4 as const }];
    const input = {
      listKey: subscription.listKey,
      href: subscription.unsubscribe.href,
    };
    const first = await requestUnsubscribe({ context: ownerContext, mailboxId, input }, { request, lookup });
    const second = await requestUnsubscribe({ context: ownerContext, mailboxId, input }, { request, lookup });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(requestCount).toBe(1);
    if (first.ok && second.ok) expect(second.data.requestedAt).toBe(first.data.requestedAt);
  });

  test("lets readers inspect lists but not change subscriptions or messages", async () => {
    const visible = await listSubscriptions({ context: readerContext, mailboxId });
    expect(visible.ok).toBe(true);
    if (!visible.ok) return;
    const subscription = visible.data.items[0];
    expect(subscription).toBeDefined();
    if (!subscription?.unsubscribe) return;

    const unsubscribe = await requestUnsubscribe({
      context: readerContext,
      mailboxId,
      input: { listKey: subscription.listKey, href: subscription.unsubscribe.href },
    });
    expect(unsubscribe.ok).toBe(false);
    if (!unsubscribe.ok) expect(unsubscribe.error.status).toBe(403);

    const disposition = await applyMailingListDisposition({
      context: readerContext,
      mailboxId,
      input: {
        listKey: subscription.listKey,
        disposition: "archive",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(disposition.ok).toBe(false);
    if (!disposition.ok) expect(disposition.error.status).toBe(403);
  });

  test("requires write access before selecting disposition targets", async () => {
    const denied = await applyMailingListDisposition({
      context: outsiderContext,
      mailboxId,
      input: {
        listKey: "updates.example.test",
        disposition: "archive",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.status).toBe(403);
  });
});
