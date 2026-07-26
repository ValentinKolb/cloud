import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { deleteWorkflowScope, emitWorkflowEvent } from "@valentinkolb/cloud/workflows/store";
import { sql } from "bun";
import { migrate } from "../migrate";
import type { MailRequestContext } from "./auth";
import { createMailbox } from "./mailboxes";
import { type MailWorkflowTargetSnapshot, mailWorkflowEventContext } from "./workflow-data";
import { activateWorkflow, createWorkflow } from "./workflow-definition-service";
import { runMailWorkflow } from "./workflow-runtime";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

suite("Mail shared workflow kernel", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  let userId = "";
  let mailboxId = "";
  let context: MailRequestContext;

  beforeAll(async () => {
    await migrate();
    const [user] = await sql<{ id: string; uid: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES (${`mail-workflow-kernel-${suffix}`}, 'local', 'user', 'Mail workflow kernel', false)
      RETURNING id, uid
    `;
    if (!user) throw new Error("Failed to create Mail workflow test user");
    userId = user.id;
    context = {
      actor: {
        kind: "user",
        user: {
          id: user.id,
          uid: user.uid,
          provider: "local",
          profile: "user",
          displayName: "Mail workflow kernel",
          givenName: "Mail",
          sn: "Workflow",
          mail: `${user.uid}@example.test`,
          roles: ["user"],
          memberofGroupIds: [],
          memberofGroups: [],
        } as never,
      },
      accessSubject: { type: "user", userId: user.id },
      requestId: `mail-workflow-kernel-${suffix}`,
    };
    const mailbox = await createMailbox(context, { name: `Workflow kernel ${suffix}` });
    if (!mailbox.ok) throw new Error(mailbox.error.message);
    mailboxId = mailbox.data.id;
  });

  afterAll(async () => {
    if (mailboxId) {
      const access = await sql<{ access_id: string }[]>`
        DELETE FROM mail.mailbox_access
        WHERE mailbox_id = ${mailboxId}::uuid
        RETURNING access_id
      `;
      await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
      await deleteWorkflowScope({ appId: "mail", scopeId: mailboxId });
      if (access.length) {
        await sql`
          DELETE FROM auth.access
          WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${access.map((row) => row.access_id)}::jsonb))
        `;
      }
    }
    if (userId) await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
  });

  test("dispatches an active Mail event and completes its kernel run", async () => {
    const created = await createWorkflow({
      context,
      mailboxId,
      input: {
        name: "Event dispatch",
        priority: 100,
        source: `triggers:
  messageReceived:
    with: {}
steps:
  - succeed:
      message: Event handled
`,
        effectBudget: {
          maxTargets: 1,
          maxMoves: 0,
          maxCopies: 0,
          maxSends: 0,
          maxDrafts: 0,
          maxFlagChanges: 0,
          maxNotifications: 0,
          maxKeywordChanges: 0,
          maxCollaborationChanges: 0,
        },
      },
    });
    if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message}`);
    const activated = await activateWorkflow({
      context,
      mailboxId,
      workflowId: created.data.id,
      input: { expectedVersionId: created.data.currentVersion.id },
    });
    if (!activated.ok) throw new Error(`${activated.error.code}: ${activated.error.message}`);

    const target = {
      targetKey: crypto.randomUUID(),
      source: {
        message: { id: crypto.randomUUID(), remoteMessageRefId: crypto.randomUUID() },
        conversation: null,
      },
      preconditions: {
        sourceHash: "event-context-test",
        remoteState: { modseq: "42", flags: ["seen"], keywords: ["review"] },
        conversation: null,
        triggerKind: "messageReceived",
      },
      internalDate: new Date().toISOString(),
    } as unknown as MailWorkflowTargetSnapshot;
    const emission = await emitWorkflowEvent(
      {
        appId: "mail",
        scopeId: mailboxId,
        type: "mail.messageReceived",
        targetWorkflowId: created.data.id,
        data: {},
        context: mailWorkflowEventContext(mailboxId, target),
        dedupeKey: `mail-workflow-kernel-${suffix}`,
        occurredAt: new Date(),
      },
      { dispatch: "now" },
    );
    expect(emission.runIds).toHaveLength(1);
    const outcome = await runMailWorkflow(emission.runIds[0]!);
    expect(outcome.state).toBe("finished");
    const [stored] = await sql<{ state: string; event_id: string | null; context: Record<string, unknown> | string }[]>`
      SELECT state, event_id::text, context
      FROM workflows.run
      WHERE id = ${emission.runIds[0]}::uuid
    `;
    expect(stored).toMatchObject({ state: "succeeded", event_id: emission.eventId });
    expect(typeof stored?.context === "string" ? JSON.parse(stored.context) : stored?.context).toMatchObject({
      preconditions: target.preconditions,
    });
  });

  test("restores projected conversation revisions after a lost worker lease", async () => {
    const [conversation] = await sql<{ id: string; revision: number }[]>`
      INSERT INTO mail.conversations (mailbox_id, subject, participant_summary, latest_message_at)
      VALUES (${mailboxId}::uuid, 'Recovery test', 'Sender', now())
      RETURNING id, revision
    `;
    if (!conversation) throw new Error("Failed to create workflow conversation");

    const created = await createWorkflow({
      context,
      mailboxId,
      input: {
        name: "Projection recovery",
        priority: 100,
        source: `inputs:
  conversation:
    type: mailConversation
    required: true
triggers:
  messageReceived:
    with:
      conversation: "\${{ trigger.conversation }}"
steps:
  - setConversationStatus:
      conversation: inputs.conversation
      status: waiting
  - setConversationStatus:
      conversation: inputs.conversation
      status: done
`,
        effectBudget: {
          maxTargets: 1,
          maxMoves: 0,
          maxCopies: 0,
          maxSends: 0,
          maxDrafts: 0,
          maxFlagChanges: 0,
          maxNotifications: 0,
          maxKeywordChanges: 0,
          maxCollaborationChanges: 2,
        },
      },
    });
    if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message}`);
    const activated = await activateWorkflow({
      context,
      mailboxId,
      workflowId: created.data.id,
      input: { expectedVersionId: created.data.currentVersion.id },
    });
    if (!activated.ok) throw new Error(`${activated.error.code}: ${activated.error.message}`);

    const snapshot = {
      targetKey: crypto.randomUUID(),
      source: {
        message: {
          id: crypto.randomUUID(),
          remoteMessageRefId: crypto.randomUUID(),
        },
        conversation: {
          id: conversation.id,
          subject: "Recovery test",
          assigneeUserId: null,
          workStatus: "needs_action",
          revision: conversation.revision,
          latestMessageAt: new Date().toISOString(),
        },
      },
      preconditions: {
        sourceHash: "recovery-test",
        remoteState: { modseq: "1", flags: [], keywords: [] },
        conversation: { id: conversation.id, revision: conversation.revision },
        triggerKind: "messageReceived",
      },
      internalDate: new Date().toISOString(),
    } as unknown as MailWorkflowTargetSnapshot;
    const emission = await emitWorkflowEvent(
      {
        appId: "mail",
        scopeId: mailboxId,
        type: "mail.messageReceived",
        targetWorkflowId: created.data.id,
        data: { conversation: snapshot.source.conversation },
        context: mailWorkflowEventContext(mailboxId, snapshot),
        dedupeKey: `mail-workflow-recovery-${suffix}`,
        occurredAt: new Date(),
      },
      { dispatch: "now" },
    );
    const runId = emission.runIds[0]!;
    let tookOver = false;
    const first = await runMailWorkflow(runId, {
      emit: async (event) => {
        if (!tookOver && event.type === "step.finished" && event.result.mode === "execute" && event.result.outcome.state === "completed") {
          tookOver = true;
          await sql`UPDATE workflows.run SET execution_generation = execution_generation + 1 WHERE id = ${runId}::uuid`;
        }
      },
    });
    expect(first.state).toBe("lost");

    await sql`
      UPDATE workflows.run
      SET state = 'queued', retry_after = NULL, lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ${runId}::uuid
    `;
    const second = await runMailWorkflow(runId);
    expect(second.state).toBe("finished");
    const [stored] = await sql<{ state: string; revision: string | number; work_status: string }[]>`
      SELECT run.state, conversation.revision, conversation.work_status
      FROM workflows.run run
      JOIN mail.conversations conversation ON conversation.id = ${conversation.id}::uuid
      WHERE run.id = ${runId}::uuid
    `;
    expect(stored).toEqual({ state: "succeeded", revision: String(Number(conversation.revision) + 2), work_status: "done" });
  });
});
