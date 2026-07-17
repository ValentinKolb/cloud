import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { grantMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import {
  createConversationReferenceScheme,
  ensureConversationReference,
  findConversationByReference,
  listConversationReferences,
} from "./conversation-reference";
import { mergeConversations, splitConversation } from "./conversations";
import { createMailbox } from "./mailboxes";
import { createResponseSchedule, evaluateNamedResponseSchedule, listResponseSchedules, updateResponseSchedule } from "./response-schedule";
import { searchMessages } from "./search";
import { loadMailWorkflowCatalog } from "./workflow-catalog-service";

const suite = process.env.MAIL_INTEGRATION_TESTS === "1" ? describe : describe.skip;

const contextFor = (user: { id: string; uid: string }): MailRequestContext => ({
  actor: {
    kind: "user",
    user: {
      id: user.id,
      uid: user.uid,
      provider: "local",
      profile: "user",
      displayName: user.uid,
      givenName: user.uid,
      sn: "Test",
      mail: `${user.uid}@example.com`,
      roles: ["user"],
      memberofGroupIds: [],
      memberofGroups: [],
    } as never,
  },
  accessSubject: { type: "user", userId: user.id },
  requestId: `mail-reference-policy-${user.uid}`,
});

suite("conversation references and response schedules", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const accessIds: string[] = [];
  let mailboxId = "";
  let folderId = "";
  let ownerContext: MailRequestContext;
  let writerContext: MailRequestContext;
  let readerContext: MailRequestContext;
  let nextUid = 1;

  const createConversation = async (messageCount = 1) => {
    const [conversation] = await sql<{ id: string; revision: string | number }[]>`
      INSERT INTO mail.conversations (mailbox_id, subject, participant_summary, latest_message_at)
      VALUES (${mailboxId}::uuid, ${`Reference ${nextUid}`}, 'Customer', now())
      RETURNING id, revision
    `;
    if (!conversation) throw new Error("Failed to create reference conversation");
    const messageIds: string[] = [];
    for (let index = 0; index < messageCount; index += 1) {
      const uid = nextUid++;
      const [message] = await sql<{ id: string }[]>`
        INSERT INTO mail.message_contents (
          mailbox_id, message_id, subject, normalized_subject, internal_date,
          size_bytes, content_hash, hydration_status, plain_text
        ) VALUES (
          ${mailboxId}::uuid,
          ${`<reference-${suffix}-${uid}@example.com>`},
          ${`Reference ${uid}`},
          ${`reference ${uid}`},
          now(),
          128,
          ${uid.toString(16).padStart(64, "0")},
          'complete',
          'Reference search body'
        )
        RETURNING id
      `;
      const [remoteRef] = await sql<{ id: string }[]>`
        INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid)
        VALUES (${folderId}::uuid, ${message!.id}::uuid, 1, ${uid})
        RETURNING id
      `;
      await sql`
        INSERT INTO mail.message_placements (remote_message_ref_id, folder_id, message_id)
        VALUES (${remoteRef!.id}::uuid, ${folderId}::uuid, ${message!.id}::uuid)
      `;
      await sql`
        INSERT INTO mail.conversation_messages (conversation_id, message_id, position, added_by)
        VALUES (${conversation.id}::uuid, ${message!.id}::uuid, ${index + 1}, 'headers')
      `;
      messageIds.push(message!.id);
    }
    return { id: conversation.id, revision: Number(conversation.revision), messageIds };
  };

  beforeAll(async () => {
    await migrate();
    const users = await sql<{ id: string; uid: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES
        (${`mail-reference-owner-${suffix}`}, 'local', 'user', 'Reference owner', false),
        (${`mail-reference-writer-${suffix}`}, 'local', 'user', 'Reference writer', false),
        (${`mail-reference-reader-${suffix}`}, 'local', 'user', 'Reference reader', false)
      RETURNING id, uid
    `;
    const [owner, writer, reader] = users;
    if (!owner || !writer || !reader) throw new Error("Failed to create reference users");
    userIds.push(...users.map((user) => user.id));
    ownerContext = contextFor(owner);
    writerContext = contextFor(writer);
    readerContext = contextFor(reader);
    const mailbox = await createMailbox(ownerContext, { name: `References ${suffix}` });
    if (!mailbox.ok) throw new Error(mailbox.error.message);
    mailboxId = mailbox.data.id;
    for (const [userId, permission] of [
      [writer.id, "write"],
      [reader.id, "read"],
    ] as const) {
      const granted = await grantMailboxAccess({ context: ownerContext, mailboxId, principal: { type: "user", userId }, permission });
      if (!granted.ok) throw new Error(granted.error.message);
      accessIds.push(granted.data.id);
    }
    const [resource] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_resources (mailbox_id, remote_locator, server_identity, scope_fingerprint, status)
      VALUES (${mailboxId}::uuid, '{}'::jsonb, '{}'::jsonb, ${"f".repeat(64)}, 'active')
      RETURNING id
    `;
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES (${resource!.id}::uuid, ${`references-${suffix}`}, 'Inbox', 'inbox', 'current')
      RETURNING id
    `;
    folderId = folder!.id;
  });

  afterAll(async () => {
    if (mailboxId) {
      const mailboxAccess = await sql<
        { access_id: string }[]
      >`SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${mailboxId}::uuid`;
      accessIds.push(...mailboxAccess.map((row) => row.access_id));
      await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
    }
    if (accessIds.length > 0) {
      await sql`DELETE FROM auth.access WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${[...new Set(accessIds)]}::jsonb))`;
    }
    if (userIds.length > 0) {
      await sql`DELETE FROM auth.users WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${userIds}::jsonb))`;
    }
  });

  test("allocates immutable references idempotently and searches exact aliases", async () => {
    expect(
      (
        await createConversationReferenceScheme({
          context: writerContext,
          mailboxId,
          input: { name: "Denied", pattern: "NO-{sequence}", makeDefault: false },
        })
      ).ok,
    ).toBe(false);
    const scheme = await createConversationReferenceScheme({
      context: ownerContext,
      mailboxId,
      input: { name: "Support", pattern: "SUP-{year}-{sequence:6}", makeDefault: true },
    });
    expect(scheme.ok).toBe(true);
    if (!scheme.ok) return;
    const firstConversation = await createConversation();
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        ensureConversationReference({
          context: writerContext,
          mailboxId,
          conversationId: firstConversation.id,
          input: { schemeId: scheme.data.id, idempotencyKey: `parallel-${suffix}-${index}` },
        }),
      ),
    );
    expect(attempts.every((result) => result.ok)).toBe(true);
    const values = new Set(attempts.flatMap((result) => (result.ok ? [result.data.reference.value] : [])));
    expect(values.size).toBe(1);
    expect(attempts.filter((result) => result.ok && result.data.created)).toHaveLength(1);
    const first = attempts.find((result) => result.ok)?.data.reference;
    if (!first) throw new Error("Reference allocation did not return a value");

    const [storedReplay] = await sql<{ idempotency_key: string }[]>`
      SELECT idempotency_key FROM mail.conversation_references WHERE id = ${first.id}::uuid
    `;
    if (!storedReplay) throw new Error("Stored reference idempotency key is unavailable");
    const replayKey = `parallel-${suffix}-5`;
    const [requestLedger] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM mail.conversation_reference_requests
      WHERE mailbox_id = ${mailboxId}::uuid AND reference_id = ${first.id}::uuid
    `;
    expect(requestLedger?.count).toBe(6);
    const replay = await ensureConversationReference({
      context: writerContext,
      mailboxId,
      conversationId: firstConversation.id,
      input: { schemeId: scheme.data.id, idempotencyKey: replayKey },
    });
    expect(replay.ok && replay.data.created).toBe(false);
    const conflictingConversation = await createConversation();
    const conflictingReplay = await ensureConversationReference({
      context: writerContext,
      mailboxId,
      conversationId: conflictingConversation.id,
      input: { schemeId: scheme.data.id, idempotencyKey: replayKey },
    });
    expect(conflictingReplay.ok).toBe(false);
    if (!conflictingReplay.ok) expect(conflictingReplay.error.code).toBe("CONFLICT");
    expect(
      (
        await ensureConversationReference({
          context: readerContext,
          mailboxId,
          conversationId: firstConversation.id,
          input: { schemeId: scheme.data.id, idempotencyKey: `reader-${suffix}` },
        })
      ).ok,
    ).toBe(false);
    const found = await findConversationByReference({ context: readerContext, mailboxId, value: first.value.toLowerCase() });
    expect(found.ok && found.data.conversationId).toBe(firstConversation.id);
    const searched = await searchMessages({
      context: readerContext,
      mailboxId,
      request: { expression: { type: "text", field: "reference", query: first.value, match: "exact" }, sort: "newest", limit: 10 },
    });
    expect(searched.ok && searched.data.items.map((item) => item.id)).toEqual(firstConversation.messageIds);

    const [evidence] = await sql<{ references: number; activities: number; next_sequence: string }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM mail.conversation_references WHERE conversation_id = ${firstConversation.id}::uuid) AS references,
        (SELECT COUNT(*)::int FROM mail.activity_events WHERE conversation_id = ${firstConversation.id}::uuid AND action = 'conversation.reference_allocated') AS activities,
        (SELECT next_sequence::text FROM mail.reference_schemes WHERE id = ${scheme.data.id}::uuid) AS next_sequence
    `;
    expect(evidence).toEqual({ references: 1, activities: 1, next_sequence: "2" });
    let immutableError: unknown;
    try {
      await sql`UPDATE mail.conversation_references SET value = 'mutated' WHERE id = ${first.id}::uuid`;
    } catch (error) {
      immutableError = error;
    }
    expect(String(immutableError)).toContain("Conversation reference allocation fields are immutable");

    const unicodeScheme = await createConversationReferenceScheme({
      context: ownerContext,
      mailboxId,
      input: { name: `Unicode ${suffix}`, pattern: `İ-${suffix}-{sequence}`, makeDefault: false },
    });
    if (!unicodeScheme.ok) throw new Error(unicodeScheme.error.message);
    const unicodeConversation = await createConversation();
    const unicodeReference = await ensureConversationReference({
      context: writerContext,
      mailboxId,
      conversationId: unicodeConversation.id,
      input: { schemeId: unicodeScheme.data.id, idempotencyKey: `unicode-${suffix}` },
    });
    if (!unicodeReference.ok) throw new Error(unicodeReference.error.message);
    const unicodeSearch = await searchMessages({
      context: readerContext,
      mailboxId,
      request: {
        expression: { type: "text", field: "reference", query: unicodeReference.data.reference.value, match: "exact" },
        sort: "newest",
        limit: 10,
      },
    });
    expect(unicodeSearch.ok && unicodeSearch.data.items.map((item) => item.id)).toEqual(unicodeConversation.messageIds);
  });

  test("audits and projects mailbox default replacement", async () => {
    const first = await createConversationReferenceScheme({
      context: ownerContext,
      mailboxId,
      input: { name: `Default A ${suffix}`, pattern: `A-${suffix}-{sequence}`, makeDefault: true },
    });
    if (!first.ok) throw new Error(first.error.message);
    const second = await createConversationReferenceScheme({
      context: ownerContext,
      mailboxId,
      input: { name: `Default B ${suffix}`, pattern: `B-${suffix}-{sequence}`, makeDefault: true },
    });
    if (!second.ok) throw new Error(second.error.message);
    const [demoted] = await sql<{ is_default: boolean; revision: string | number; activities: number }[]>`
      SELECT
        scheme.is_default,
        scheme.revision,
        (SELECT COUNT(*)::int FROM mail.activity_events activity
         WHERE activity.target_id = scheme.id
           AND activity.action = 'reference_scheme.updated'
           AND activity.metadata->>'reason' = 'default_replaced') AS activities
      FROM mail.reference_schemes scheme
      WHERE scheme.id = ${first.data.id}::uuid
    `;
    expect(demoted).toMatchObject({ is_default: false, revision: "2", activities: 1 });
  });

  test("merge preserves references as primary and aliases while split copies none", async () => {
    const scheme = await createConversationReferenceScheme({
      context: ownerContext,
      mailboxId,
      input: { name: "Escalations", pattern: "ESC-{year}-{sequence:6}", makeDefault: false },
    });
    if (!scheme.ok) throw new Error(scheme.error.message);
    const schemeId = scheme.data.id;
    const target = await createConversation();
    const source = await createConversation();
    const targetReference = await ensureConversationReference({
      context: writerContext,
      mailboxId,
      conversationId: target.id,
      input: { schemeId, idempotencyKey: `merge-target-${suffix}` },
    });
    const sourceReference = await ensureConversationReference({
      context: writerContext,
      mailboxId,
      conversationId: source.id,
      input: { schemeId, idempotencyKey: `merge-source-${suffix}` },
    });
    if (!targetReference.ok || !sourceReference.ok) throw new Error("Failed to allocate merge references");
    const merged = await mergeConversations({
      context: writerContext,
      mailboxId,
      targetConversationId: target.id,
      input: {
        sourceConversationId: source.id,
        expectedTargetRevision: targetReference.data.conversationRevision,
        expectedSourceRevision: sourceReference.data.conversationRevision,
        confirm: true,
      },
    });
    if (!merged.ok) throw new Error(JSON.stringify(merged.error));
    expect(merged.ok).toBe(true);
    const mergedReferences = await listConversationReferences({ context: readerContext, mailboxId, conversationId: target.id });
    expect(mergedReferences.ok && mergedReferences.data.map((reference) => reference.value).sort()).toEqual(
      [targetReference.data.reference.value, sourceReference.data.reference.value].sort(),
    );
    expect(mergedReferences.ok && mergedReferences.data.filter((reference) => reference.role === "primary")).toHaveLength(1);
    const replayedAfterMerge = await ensureConversationReference({
      context: writerContext,
      mailboxId,
      conversationId: source.id,
      input: { schemeId, idempotencyKey: `merge-source-${suffix}` },
    });
    expect(replayedAfterMerge.ok && replayedAfterMerge.data.created).toBe(false);
    expect(replayedAfterMerge.ok && replayedAfterMerge.data.reference.conversationId).toBe(target.id);
    const aliasSearch = await searchMessages({
      context: readerContext,
      mailboxId,
      request: {
        expression: { type: "text", field: "reference", query: sourceReference.data.reference.value, match: "exact" },
        sort: "newest",
        limit: 10,
      },
    });
    expect(aliasSearch.ok && aliasSearch.data.items.map((item) => item.id)).toEqual(expect.arrayContaining(source.messageIds));

    const splitSource = await createConversation(2);
    const splitReference = await ensureConversationReference({
      context: writerContext,
      mailboxId,
      conversationId: splitSource.id,
      input: { schemeId, idempotencyKey: `split-${suffix}` },
    });
    if (!splitReference.ok) throw new Error(splitReference.error.message);
    const split = await splitConversation({
      context: writerContext,
      mailboxId,
      conversationId: splitSource.id,
      input: { messageIds: [splitSource.messageIds[1]!], expectedRevision: splitReference.data.conversationRevision, confirm: true },
    });
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const sourceReferences = await listConversationReferences({ context: readerContext, mailboxId, conversationId: splitSource.id });
    const createdReferences = await listConversationReferences({
      context: readerContext,
      mailboxId,
      conversationId: split.data.created.id,
    });
    expect(sourceReferences.ok && sourceReferences.data).toHaveLength(1);
    expect(createdReferences.ok && createdReferences.data).toEqual([]);
  });

  test("response schedules are admin-versioned and evaluate deterministically", async () => {
    const definition = {
      timeZone: "Europe/Berlin",
      activeRanges: [{ from: "2026-01-01", to: null }],
      weeklyWindows: [{ weekday: 5 as const, start: "09:00", end: "17:00" }],
      exceptions: [{ date: "2026-07-17", closed: true, windows: [] }],
    };
    expect(
      (await createResponseSchedule({ context: writerContext, mailboxId, input: { name: "Denied", definition, enabled: true } })).ok,
    ).toBe(false);
    const created = await createResponseSchedule({
      context: ownerContext,
      mailboxId,
      input: { name: "Office hours", definition, enabled: true },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const evaluated = await evaluateNamedResponseSchedule({
      mailboxId,
      scheduleId: created.data.id,
      instant: new Date("2026-07-17T09:00:00.000Z"),
    });
    expect(evaluated.ok && evaluated.data.evaluation).toMatchObject({ active: false, reason: "holiday" });
    const updates = await Promise.all([
      updateResponseSchedule({
        context: ownerContext,
        mailboxId,
        scheduleId: created.data.id,
        input: { expectedRevision: 1, enabled: false },
      }),
      updateResponseSchedule({
        context: ownerContext,
        mailboxId,
        scheduleId: created.data.id,
        input: { expectedRevision: 1, name: "Changed concurrently" },
      }),
    ]);
    expect(updates.filter((result) => result.ok)).toHaveLength(1);
    expect(updates.filter((result) => !result.ok)).toHaveLength(1);
    await sql`UPDATE mail.response_schedules SET definition = '{}'::jsonb, enabled = true WHERE id = ${created.data.id}::uuid`;
    const corrupted = await listResponseSchedules(ownerContext, mailboxId);
    expect(corrupted.ok).toBe(false);
    if (!corrupted.ok) expect(corrupted.error.code).toBe("INTERNAL");
    const catalogError = await loadMailWorkflowCatalog({ context: ownerContext, mailboxId }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(catalogError).toMatchObject({ code: "INTERNAL" });
  });
});
