import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Readable } from "node:stream";
import { sql } from "bun";
import { migrate } from "../migrate";
import { grantMailboxAccess, revokeMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import { cancelOutboxSubmission, executeMutationCommand, executeOutboxSubmission } from "./command-runtime";
import { createActorCommand } from "./commands";
import type { ConnectorEnvelope } from "./connectors";
import { imapSmtpConnector } from "./connectors";
import { createDraft, updateDraft } from "./drafts";
import { resolveMailExecution } from "./execution";
import { createMailbox, updateMailbox } from "./mailboxes";
import { deleteOrphanedBlobs, storeReadableBlob } from "./message-blobs";
import { hydrateMessageFromSource } from "./message-hydration";
import { createAttachmentStream, openAttachment } from "./messages";
import { listProviderConnections, replaceProviderConnection } from "./provider-connections";
import { searchMessages } from "./search";
import { ingestEnvelope } from "./sync-runtime";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

suite("mail PostgreSQL foundation", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ids: { userIds: string[]; mailboxId?: string; accessIds: string[]; blobIds: string[] } = {
    userIds: [],
    accessIds: [],
    blobIds: [],
  };
  let context: MailRequestContext;

  beforeAll(async () => {
    await migrate();
    await migrate();
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES (${`mail-test-${suffix}`}, 'local', 'user', 'Mail Integration Test', true)
      RETURNING id
    `;
    if (!user) throw new Error("Failed to create integration user");
    ids.userIds.push(user.id);
    context = {
      actor: {
        kind: "user",
        user: {
          id: user.id,
          uid: `mail-test-${suffix}`,
          provider: "local",
          profile: "user",
          displayName: "Mail Integration Test",
          givenName: "Mail",
          sn: "Test",
          mail: `mail-test-${suffix}@example.com`,
          roles: ["admin", "user"],
          memberofGroupIds: [],
          memberofGroups: [],
        } as never,
      },
      accessSubject: { type: "user", userId: user.id },
      requestId: `mail-integration-${suffix}`,
    };
  });

  afterAll(async () => {
    if (ids.mailboxId) {
      const access = await sql<
        { access_id: string }[]
      >`SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${ids.mailboxId}::uuid`;
      ids.accessIds.push(...access.map((row) => row.access_id));
      await sql`DELETE FROM mail.mailboxes WHERE id = ${ids.mailboxId}::uuid`;
    }
    if (ids.accessIds.length > 0) {
      await sql`DELETE FROM auth.access WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids.accessIds}::jsonb))`;
    }
    if (ids.blobIds.length > 0) {
      await sql`DELETE FROM mail.message_part_blobs WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids.blobIds}::jsonb))`;
    }
    if (ids.userIds.length > 0) {
      await sql`DELETE FROM auth.users WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${ids.userIds}::jsonb))`;
    }
  });

  test("persists a pinned send command and supports mailbox-scoped search", async () => {
    const mailbox = await createMailbox(context, {
      name: `Integration ${suffix}`,
      description: "Disposable integration mailbox",
      connectionPolicy: "shared_connection",
    });
    expect(mailbox.ok).toBe(true);
    if (!mailbox.ok) return;
    ids.mailboxId = mailbox.data.id;
    expect(mailbox.data.searchBackend).toBe("auto");

    const nativeSearch = await updateMailbox({
      context,
      mailboxId: mailbox.data.id,
      searchBackend: "postgres",
    });
    expect(nativeSearch.ok).toBe(true);
    if (nativeSearch.ok) expect(nativeSearch.data.searchBackend).toBe("postgres");
    const automaticSearch = await updateMailbox({
      context,
      mailboxId: mailbox.data.id,
      searchBackend: "auto",
    });
    expect(automaticSearch.ok).toBe(true);
    if (automaticSearch.ok) expect(automaticSearch.data.searchBackend).toBe("auto");

    const scope = "a".repeat(64);
    const [connection] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_connections (
        owner_mailbox_id, name, email, username, imap_host, imap_port, imap_tls_mode,
        smtp_host, smtp_port, smtp_tls_mode, secret_kind, encrypted_secret,
        authenticated_principal, capabilities, server_identity, last_verified_at
      ) VALUES (
        ${mailbox.data.id}::uuid, 'Fixture', 'sender@example.com', 'sender@example.com',
        'imap.example.com', 993, 'implicit', 'smtp.example.com', 587, 'starttls',
        'password', 'fixture-ciphertext', 'sender@example.com', '{}'::jsonb, '{}'::jsonb, now()
      ) RETURNING id
    `;
    const [resource] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_resources (
        mailbox_id, remote_locator, server_identity, scope_fingerprint, status
      ) VALUES (${mailbox.data.id}::uuid, '{}'::jsonb, '{}'::jsonb, ${scope}, 'active')
      RETURNING id
    `;
    const [binding] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_bindings (
        remote_resource_id, connection_id, state, remote_locator, capabilities, rights,
        verification_evidence, verified_scope_fingerprint, last_verified_at
      ) VALUES (
        ${resource!.id}::uuid, ${connection!.id}::uuid, 'active', '{}'::jsonb, '{}'::jsonb,
        '{}'::jsonb, '{}'::jsonb, ${scope}, now()
      ) RETURNING id
    `;
    const [folder] = await sql<{ id: string }[]>`
      INSERT INTO mail.folders (remote_resource_id, stable_key, name, role, sync_status)
      VALUES (${resource!.id}::uuid, 'inbox-fixture', 'Inbox', 'inbox', 'current')
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.binding_folder_refs (
        binding_id, folder_id, remote_path, uid_validity, uid_next, effective_rights, last_verified_at
      ) VALUES (
        ${binding!.id}::uuid, ${folder!.id}::uuid, 'INBOX', 1, 2,
        ARRAY['read', 'write_flags', 'insert', 'delete_messages']::text[], now()
      )
    `;
    const [identity] = await sql<{ id: string }[]>`
      INSERT INTO mail.sender_identities (
        mailbox_id, display_name, from_address, interactive_policy, automation_policy, is_default, status
      ) VALUES (${mailbox.data.id}::uuid, 'Fixture Sender', 'sender@example.com', 'mailbox', 'disabled', true, 'verified')
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.sender_identity_bindings (
        sender_identity_id, binding_id, provider_principal, verified_at, saves_sent_automatically
      ) VALUES (${identity!.id}::uuid, ${binding!.id}::uuid, 'sender@example.com', now(), true)
    `;

    const privateConnections = await listProviderConnections(context);
    expect(privateConnections.ok).toBe(true);
    if (privateConnections.ok) expect(privateConnections.data.some((item) => item.id === connection!.id)).toBe(false);
    const mailboxConnections = await listProviderConnections(context, mailbox.data.id);
    expect(mailboxConnections.ok).toBe(true);
    if (mailboxConnections.ok) expect(mailboxConnections.data.some((item) => item.id === connection!.id)).toBe(true);

    const initialExecution = await resolveMailExecution({
      context,
      mailboxId: mailbox.data.id,
      operation: "actorMutation",
      folderRequirements: [{ folderId: folder!.id, rights: ["write_flags"] }],
    });
    expect(initialExecution.ok).toBe(true);
    if (initialExecution.ok) expect(initialExecution.data.secretRevision).toBe(1);
    await sql`UPDATE mail.provider_connections SET secret_revision = 2 WHERE id = ${connection!.id}::uuid`;
    const staleCredentialExecution = await resolveMailExecution({
      context,
      mailboxId: mailbox.data.id,
      operation: "actorMutation",
      folderRequirements: [{ folderId: folder!.id, rights: ["write_flags"] }],
    });
    expect(staleCredentialExecution.ok).toBe(false);
    await sql`UPDATE mail.provider_connections SET secret_revision = 1 WHERE id = ${connection!.id}::uuid`;

    const orderingEnvelope = (params: { uid: number; messageId: string; internalDate: Date; outbound: boolean }): ConnectorEnvelope => ({
      remoteRef: { folderStableKey: folder!.id, uidValidity: "1", uid: String(params.uid), modseq: null },
      providerMessageId: null,
      providerThreadId: null,
      messageId: params.messageId,
      inReplyTo: null,
      references: [],
      subject: params.outbound ? "Re: Ordering test" : "Ordering test",
      sentAt: params.internalDate,
      internalDate: params.internalDate,
      sizeBytes: 128,
      flags: [],
      labels: [],
      addresses: {
        from: [
          {
            name: params.outbound ? "Fixture Sender" : "Customer",
            address: params.outbound ? "sender@example.com" : "customer@example.com",
          },
        ],
        replyTo: [],
        to: [
          {
            name: params.outbound ? "Customer" : "Fixture Sender",
            address: params.outbound ? "customer@example.com" : "sender@example.com",
          },
        ],
        cc: [],
        bcc: [],
      },
      mimeStructure: {},
    });
    const latestInboundAt = new Date("2026-07-11T12:00:00.000Z");
    const latestInboundId = await ingestEnvelope({
      db: sql,
      mailboxId: mailbox.data.id,
      remoteResourceId: resource!.id,
      folderId: folder!.id,
      message: orderingEnvelope({ uid: 10, messageId: "<ordering-inbound@example.com>", internalDate: latestInboundAt, outbound: false }),
    });
    const [conversationCountBeforeReplay] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM mail.conversations WHERE mailbox_id = ${mailbox.data.id}::uuid
    `;
    await ingestEnvelope({
      db: sql,
      mailboxId: mailbox.data.id,
      remoteResourceId: resource!.id,
      folderId: folder!.id,
      message: orderingEnvelope({ uid: 10, messageId: "<ordering-inbound@example.com>", internalDate: latestInboundAt, outbound: false }),
    });
    const [conversationReplay] = await sql<{ conversation_count: number; link_count: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM mail.conversations WHERE mailbox_id = ${mailbox.data.id}::uuid) AS conversation_count,
        (SELECT COUNT(*)::int FROM mail.conversation_messages WHERE message_id = ${latestInboundId}::uuid) AS link_count
    `;
    expect(conversationReplay).toEqual({ conversation_count: conversationCountBeforeReplay!.count, link_count: 1 });
    await ingestEnvelope({
      db: sql,
      mailboxId: mailbox.data.id,
      remoteResourceId: resource!.id,
      folderId: folder!.id,
      message: orderingEnvelope({
        uid: 9,
        messageId: "<ordering-older-outbound@example.com>",
        internalDate: new Date("2026-07-11T11:00:00.000Z"),
        outbound: true,
      }),
    });
    const [orderedConversation] = await sql<{ id: string; response_needed: boolean; message_count: number }[]>`
      SELECT c.id, c.response_needed, COUNT(cm.message_id)::int AS message_count
      FROM mail.conversations c
      JOIN mail.conversation_messages latest_link ON latest_link.conversation_id = c.id
      JOIN mail.conversation_messages cm ON cm.conversation_id = c.id
      WHERE latest_link.message_id = ${latestInboundId}::uuid
      GROUP BY c.id
    `;
    expect(orderedConversation).toMatchObject({ response_needed: true, message_count: 2 });
    await ingestEnvelope({
      db: sql,
      mailboxId: mailbox.data.id,
      remoteResourceId: resource!.id,
      folderId: folder!.id,
      message: orderingEnvelope({
        uid: 11,
        messageId: "<ordering-newer-outbound@example.com>",
        internalDate: new Date("2026-07-11T13:00:00.000Z"),
        outbound: true,
      }),
    });
    const [answeredConversation] = await sql<{ response_needed: boolean; message_count: number }[]>`
      SELECT c.response_needed, COUNT(cm.message_id)::int AS message_count
      FROM mail.conversations c
      JOIN mail.conversation_messages cm ON cm.conversation_id = c.id
      WHERE c.id = ${orderedConversation!.id}::uuid
      GROUP BY c.id
    `;
    expect(answeredConversation).toEqual({ response_needed: false, message_count: 3 });

    const emptyDraft = await createDraft({
      context,
      mailboxId: mailbox.data.id,
      input: {
        senderIdentityId: identity!.id,
        to: [],
        cc: [],
        bcc: [],
        subject: "Integration subject",
        body: "Integration searchable body",
        format: "markdown",
      },
    });
    expect(emptyDraft.ok).toBe(true);
    if (!emptyDraft.ok) return;
    const emptySend = await createActorCommand({
      context,
      mailboxId: mailbox.data.id,
      input: {
        kind: "send",
        draftId: emptyDraft.data.id,
        senderIdentityId: identity!.id,
        undoSeconds: 60,
        idempotencyKey: `empty-send-${suffix}`,
      },
    });
    expect(emptySend.ok).toBe(false);
    const [emptyCommandCount] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM mail.commands
      WHERE mailbox_id = ${mailbox.data.id}::uuid AND idempotency_key = ${`empty-send-${suffix}`}
    `;
    expect(emptyCommandCount?.count).toBe(0);

    const draft = await updateDraft({
      context,
      mailboxId: mailbox.data.id,
      draftId: emptyDraft.data.id,
      expectedRevision: emptyDraft.data.revision,
      input: {
        senderIdentityId: identity!.id,
        to: [{ name: "Recipient", address: "recipient@example.com" }],
        cc: [],
        bcc: [],
        subject: "Integration subject",
        body: "Integration searchable body",
        format: "markdown",
      },
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const draftActivity = await sql<{ action: string; revision: number }[]>`
      SELECT action, (metadata->>'revision')::int AS revision
      FROM mail.activity_events
      WHERE target_type = 'draft' AND target_id = ${draft.data.id}::uuid
      ORDER BY id
    `;
    expect(draftActivity).toEqual([
      { action: "draft.created", revision: 1 },
      { action: "draft.updated", revision: 2 },
    ]);
    const command = await createActorCommand({
      context,
      mailboxId: mailbox.data.id,
      input: {
        kind: "send",
        draftId: draft.data.id,
        senderIdentityId: identity!.id,
        undoSeconds: 60,
        idempotencyKey: `send-${suffix}`,
      },
    });
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    const [pinnedRevision] = await sql<{ selected_secret_revision: number }[]>`
      SELECT selected_secret_revision FROM mail.commands WHERE id = ${command.data.id}::uuid
    `;
    expect(pinnedRevision?.selected_secret_revision).toBe(1);
    const repeatedCommand = await createActorCommand({
      context,
      mailboxId: mailbox.data.id,
      input: {
        kind: "send",
        draftId: draft.data.id,
        senderIdentityId: identity!.id,
        undoSeconds: 60,
        idempotencyKey: `send-${suffix}`,
      },
    });
    expect(repeatedCommand.ok && repeatedCommand.data.id).toBe(command.data.id);
    const conflictingCommand = await createActorCommand({
      context,
      mailboxId: mailbox.data.id,
      input: {
        kind: "send",
        draftId: draft.data.id,
        senderIdentityId: identity!.id,
        undoSeconds: 59,
        idempotencyKey: `send-${suffix}`,
      },
    });
    expect(conflictingCommand.ok).toBe(false);
    const [outbox] = await sql<{ id: string; draft_snapshot: Record<string, unknown> | string; state: string }[]>`
      SELECT id, draft_snapshot, state FROM mail.outbox_submissions WHERE command_id = ${command.data.id}::uuid
    `;
    expect(outbox?.state).toBe("undo_window");
    const snapshot = typeof outbox?.draft_snapshot === "string" ? JSON.parse(outbox.draft_snapshot) : outbox?.draft_snapshot;
    expect(snapshot?.subject).toBe("Integration subject");
    const cancelled = await cancelOutboxSubmission({ context, mailboxId: mailbox.data.id, outboxId: outbox!.id });
    expect(cancelled.ok).toBe(true);

    const [message] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id, message_id, subject, internal_date, size_bytes, content_hash,
        hydration_status, plain_text, normalized_subject
      ) VALUES (
        ${mailbox.data.id}::uuid, '<integration@example.com>', 'Searchable subject', now(), 42,
        ${"b".repeat(64)}, 'complete', 'A unique integration body phrase', 'searchable subject'
      ) RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_search_chunks (message_id, position, search_document)
      VALUES (${message!.id}::uuid, 0, to_tsvector('simple'::regconfig, 'A unique integration body phrase'))
    `;
    await sql`
      INSERT INTO mail.message_addresses (message_id, role, position, display_name, email, normalized_email)
      VALUES (${message!.id}::uuid, 'from', 0, 'Alice Fixture', 'alice@example.com', 'alice@example.com')
    `;
    const [remoteRef] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid)
      VALUES (${folder!.id}::uuid, ${message!.id}::uuid, 1, 1)
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_placements (remote_message_ref_id, folder_id, message_id, flags, keywords)
      VALUES (${remoteRef!.id}::uuid, ${folder!.id}::uuid, ${message!.id}::uuid, ARRAY[]::text[], ARRAY[]::text[])
    `;
    const result = await searchMessages({
      context,
      mailboxId: mailbox.data.id,
      request: {
        expression: {
          and: [
            { field: "from", query: "alice@example.com", match: "exact" },
            { field: "body", query: "unique integration", match: "phrase" },
          ],
        },
        sort: "relevance",
        limit: 10,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.items.map((item) => item.id)).toContain(message!.id);

    const attachmentBytes = Buffer.alloc(2 * 1024 * 1024 + 513_123);
    for (let index = 0; index < attachmentBytes.length; index += 1) {
      attachmentBytes[index] = (index * 31 + suffix.charCodeAt(index % suffix.length)) % 256;
    }
    const attachmentBlob = await storeReadableBlob(Readable.from([attachmentBytes]), attachmentBytes.length);
    ids.blobIds.push(attachmentBlob.id);
    const [attachmentPart] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_parts (
        message_id, part_path, content_type, disposition, filename, size_bytes, blob_id, hydration_status
      ) VALUES (
        ${message!.id}::uuid, 'attachment-stream-test', 'application/octet-stream', 'attachment',
        'stream-test.bin', ${attachmentBytes.length}, ${attachmentBlob.id}::uuid, 'complete'
      )
      RETURNING id
    `;
    const [attachment] = await sql<{ id: string }[]>`
      INSERT INTO mail.attachments (
        message_id, part_id, filename, content_type, disposition, checksum, size_bytes, blob_id
      ) VALUES (
        ${message!.id}::uuid, ${attachmentPart!.id}::uuid, 'stream-test.bin', 'application/octet-stream',
        'attachment', ${attachmentBlob.contentHash}, ${attachmentBytes.length}, ${attachmentBlob.id}::uuid
      )
      RETURNING id
    `;
    const openedAttachment = await openAttachment({
      context,
      mailboxId: mailbox.data.id,
      messageId: message!.id,
      attachmentId: attachment!.id,
    });
    expect(openedAttachment.ok).toBe(true);
    if (!openedAttachment.ok) return;
    const fullDownload = Buffer.from(
      await new Response(
        createAttachmentStream({
          blobId: openedAttachment.data.blobId,
          chunkSize: openedAttachment.data.chunkSize,
          chunkCount: openedAttachment.data.chunkCount,
          start: 0,
          endExclusive: openedAttachment.data.total,
        }),
      ).arrayBuffer(),
    );
    expect(fullDownload.equals(attachmentBytes)).toBe(true);
    const rangeStart = 1024 * 1024 - 31;
    const rangeEnd = 2 * 1024 * 1024 + 47;
    const rangedDownload = Buffer.from(
      await new Response(
        createAttachmentStream({
          blobId: openedAttachment.data.blobId,
          chunkSize: openedAttachment.data.chunkSize,
          chunkCount: openedAttachment.data.chunkCount,
          start: rangeStart,
          endExclusive: rangeEnd,
        }),
      ).arrayBuffer(),
    );
    expect(rangedDownload.equals(attachmentBytes.subarray(rangeStart, rangeEnd))).toBe(true);

    const longBody = Array.from({ length: 110_000 }, (_, index) => `longtoken${index}`)
      .reduce<string[]>((lines, token, index) => {
        const line = Math.floor(index / 100);
        lines[line] = lines[line] ? `${lines[line]} ${token}` : token;
        return lines;
      }, [])
      .join("\r\n");
    const longSource = Buffer.from(
      `From: Large Body <large@example.com>\r\nTo: Recipient <recipient@example.com>\r\nSubject: Large body search\r\nMessage-ID: <large-body@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${longBody}`,
      "utf8",
    );
    const [largeMessage] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id,
        message_id,
        subject,
        internal_date,
        size_bytes,
        content_hash,
        hydration_status,
        mime_structure
      ) VALUES (
        ${mailbox.data.id}::uuid,
        '<large-body@example.com>',
        'Large body search',
        now(),
        ${longSource.length},
        ${"e".repeat(64)},
        'envelope',
        ${{ part: "1", type: "text/plain", childNodes: [] }}::jsonb
      ) RETURNING id
    `;
    const [largeRemoteRef] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid)
      VALUES (${folder!.id}::uuid, ${largeMessage!.id}::uuid, 1, 3)
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_placements (remote_message_ref_id, folder_id, message_id, flags, keywords)
      VALUES (${largeRemoteRef!.id}::uuid, ${folder!.id}::uuid, ${largeMessage!.id}::uuid, ARRAY[]::text[], ARRAY[]::text[])
    `;
    const hydratedLargeMessage = await hydrateMessageFromSource({
      messageId: largeMessage!.id,
      source: Readable.from([longSource]),
      expectedSize: longSource.length,
    });
    expect(hydratedLargeMessage.status).toBe("hydrated");
    const largePartBlobs = await sql<{ blob_id: string }[]>`
      SELECT blob_id FROM mail.message_parts WHERE message_id = ${largeMessage!.id}::uuid AND blob_id IS NOT NULL
    `;
    ids.blobIds.push(...largePartBlobs.map((row) => row.blob_id));
    const tailSearch = await searchMessages({
      context,
      mailboxId: mailbox.data.id,
      request: {
        expression: { field: "body", query: "longtoken109999", match: "words" },
        sort: "relevance",
        limit: 10,
      },
    });
    expect(tailSearch.ok).toBe(true);
    if (tailSearch.ok) expect(tailSearch.data.items.map((item) => item.id)).toContain(largeMessage!.id);

    const firstSearchPage = await searchMessages({
      context,
      mailboxId: mailbox.data.id,
      request: {
        expression: { field: "any", query: "body", match: "words" },
        sort: "newest",
        limit: 1,
      },
    });
    expect(firstSearchPage.ok).toBe(true);
    const searchCursor = firstSearchPage.ok ? firstSearchPage.data.nextCursor : null;
    expect(searchCursor).not.toBeNull();
    const reusedSearchCursor = await searchMessages({
      context,
      mailboxId: mailbox.data.id,
      request: {
        expression: { field: "any", query: "different query", match: "words" },
        sort: "newest",
        limit: 1,
        cursor: searchCursor ?? undefined,
      },
    });
    expect(reusedSearchCursor.ok).toBe(false);
    const mismatchedBackendCursor = JSON.parse(Buffer.from(searchCursor!, "base64url").toString("utf8")) as Record<string, unknown>;
    mismatchedBackendCursor.backend = "pg_textsearch";
    const changedBackendPage = await searchMessages({
      context,
      mailboxId: mailbox.data.id,
      request: {
        expression: { field: "any", query: "body", match: "words" },
        sort: "newest",
        limit: 1,
        cursor: Buffer.from(JSON.stringify(mismatchedBackendCursor)).toString("base64url"),
      },
    });
    expect(changedBackendPage.ok).toBe(false);

    const referencedBlob = await storeReadableBlob(Readable.from([Buffer.from("referenced blob")]), 15);
    const orphanedBlob = await storeReadableBlob(Readable.from([Buffer.from("orphaned blob")]), 13);
    ids.blobIds.push(referencedBlob.id, orphanedBlob.id);
    await sql`
      UPDATE mail.message_part_blobs
      SET completed_at = now() - interval '10 minutes'
      WHERE id IN (${referencedBlob.id}::uuid, ${orphanedBlob.id}::uuid)
    `;
    await sql`
      INSERT INTO mail.message_parts (
        message_id, part_path, content_type, size_bytes, blob_id, hydration_status
      ) VALUES (
        ${message!.id}::uuid, 'integration-part', 'text/plain', ${referencedBlob.byteLength}, ${referencedBlob.id}::uuid, 'complete'
      )
    `;
    expect(await deleteOrphanedBlobs(5)).toBe(1);
    const remainingBlobs = await sql<{ id: string }[]>`
      SELECT id FROM mail.message_part_blobs WHERE id IN (${referencedBlob.id}::uuid, ${orphanedBlob.id}::uuid)
    `;
    expect(remainingBlobs.map((item) => item.id)).toEqual([referencedBlob.id]);

    const [collaborator] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES (${`mail-collaborator-${suffix}`}, 'local', 'user', 'Mail Collaborator', false)
      RETURNING id
    `;
    if (!collaborator) throw new Error("Failed to create collaborator");
    ids.userIds.push(collaborator.id);
    const collaboratorContext: MailRequestContext = {
      actor: {
        kind: "user",
        user: {
          id: collaborator.id,
          uid: `mail-collaborator-${suffix}`,
          provider: "local",
          profile: "user",
          displayName: "Mail Collaborator",
          givenName: "Mail",
          sn: "Collaborator",
          mail: `mail-collaborator-${suffix}@example.com`,
          roles: ["user"],
          memberofGroupIds: [],
          memberofGroups: [],
        } as never,
      },
      accessSubject: { type: "user", userId: collaborator.id },
      requestId: `mail-collaborator-${suffix}`,
    };
    const grant = await grantMailboxAccess({
      context,
      mailboxId: mailbox.data.id,
      principal: { type: "user", userId: collaborator.id },
      permission: "write",
    });
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const collaboratorDraft = await createDraft({
      context: collaboratorContext,
      mailboxId: mailbox.data.id,
      input: {
        senderIdentityId: identity!.id,
        to: [{ address: "recipient@example.com" }],
        cc: [],
        bcc: [],
        subject: "Revocation test",
        body: "This must not be sent after access is revoked.",
        format: "plain",
      },
    });
    expect(collaboratorDraft.ok).toBe(true);
    if (!collaboratorDraft.ok) return;
    const collaboratorCommand = await createActorCommand({
      context: collaboratorContext,
      mailboxId: mailbox.data.id,
      input: {
        kind: "send",
        draftId: collaboratorDraft.data.id,
        senderIdentityId: identity!.id,
        scheduledAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        undoSeconds: 0,
        idempotencyKey: `revoked-send-${suffix}`,
      },
    });
    expect(collaboratorCommand.ok).toBe(true);
    if (!collaboratorCommand.ok) return;
    expect((await revokeMailboxAccess({ context, mailboxId: mailbox.data.id, accessId: grant.data.id })).ok).toBe(true);
    const [collaboratorOutbox] = await sql<{ id: string }[]>`
      UPDATE mail.outbox_submissions
      SET scheduled_at = now() - interval '1 second', undo_until = NULL
      WHERE command_id = ${collaboratorCommand.data.id}::uuid
      RETURNING id
    `;
    expect(await executeOutboxSubmission(collaboratorOutbox!.id)).toBe("failed");
    const [revokedExecution] = await sql<
      {
        outbox_state: string;
        command_state: string;
        draft_state: string;
        error_code: string | null;
        outbox_attempt: number;
        command_attempt: number;
        worker_heartbeat_at: Date | null;
      }[]
    >`
      SELECT
        o.state AS outbox_state,
        c.state AS command_state,
        d.state AS draft_state,
        o.last_error_code AS error_code,
        o.attempt AS outbox_attempt,
        c.attempt AS command_attempt,
        c.worker_heartbeat_at
      FROM mail.outbox_submissions o
      JOIN mail.commands c ON c.id = o.command_id
      JOIN mail.drafts d ON d.id = o.draft_id
      WHERE o.id = ${collaboratorOutbox!.id}::uuid
    `;
    expect(revokedExecution).toEqual({
      outbox_state: "failed",
      command_state: "failed",
      draft_state: "draft",
      error_code: "ACCESS_REVOKED",
      outbox_attempt: 1,
      command_attempt: 1,
      worker_heartbeat_at: null,
    });

    const retryDraft = await createDraft({
      context,
      mailboxId: mailbox.data.id,
      input: {
        senderIdentityId: identity!.id,
        to: [{ address: "recipient@example.com" }],
        cc: [],
        bcc: [],
        subject: "Sent copy retry",
        body: "Sent copy retry body",
        format: "plain",
      },
    });
    expect(retryDraft.ok).toBe(true);
    if (!retryDraft.ok) return;
    const retryCommand = await createActorCommand({
      context,
      mailboxId: mailbox.data.id,
      input: {
        kind: "send",
        draftId: retryDraft.data.id,
        senderIdentityId: identity!.id,
        scheduledAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        undoSeconds: 0,
        idempotencyKey: `sent-copy-${suffix}`,
      },
    });
    expect(retryCommand.ok).toBe(true);
    if (!retryCommand.ok) return;
    const [retryOutbox] = await sql<{ id: string }[]>`
      UPDATE mail.outbox_submissions
      SET state = 'sent_sync_pending', scheduled_at = now(), undo_until = NULL
      WHERE command_id = ${retryCommand.data.id}::uuid
      RETURNING id
    `;
    await sql`UPDATE mail.commands SET state = 'confirmed', finished_at = now() WHERE id = ${retryCommand.data.id}::uuid`;
    await sql`UPDATE mail.drafts SET state = 'sent' WHERE id = ${retryDraft.data.id}::uuid`;
    expect(await executeOutboxSubmission(retryOutbox!.id)).toBe("sent_sync_pending");
    const [retriedCopy] = await sql<{ state: string; attempt: number; last_error_code: string | null }[]>`
      SELECT state, attempt, last_error_code FROM mail.outbox_submissions WHERE id = ${retryOutbox!.id}::uuid
    `;
    expect(retriedCopy?.state).toBe("sent_sync_pending");
    expect(retriedCopy?.attempt).toBe(1);
    expect(retriedCopy?.last_error_code).toBe("CREDENTIAL_DECRYPTION_FAILED");

    await sql`
      UPDATE mail.outbox_submissions
      SET state = 'unknown', last_error_code = NULL, last_error_message = NULL
      WHERE id = ${retryOutbox!.id}::uuid
    `;
    await sql`
      UPDATE mail.commands
      SET state = 'ambiguous', finished_at = NULL, worker_heartbeat_at = NULL
      WHERE id = ${retryCommand.data.id}::uuid
    `;
    expect(await executeOutboxSubmission(retryOutbox!.id)).toBe("needs_attention");
    const [reconciledUnknown] = await sql<
      {
        outbox_state: string;
        command_state: string;
        outbox_attempt: number;
        command_attempt: number;
        worker_heartbeat_at: Date | null;
      }[]
    >`
      SELECT
        o.state AS outbox_state,
        c.state AS command_state,
        o.attempt AS outbox_attempt,
        c.attempt AS command_attempt,
        c.worker_heartbeat_at
      FROM mail.outbox_submissions o
      JOIN mail.commands c ON c.id = o.command_id
      WHERE o.id = ${retryOutbox!.id}::uuid
    `;
    expect(reconciledUnknown).toEqual({
      outbox_state: "needs_attention",
      command_state: "needs_attention",
      outbox_attempt: 2,
      command_attempt: 1,
      worker_heartbeat_at: null,
    });

    const [exhaustedMutation] = await sql<{ id: string }[]>`
      INSERT INTO mail.commands (
        mailbox_id,
        kind,
        state,
        actor_kind,
        actor_id,
        idempotency_key,
        request_hash,
        target,
        payload,
        selected_binding_id,
        selected_secret_revision,
        rights_snapshot,
        transport_metadata,
        attempt,
        access_subject_kind,
        access_subject_id,
        credential_scopes
      ) VALUES (
        ${mailbox.data.id}::uuid,
        'set_flags',
        'ambiguous',
        'user',
        ${ids.userIds[0]}::uuid,
        ${`exhausted-mutation-${suffix}`},
        ${"c".repeat(64)},
        ${{ remoteMessageRefId: remoteRef!.id, folderId: folder!.id }}::jsonb,
        ${{ flags: ["\\Seen"] }}::jsonb,
        ${binding!.id}::uuid,
        1,
        ${{ folders: { [folder!.id]: ["write_flags"] } }}::jsonb,
        '{}'::jsonb,
        4,
        'user',
        ${ids.userIds[0]}::uuid,
        ARRAY[]::text[]
      ) RETURNING id
    `;
    expect(await executeMutationCommand(exhaustedMutation!.id)).toBe("needs_attention");
    const [exhaustedState] = await sql<{ attempt: number; last_error_code: string | null; worker_heartbeat_at: Date | null }[]>`
      SELECT attempt, last_error_code, worker_heartbeat_at FROM mail.commands WHERE id = ${exhaustedMutation!.id}::uuid
    `;
    expect(exhaustedState).toEqual({
      attempt: 5,
      last_error_code: "AMBIGUOUS_RECONCILIATION_EXHAUSTED",
      worker_heartbeat_at: null,
    });

    const [exhaustedHydration] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id,
        message_id,
        subject,
        internal_date,
        size_bytes,
        content_hash,
        hydration_status,
        hydration_attempt
      ) VALUES (
        ${mailbox.data.id}::uuid,
        '<exhausted-hydration@example.com>',
        'Exhausted hydration',
        now(),
        1,
        ${"d".repeat(64)},
        'failed',
        5
      ) RETURNING id
    `;
    await expect(
      hydrateMessageFromSource({
        messageId: exhaustedHydration!.id,
        source: Readable.from([Buffer.from("x")]),
        expectedSize: 1,
      }),
    ).rejects.toMatchObject({ code: "HYDRATION_NOT_CLAIMED" });
    const [hydrationState] = await sql<{ hydration_status: string; hydration_attempt: number }[]>`
      SELECT hydration_status, hydration_attempt
      FROM mail.message_contents
      WHERE id = ${exhaustedHydration!.id}::uuid
    `;
    expect(hydrationState).toEqual({ hydration_status: "failed", hydration_attempt: 5 });

    const verify = spyOn(imapSmtpConnector, "verify").mockResolvedValue({
      authenticatedPrincipal: "sender@example.com",
      serverIdentity: { serverInfo: { name: "fixture" } },
      capabilities: {
        idle: true,
        condstore: true,
        qresync: true,
        move: true,
        uidplus: true,
        namespace: true,
        listExtended: true,
        specialUse: true,
        acl: false,
        notify: false,
        gmailExtensions: false,
      },
      accounts: [{ id: "sender@example.com", name: "Fixture", locator: {}, namespaces: [] }],
    });
    try {
      const replaced = await replaceProviderConnection({
        context,
        connectionId: connection!.id,
        input: {
          name: "Fixture",
          email: "sender@example.com",
          username: "sender@example.com",
          imap: { host: "imap.example.com", port: 993, tlsMode: "implicit" },
          smtp: { host: "smtp.example.com", port: 587, tlsMode: "starttls" },
          secret: { kind: "password", password: "replacement-secret" },
        },
      });
      expect(replaced.ok).toBe(true);
    } finally {
      verify.mockRestore();
    }
    const [credentialState] = await sql<
      {
        secret_revision: number;
        binding_state: string;
        verified_secret_revision: number;
        sender_revoked: boolean;
        identity_status: string;
        resource_status: string;
        mailbox_health: string;
      }[]
    >`
      SELECT
        pc.secret_revision,
        pb.state AS binding_state,
        pb.verified_secret_revision,
        sib.revoked_at IS NOT NULL AS sender_revoked,
        si.status AS identity_status,
        rr.status AS resource_status,
        m.health AS mailbox_health
      FROM mail.provider_connections pc
      JOIN mail.provider_bindings pb ON pb.connection_id = pc.id
      JOIN mail.sender_identity_bindings sib ON sib.binding_id = pb.id
      JOIN mail.sender_identities si ON si.id = sib.sender_identity_id
      JOIN mail.remote_resources rr ON rr.id = pb.remote_resource_id
      JOIN mail.mailboxes m ON m.id = rr.mailbox_id
      WHERE pc.id = ${connection!.id}::uuid
    `;
    expect(credentialState).toEqual({
      secret_revision: 2,
      binding_state: "pending",
      verified_secret_revision: 1,
      sender_revoked: true,
      identity_status: "unverified",
      resource_status: "connection_required",
      mailbox_health: "connection_required",
    });
  }, 30_000);
});
