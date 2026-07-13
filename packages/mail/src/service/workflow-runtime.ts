import type { RequestActor } from "@valentinkolb/cloud/server";
import { accounts, serviceAccounts, toPgTextArray } from "@valentinkolb/cloud/services";
import { job, scheduler } from "@valentinkolb/sync";
import { sql } from "bun";
import type {
  ActorCommandInput,
  RemoteMessagePrecondition,
  WorkflowAction,
  WorkflowDefinition,
  WorkflowRunState,
  WorkflowTargetQuery,
} from "../contracts";
import {
  remoteMessagePreconditionSchema,
  workflowActionSchema,
  workflowDefinitionSchema,
  workflowTargetQuerySchema,
} from "../contracts";
import type { MailRequestContext } from "./auth";
import { updateConversationCollaborationInTransaction } from "./collaboration";
import { createWorkflowCommand } from "./commands";
import { type MailCollaborationEvent, publishMailCollaborationEvent } from "./events";
import { resolveMailExecution } from "./execution";
import { getWorkflowSnapshot } from "./workflow-data";
import { workflowSnapshotRequirements } from "./workflow-evaluator";

const WORKFLOW_JOB_LEASE_MS = 3 * 60_000;
const MAX_SLICE_OPERATIONS = 100;

type DbRuntimeRun = {
  id: string;
  mailbox_id: string;
  workflow_version_id: string;
  state: WorkflowRunState;
  actor_kind: "user" | "service_account";
  actor_id: string;
  delegated_user_id: string | null;
  access_subject_kind: "user" | "service_account";
  access_subject_id: string;
  credential_scopes: string[] | null;
  credential_id: string | null;
  credential_expires_at: Date | string | null;
  definition: WorkflowDefinition;
  target_query: WorkflowTargetQuery;
};

type DbRuntimeRunRow = Omit<DbRuntimeRun, "definition" | "target_query"> & {
  definition: WorkflowDefinition | string;
  target_query: WorkflowTargetQuery | string;
};

type DbTarget = {
  run_id: string;
  ordinal: string | number;
  remote_message_ref_id: string;
  message_id: string;
  conversation_id: string | null;
  source_folder_id: string;
  source_state_hash: string;
  state: "pending" | "running" | "waiting_command" | "succeeded" | "failed" | "needs_attention";
  planned_action_count: number;
};

type DbStep = {
  id: string;
  run_id: string;
  target_ordinal: string | number;
  sequence: number;
  step_path: string;
  action: WorkflowAction | string;
  expected_conversation_revision: string | number | null;
  expected_remote_state: RemoteMessagePrecondition | string | null;
  idempotency_key: string;
  state: "queued" | "executing" | "waiting_command" | "succeeded" | "failed" | "needs_attention";
  command_id: string | null;
};

type StepOutcome = "continue" | "waiting" | "terminal";

const activeRunStates: WorkflowRunState[] = ["queued", "running", "waiting_command"];
const terminalRunStates: WorkflowRunState[] = ["succeeded", "failed", "canceled", "needs_attention"];
type SqlClient = typeof sql;

const parseAction = (value: WorkflowAction | string): WorkflowAction | null => {
  try {
    const parsed = workflowActionSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const parseRemotePrecondition = (value: RemoteMessagePrecondition | string | null): RemoteMessagePrecondition | null => {
  if (value === null) return null;
  try {
    const parsed = remoteMessagePreconditionSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const loadRuntimeRun = async (runId: string): Promise<DbRuntimeRun | null> => {
  const [run] = await sql<DbRuntimeRunRow[]>`
    SELECT
      run.id, run.mailbox_id, run.workflow_version_id, run.state, run.actor_kind, run.actor_id, run.delegated_user_id,
      run.access_subject_kind, run.access_subject_id, run.credential_scopes, run.credential_id, run.credential_expires_at,
      run.target_query, version.definition
    FROM mail.workflow_runs run
    JOIN mail.workflow_versions version
      ON version.id = run.workflow_version_id
     AND version.workflow_id = run.workflow_id
     AND version.mailbox_id = run.mailbox_id
    WHERE run.id = ${runId}::uuid
  `;
  if (!run) return null;
  let definitionInput: unknown;
  let queryInput: unknown;
  try {
    definitionInput = typeof run.definition === "string" ? JSON.parse(run.definition) : run.definition;
    queryInput = typeof run.target_query === "string" ? JSON.parse(run.target_query) : run.target_query;
  } catch {
    definitionInput = null;
    queryInput = null;
  }
  const definition = workflowDefinitionSchema.safeParse(definitionInput);
  const targetQuery = workflowTargetQuerySchema.safeParse(queryInput);
  if (!definition.success || !targetQuery.success) {
    await sql`
      UPDATE mail.workflow_runs
      SET
        state = 'needs_attention',
        last_error_code = 'WORKFLOW_SNAPSHOT_INVALID',
        last_error_message = 'Stored workflow definition or target query is invalid',
        finished_at = now()
      WHERE id = ${runId}::uuid AND state IN ('queued', 'running', 'waiting_command')
    `;
    return null;
  }
  return { ...run, definition: definition.data, target_query: targetQuery.data };
};

const userAccountActive = (user: { accountExpires: string | null }): boolean =>
  user.accountExpires === null || Date.parse(user.accountExpires) > Date.now();

const workflowCredentialActive = async (run: DbRuntimeRun): Promise<boolean> => {
  if (!run.credential_id) {
    const expiresAt = run.credential_expires_at ? new Date(run.credential_expires_at).getTime() : Number.NaN;
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }
  const [credential] = await sql<{ active: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM auth.service_account_credentials credential
      WHERE credential.id = ${run.credential_id}::uuid
        AND credential.service_account_id = ${run.actor_id}::uuid
        AND credential.status = 'active'
        AND credential.revoked_at IS NULL
        AND (credential.expires_at IS NULL OR credential.expires_at > now())
        AND credential.scopes @> ${toPgTextArray(run.credential_scopes ?? [])}::text[]
        AND credential.scopes <@ ${toPgTextArray(run.credential_scopes ?? [])}::text[]
    ) AS active
  `;
  return credential?.active === true;
};

const loadRuntimeContext = async (run: DbRuntimeRun): Promise<MailRequestContext | null> => {
  let actor: RequestActor;
  if (run.actor_kind === "user") {
    const user = await accounts.users.get({ id: run.actor_id });
    if (!user || !userAccountActive(user) || run.access_subject_kind !== "user" || run.access_subject_id !== user.id) return null;
    actor = { kind: "user", user };
  } else {
    if (!(await workflowCredentialActive(run))) return null;
    const serviceAccount = await serviceAccounts.get({ id: run.actor_id });
    if (!serviceAccount || serviceAccount.status !== "active" || serviceAccount.delegatedUserId !== run.delegated_user_id) return null;
    const delegatedUser = serviceAccount.delegatedUserId ? await accounts.users.get({ id: serviceAccount.delegatedUserId }) : null;
    if (serviceAccount.kind === "user_delegated" && (!delegatedUser || !userAccountActive(delegatedUser))) return null;
    actor = {
      kind: "service_account",
      serviceAccount,
      delegatedUser,
      scopes: run.credential_scopes ?? [],
      credentialId: run.credential_id,
      credentialExpiresAt:
        run.credential_expires_at instanceof Date
          ? run.credential_expires_at.toISOString()
          : run.credential_expires_at,
    };
  }
  return {
    actor,
    accessSubject:
      run.access_subject_kind === "user"
        ? { type: "user", userId: run.access_subject_id }
        : { type: "service_account", serviceAccountId: run.access_subject_id },
    requestId: `mail-workflow:${run.id}`,
  };
};

const recordTerminalActivity = async (params: {
  db: typeof sql;
  run: DbRuntimeRun;
  state: "succeeded" | "failed" | "canceled" | "needs_attention";
  code?: string | null;
  message?: string | null;
}): Promise<void> => {
  await params.db`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.run.mailbox_id}::uuid, 'workflow', ${params.run.workflow_version_id}::uuid,
      'workflow.run', ${params.state === "succeeded" ? "confirmed" : "failed"},
      'workflow_run', ${params.run.id}::uuid,
      ${{ state: params.state, code: params.code ?? null, message: params.message ?? null }}::jsonb
    )
  `;
};

const transitionTargetTerminal = async (params: {
  db: SqlClient;
  runId: string;
  ordinal: number;
  state: "succeeded" | "failed" | "needs_attention";
  code?: string | null;
  message?: string | null;
  requireStepsSucceeded?: boolean;
}): Promise<boolean> => {
  const [updated] = await params.db<{ ordinal: string | number }[]>`
    UPDATE mail.workflow_run_targets target
    SET
      state = ${params.state},
      last_error_code = ${params.code ?? null},
      last_error_message = ${params.message?.slice(0, 1_000) ?? null},
      started_at = COALESCE(started_at, now()),
      finished_at = now()
    WHERE target.run_id = ${params.runId}::uuid
      AND target.ordinal = ${params.ordinal}
      AND target.state IN ('pending', 'running', 'waiting_command')
      AND (
        ${params.requireStepsSucceeded === true} = false
        OR NOT EXISTS (
          SELECT 1 FROM mail.workflow_step_runs step
          WHERE step.run_id = target.run_id
            AND step.target_ordinal = target.ordinal
            AND step.state <> 'succeeded'
        )
      )
    RETURNING ordinal
  `;
  if (!updated) return false;
  await params.db`
    UPDATE mail.workflow_runs
    SET
      completed_targets = completed_targets + ${params.state === "succeeded" ? 1 : 0},
      failed_targets = failed_targets + ${params.state === "succeeded" ? 0 : 1},
      cursor_ordinal = CASE
        WHEN ${params.state === "succeeded"} THEN GREATEST(cursor_ordinal, ${params.ordinal})
        ELSE cursor_ordinal
      END
    WHERE id = ${params.runId}::uuid
  `;
  return true;
};

const cancelRun = async (run: DbRuntimeRun, code: string, message: string): Promise<WorkflowRunState> => {
  return sql.begin(async (tx) => {
    const [current] = await tx<{ state: WorkflowRunState }[]>`
      SELECT state FROM mail.workflow_runs WHERE id = ${run.id}::uuid FOR UPDATE
    `;
    if (!current || terminalRunStates.includes(current.state)) return current?.state ?? "failed";
    const [waiting] = await tx<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM mail.workflow_step_runs
        WHERE run_id = ${run.id}::uuid AND state = 'waiting_command'
      ) AS exists
    `;
    if (waiting?.exists) return "waiting_command";
    await tx`
      UPDATE mail.workflow_step_runs
      SET
        state = 'failed',
        last_error_code = ${code},
        last_error_message = ${message.slice(0, 1_000)},
        provider_lease_token = NULL,
        provider_lease_expires_at = NULL,
        finished_at = now()
      WHERE run_id = ${run.id}::uuid AND state IN ('queued', 'executing')
    `;
    await tx`
      UPDATE mail.workflow_run_targets
      SET
        state = 'failed',
        last_error_code = ${code},
        last_error_message = ${message.slice(0, 1_000)},
        finished_at = now()
      WHERE run_id = ${run.id}::uuid AND state IN ('pending', 'running')
    `;
    const [counts] = await tx<{ completed: number; failed: number }[]>`
      SELECT
        COUNT(*) FILTER (WHERE state = 'succeeded')::int AS completed,
        COUNT(*) FILTER (WHERE state IN ('failed', 'needs_attention'))::int AS failed
      FROM mail.workflow_run_targets
      WHERE run_id = ${run.id}::uuid
    `;
    const [updated] = await tx<{ id: string }[]>`
      UPDATE mail.workflow_runs
      SET
        state = 'canceled',
        completed_targets = ${counts?.completed ?? 0},
        failed_targets = ${counts?.failed ?? 0},
        last_error_code = ${code},
        last_error_message = ${message.slice(0, 1_000)},
        finished_at = now()
      WHERE id = ${run.id}::uuid AND state IN ('queued', 'running', 'waiting_command')
      RETURNING id
    `;
    if (updated) await recordTerminalActivity({ db: tx, run, state: "canceled", code, message });
    return updated ? "canceled" : current.state;
  });
};

const refreshRunState = async (run: DbRuntimeRun): Promise<WorkflowRunState> =>
  sql.begin(async (tx) => {
    const [current] = await tx<{ state: WorkflowRunState }[]>`
      SELECT state FROM mail.workflow_runs WHERE id = ${run.id}::uuid FOR UPDATE
    `;
    if (!current || terminalRunStates.includes(current.state)) return current?.state ?? "failed";
    const [summary] = await tx<
      {
        active: boolean;
        waiting_command: boolean;
        failed: boolean;
        attention: boolean;
        error_code: string | null;
        error_message: string | null;
      }[]
    >`
      SELECT
        EXISTS (
          SELECT 1 FROM mail.workflow_run_targets
          WHERE run_id = ${run.id}::uuid AND state IN ('pending', 'running', 'waiting_command')
        ) AS active,
        EXISTS (
          SELECT 1 FROM mail.workflow_run_targets
          WHERE run_id = ${run.id}::uuid AND state = 'waiting_command'
        ) AS waiting_command,
        EXISTS (
          SELECT 1 FROM mail.workflow_run_targets
          WHERE run_id = ${run.id}::uuid AND state = 'failed'
        ) AS failed,
        EXISTS (
          SELECT 1 FROM mail.workflow_run_targets
          WHERE run_id = ${run.id}::uuid AND state = 'needs_attention'
        ) AS attention,
        (
          SELECT last_error_code FROM mail.workflow_run_targets
          WHERE run_id = ${run.id}::uuid AND last_error_code IS NOT NULL
          ORDER BY ordinal LIMIT 1
        ) AS error_code,
        (
          SELECT last_error_message FROM mail.workflow_run_targets
          WHERE run_id = ${run.id}::uuid AND last_error_message IS NOT NULL
          ORDER BY ordinal LIMIT 1
        ) AS error_message
    `;
    const nextState: WorkflowRunState =
      summary?.active
        ? summary.waiting_command
          ? "waiting_command"
          : "running"
        : summary?.attention
          ? "needs_attention"
          : summary?.failed
            ? "failed"
            : "succeeded";
    const terminal = terminalRunStates.includes(nextState);
    const [updated] = await tx<{ state: WorkflowRunState }[]>`
      UPDATE mail.workflow_runs
      SET
        state = ${nextState},
        last_error_code = ${summary?.error_code ?? null},
        last_error_message = ${summary?.error_message ?? null},
        started_at = COALESCE(started_at, now()),
        finished_at = CASE WHEN ${terminal} THEN COALESCE(finished_at, now()) ELSE NULL END
      WHERE id = ${run.id}::uuid
      RETURNING state
    `;
    if (terminal && updated && !terminalRunStates.includes(current.state)) {
      await recordTerminalActivity({
        db: tx,
        run,
        state: nextState as "succeeded" | "failed" | "needs_attention",
        code: summary?.error_code,
        message: summary?.error_message,
      });
    }
    return updated?.state ?? nextState;
  });

const loadFirstIncompleteTarget = async (runId: string): Promise<DbTarget | null> => {
  const [target] = await sql<DbTarget[]>`
    SELECT
      run_id, ordinal, remote_message_ref_id, message_id, conversation_id,
      source_folder_id, source_state_hash, state, planned_action_count
    FROM mail.workflow_run_targets
    WHERE run_id = ${runId}::uuid AND state IN ('pending', 'running', 'waiting_command')
    ORDER BY ordinal
    LIMIT 1
  `;
  return target ?? null;
};

const activateTarget = async (run: DbRuntimeRun, ordinal: number): Promise<"running" | "succeeded" | "terminal"> =>
  sql.begin(async (tx) => {
    const [target] = await tx<DbTarget[]>`
      SELECT
        run_id, ordinal, remote_message_ref_id, message_id, conversation_id,
        source_folder_id, source_state_hash, state, planned_action_count
      FROM mail.workflow_run_targets
      WHERE run_id = ${run.id}::uuid AND ordinal = ${ordinal}
      FOR UPDATE
    `;
    if (!target) return "terminal";
    if (target.state === "succeeded") return "succeeded";
    if (target.state !== "pending") return target.state === "running" || target.state === "waiting_command" ? "running" : "terminal";
    const snapshot = await getWorkflowSnapshot({
      mailboxId: run.mailbox_id,
      remoteMessageRefId: target.remote_message_ref_id,
      query: run.target_query,
      requirements: workflowSnapshotRequirements(run.definition),
      db: tx,
    });
    if (
      !snapshot ||
      snapshot.messageId !== target.message_id ||
      snapshot.conversationId !== target.conversation_id ||
      snapshot.sourceStateHash !== target.source_state_hash
    ) {
      await transitionTargetTerminal({
        db: tx,
        runId: run.id,
        ordinal,
        state: "needs_attention",
        code: "TARGET_STATE_CHANGED",
        message: "Message, query membership, or collaboration state changed after preview",
      });
      return "terminal";
    }
    if (target.planned_action_count === 0) {
      await transitionTargetTerminal({ db: tx, runId: run.id, ordinal, state: "succeeded" });
      return "succeeded";
    }
    await tx`
      UPDATE mail.workflow_run_targets
      SET state = 'running', started_at = COALESCE(started_at, now())
      WHERE run_id = ${run.id}::uuid AND ordinal = ${ordinal}
    `;
    return "running";
  });

const loadFirstIncompleteStep = async (runId: string, ordinal: number): Promise<DbStep | null> => {
  const [step] = await sql<DbStep[]>`
    SELECT
      id, run_id, target_ordinal, sequence, step_path, action, expected_conversation_revision,
      expected_remote_state, idempotency_key, state, command_id
    FROM mail.workflow_step_runs
    WHERE run_id = ${runId}::uuid AND target_ordinal = ${ordinal} AND state <> 'succeeded'
    ORDER BY sequence
    LIMIT 1
  `;
  return step ?? null;
};

const finishTarget = async (runId: string, ordinal: number): Promise<void> => {
  await sql.begin((tx) =>
    transitionTargetTerminal({ db: tx, runId, ordinal, state: "succeeded", requireStepsSucceeded: true }),
  );
};

const markStepTerminal = async (params: {
  step: DbStep;
  state: "failed" | "needs_attention";
  code: string;
  message: string;
  providerLeaseToken?: string;
}): Promise<boolean> =>
  sql.begin(async (tx) => {
    const [updated] = await tx<{ id: string }[]>`
      UPDATE mail.workflow_step_runs
      SET
        state = ${params.state},
        last_error_code = ${params.code},
        last_error_message = ${params.message.slice(0, 1_000)},
        provider_lease_token = NULL,
        provider_lease_expires_at = NULL,
        finished_at = now()
      WHERE id = ${params.step.id}::uuid
        AND state IN ('queued', 'executing', 'waiting_command')
        AND (
          ${params.providerLeaseToken ?? null}::uuid IS NULL
          OR provider_lease_token = ${params.providerLeaseToken ?? null}::uuid
        )
      RETURNING id
    `;
    if (!updated) return false;
    await transitionTargetTerminal({
      db: tx,
      runId: params.step.run_id,
      ordinal: Number(params.step.target_ordinal),
      state: params.state,
      code: params.code,
      message: params.message,
    });
    return true;
  });

const commandInputForAction = (params: { action: WorkflowAction; target: DbTarget; step: DbStep }): ActorCommandInput | null => {
  const base = { idempotencyKey: params.step.idempotency_key, correlationId: params.step.run_id };
  const expectedRemoteState = parseRemotePrecondition(params.step.expected_remote_state);
  if (!expectedRemoteState) return null;
  if (params.action.action === "remote.keyword.add") {
    return {
      ...base,
      kind: "change_message_state",
      remoteMessageRefId: params.target.remote_message_ref_id,
      folderId: params.target.source_folder_id,
      change: { addFlags: [], removeFlags: [], addKeywords: [params.action.keyword], removeKeywords: [] },
      expectedRemoteState,
    };
  }
  if (params.action.action === "remote.keyword.remove") {
    return {
      ...base,
      kind: "change_message_state",
      remoteMessageRefId: params.target.remote_message_ref_id,
      folderId: params.target.source_folder_id,
      change: { addFlags: [], removeFlags: [], addKeywords: [], removeKeywords: [params.action.keyword] },
      expectedRemoteState,
    };
  }
  if (params.action.action === "remote.move") {
    return {
      ...base,
      kind: "move",
      remoteMessageRefId: params.target.remote_message_ref_id,
      sourceFolderId: params.target.source_folder_id,
      destinationFolderId: params.action.destinationFolderId,
      expectedRemoteState,
    };
  }
  return null;
};

const processWaitingCommand = async (step: DbStep): Promise<StepOutcome> => {
  if (!step.command_id) {
    await markStepTerminal({
      step,
      state: "needs_attention",
      code: "COMMAND_LINK_MISSING",
      message: "Workflow command link is missing",
    });
    return "terminal";
  }
  const [command] = await sql<{ state: string; last_error_code: string | null; last_error_message: string | null }[]>`
    SELECT state, last_error_code, last_error_message
    FROM mail.commands
    WHERE id = ${step.command_id}::uuid
  `;
  if (!command) {
    await markStepTerminal({ step, state: "needs_attention", code: "COMMAND_MISSING", message: "Workflow command no longer exists" });
    return "terminal";
  }
  if (["confirmed", "reconciled"].includes(command.state)) {
    await sql.begin(async (tx) => {
      const [updated] = await tx<{ id: string }[]>`
        UPDATE mail.workflow_step_runs
        SET state = 'succeeded', result = ${{ commandId: step.command_id, state: command.state }}::jsonb, finished_at = now()
        WHERE id = ${step.id}::uuid AND state = 'waiting_command'
        RETURNING id
      `;
      if (!updated) return;
      await tx`
        UPDATE mail.workflow_run_targets
        SET state = 'running'
        WHERE run_id = ${step.run_id}::uuid AND ordinal = ${Number(step.target_ordinal)} AND state = 'waiting_command'
      `;
    });
    return "continue";
  }
  if (command.state === "needs_attention") {
    await markStepTerminal({
      step,
      state: "needs_attention",
      code: command.last_error_code ?? "COMMAND_NEEDS_ATTENTION",
      message: command.last_error_message ?? "Provider command needs attention",
    });
    return "terminal";
  }
  if (["failed", "cancelled"].includes(command.state)) {
    await markStepTerminal({
      step,
      state: "failed",
      code: command.last_error_code ?? "COMMAND_FAILED",
      message: command.last_error_message ?? "Provider command failed",
    });
    return "terminal";
  }
  return "waiting";
};

const processProviderStep = async (params: {
  run: DbRuntimeRun;
  context: MailRequestContext;
  target: DbTarget;
  step: DbStep;
  action: WorkflowAction;
}): Promise<StepOutcome> => {
  if (params.step.state === "waiting_command") return processWaitingCommand(params.step);
  const input = commandInputForAction(params);
  if (!input) {
    await markStepTerminal({ step: params.step, state: "failed", code: "INVALID_PROVIDER_ACTION", message: "Unsupported provider action" });
    return "terminal";
  }
  const providerLeaseToken = crypto.randomUUID();
  const [claimed] = await sql<{ id: string }[]>`
    UPDATE mail.workflow_step_runs
    SET
      state = 'executing',
      attempt = attempt + 1,
      provider_lease_token = ${providerLeaseToken}::uuid,
      provider_lease_expires_at = now() + (${WORKFLOW_JOB_LEASE_MS} * interval '1 millisecond'),
      started_at = COALESCE(started_at, now())
    WHERE id = ${params.step.id}::uuid
      AND (
        state = 'queued'
        OR (state = 'executing' AND (provider_lease_expires_at IS NULL OR provider_lease_expires_at <= now()))
      )
    RETURNING id
  `;
  if (!claimed) {
    const current = await loadFirstIncompleteStep(params.run.id, Number(params.target.ordinal));
    if (current?.id === params.step.id && current.state === "waiting_command") return processWaitingCommand(current);
    return current?.id === params.step.id && current.state === "executing" ? "waiting" : "continue";
  }
  const command = await createWorkflowCommand({
    context: params.context,
    mailboxId: params.run.mailbox_id,
    workflowVersionId: params.run.workflow_version_id,
    input,
  });
  if (!command.ok) {
    if (command.error.code === "FORBIDDEN") {
      const fenced = await markStepTerminal({
        step: params.step,
        state: "failed",
        code: "ACCESS_REVOKED",
        message: "Mailbox or provider write access was revoked before workflow execution",
        providerLeaseToken,
      });
      if (fenced) await cancelRun(params.run, "ACCESS_REVOKED", "Mailbox or provider write access was revoked before workflow execution");
      return "terminal";
    }
    if (command.error.code === "INTERNAL") {
      const [released] = await sql<{ id: string }[]>`
        UPDATE mail.workflow_step_runs
        SET
          state = 'queued',
          provider_lease_token = NULL,
          provider_lease_expires_at = NULL,
          last_error_code = 'COMMAND_CREATE_RETRY',
          last_error_message = 'Provider command creation had an unknown outcome and will be retried'
        WHERE id = ${params.step.id}::uuid
          AND state = 'executing'
          AND provider_lease_token = ${providerLeaseToken}::uuid
        RETURNING id
      `;
      if (released) {
        throw Object.assign(new Error("Provider command creation had an unknown outcome"), { code: "COMMAND_CREATE_RETRY" });
      }
      return "continue";
    }
    await markStepTerminal({
      step: params.step,
      state: ["BAD_INPUT", "CONFLICT", "NOT_FOUND"].includes(command.error.code) ? "needs_attention" : "failed",
      code: command.error.code,
      message: command.error.message,
      providerLeaseToken,
    });
    return "terminal";
  }
  const transitioned = await sql.begin(async (tx) => {
    const [updated] = await tx<{ id: string }[]>`
      UPDATE mail.workflow_step_runs
      SET
        state = 'waiting_command',
        command_id = ${command.data.id}::uuid,
        provider_lease_token = NULL,
        provider_lease_expires_at = NULL
      WHERE id = ${params.step.id}::uuid
        AND state = 'executing'
        AND provider_lease_token = ${providerLeaseToken}::uuid
      RETURNING id
    `;
    if (!updated) return false;
    await tx`
      UPDATE mail.workflow_run_targets
      SET state = 'waiting_command'
      WHERE run_id = ${params.run.id}::uuid AND ordinal = ${Number(params.target.ordinal)} AND state = 'running'
    `;
    return true;
  });
  return transitioned ? "waiting" : "continue";
};

const processCollaborationStep = async (params: {
  run: DbRuntimeRun;
  context: MailRequestContext;
  target: DbTarget;
  step: DbStep;
  action: WorkflowAction;
}): Promise<StepOutcome> => {
  if (!params.target.conversation_id || params.step.expected_conversation_revision == null) {
    await markStepTerminal({
      step: params.step,
      state: "needs_attention",
      code: "CONVERSATION_UNAVAILABLE",
      message: "Conversation state required by the workflow is unavailable",
    });
    return "terminal";
  }
  const expectedRevision = Number(params.step.expected_conversation_revision);
  const result = await sql.begin(async (tx) => {
    const currentAccess = await resolveMailExecution({
      mailboxId: params.run.mailbox_id,
      operation: "actorMutation",
      context: params.context,
      db: tx,
    });
    if (!currentAccess.ok || !currentAccess.data.bindingId) return { kind: "canceled" as const, event: null };
    const [lockedBinding] = await tx<{ id: string }[]>`
      SELECT binding.id
      FROM mail.provider_bindings binding
      JOIN mail.provider_connections connection ON connection.id = binding.connection_id
      JOIN mail.remote_resources resource ON resource.id = binding.remote_resource_id
      WHERE binding.id = ${currentAccess.data.bindingId}::uuid
        AND resource.mailbox_id = ${params.run.mailbox_id}::uuid
        AND binding.state = 'active'
        AND binding.verified_scope_fingerprint = resource.scope_fingerprint
        AND binding.verified_secret_revision = connection.secret_revision
        AND connection.secret_revision = ${currentAccess.data.secretRevision}
        AND connection.status = 'active'
        AND connection.encrypted_secret IS NOT NULL
      FOR UPDATE OF binding, connection
    `;
    if (!lockedBinding) return { kind: "canceled" as const, event: null };
    const [current] = await tx<DbStep[]>`
      SELECT
        id, run_id, target_ordinal, sequence, step_path, action, expected_conversation_revision,
        expected_remote_state, idempotency_key, state, command_id
      FROM mail.workflow_step_runs
      WHERE id = ${params.step.id}::uuid
      FOR UPDATE
    `;
    if (!current || current.state === "succeeded") return { kind: "continue" as const, event: null };
    if (current.state !== "queued" && current.state !== "executing") return { kind: "terminal" as const, event: null };
    await tx`
      UPDATE mail.workflow_step_runs
      SET state = 'executing', attempt = attempt + 1, started_at = COALESCE(started_at, now())
      WHERE id = ${params.step.id}::uuid
    `;
    const mutation = await updateConversationCollaborationInTransaction({
      context: params.context,
      mailboxId: params.run.mailbox_id,
      conversationId: params.target.conversation_id as string,
      input:
        params.action.action === "assign"
          ? { expectedRevision, assigneeUserId: params.action.userId }
          : params.action.action === "status.set"
            ? { expectedRevision, workStatus: params.action.status }
            : { expectedRevision },
      db: tx,
      actorOverride: { kind: "workflow", workflowVersionId: params.run.workflow_version_id },
      activityMetadata: {
        workflowRunId: params.run.id,
        workflowStepRunId: params.step.id,
        workflowStepPath: params.step.step_path,
        initiator: {
          kind: params.run.actor_kind,
          id: params.run.actor_id,
          delegatedUserId: params.run.delegated_user_id,
        },
      },
    });
    if (!mutation.ok) {
      if (mutation.error.code === "FORBIDDEN") {
        await tx`
          UPDATE mail.workflow_step_runs
          SET
            state = 'failed',
            last_error_code = 'ACCESS_REVOKED',
            last_error_message = 'Mailbox write access was revoked before workflow execution',
            finished_at = now()
          WHERE id = ${params.step.id}::uuid
        `;
        await transitionTargetTerminal({
          db: tx,
          runId: params.run.id,
          ordinal: Number(params.target.ordinal),
          state: "failed",
          code: "ACCESS_REVOKED",
          message: "Mailbox write access was revoked before workflow execution",
        });
        return { kind: "canceled" as const, event: null };
      }
      await tx`
        UPDATE mail.workflow_step_runs
        SET
          state = 'needs_attention',
          last_error_code = ${mutation.error.code},
          last_error_message = ${mutation.error.message.slice(0, 1_000)},
          finished_at = now()
        WHERE id = ${params.step.id}::uuid
      `;
      await transitionTargetTerminal({
        db: tx,
        runId: params.run.id,
        ordinal: Number(params.target.ordinal),
        state: "needs_attention",
        code: mutation.error.code,
        message: mutation.error.message,
      });
      return { kind: "terminal" as const, event: null };
    }
    await tx`
      UPDATE mail.workflow_step_runs
      SET
        state = 'succeeded',
        result = ${{ conversationRevision: mutation.data.value.revision }}::jsonb,
        finished_at = now()
      WHERE id = ${params.step.id}::uuid
    `;
    return { kind: "continue" as const, event: mutation.data.event };
  });
  if (result.event) await publishMailCollaborationEvent(result.event as Omit<MailCollaborationEvent, "type" | "at">);
  if (result.kind === "canceled") {
    await cancelRun(params.run, "ACCESS_REVOKED", "Mailbox write access was revoked before workflow execution");
    return "terminal";
  }
  return result.kind;
};

const processRunSlice = async (runId: string, heartbeat: () => Promise<void>): Promise<WorkflowRunState | null> => {
  const run = await loadRuntimeRun(runId);
  if (!run) return null;
  if (terminalRunStates.includes(run.state)) return run.state;

  const state = await refreshRunState(run);
  if (terminalRunStates.includes(state)) return state;
  for (let operation = 0; operation < MAX_SLICE_OPERATIONS; operation += 1) {
    if (operation % 10 === 0) await heartbeat();
    const target = await loadFirstIncompleteTarget(run.id);
    if (!target) return refreshRunState(run);
    if (target.state === "pending") {
      const activated = await activateTarget(run, Number(target.ordinal));
      if (activated === "succeeded") continue;
      if (activated === "terminal") continue;
    }
    const currentTarget = await loadFirstIncompleteTarget(run.id);
    if (!currentTarget || Number(currentTarget.ordinal) !== Number(target.ordinal)) continue;
    const step = await loadFirstIncompleteStep(run.id, Number(currentTarget.ordinal));
    if (!step) {
      await finishTarget(run.id, Number(currentTarget.ordinal));
      continue;
    }
    if (step.state === "waiting_command") {
      const outcome = await processWaitingCommand(step);
      if (outcome === "waiting") return refreshRunState(run);
      continue;
    }
    const action = parseAction(step.action);
    if (!action) {
      await markStepTerminal({ step, state: "failed", code: "INVALID_STORED_ACTION", message: "Stored workflow action is invalid" });
      continue;
    }
    const context = await loadRuntimeContext(run);
    if (!context) return cancelRun(run, "ACTOR_UNAVAILABLE", "Workflow initiator is no longer available");
    const currentAccess = await resolveMailExecution({ mailboxId: run.mailbox_id, operation: "actorMutation", context });
    if (!currentAccess.ok) {
      return cancelRun(run, "ACCESS_REVOKED", "Mailbox or provider write access was revoked before workflow execution");
    }
    const outcome = action.action.startsWith("remote.")
      ? await processProviderStep({ run, context, target: currentTarget, step, action })
      : await processCollaborationStep({ run, context, target: currentTarget, step, action });
    if (outcome === "waiting") return refreshRunState(run);
  }
  return refreshRunState(run);
};

const workflowJob = job<{ runId: string }, { state: WorkflowRunState | null }>({
  id: "mail:execute-workflow",
  defaults: { leaseMs: WORKFLOW_JOB_LEASE_MS, keyTtlMs: 7 * 24 * 60 * 60_000 },
  process: async ({ ctx }) => ({
    state: await processRunSlice(ctx.input.runId, async () => {
      await ctx.heartbeat({ leaseMs: WORKFLOW_JOB_LEASE_MS });
    }),
  }),
  after: ({ ctx }) => {
    if (ctx.data?.state === "waiting_command") ctx.reschedule({ delayMs: 1_000 });
    else if (ctx.data?.state && activeRunStates.includes(ctx.data.state)) ctx.reschedule({ delayMs: 25 });
    else if (ctx.error && ctx.failureCount < 5) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 2_000, maxMs: 2 * 60_000 }) });
    }
  },
});

export const enqueueWorkflowRun = async (runId: string): Promise<void> => {
  await workflowJob.submit({ key: `run:${runId}`, input: { runId } });
};

const submitDueWorkflowRuns = async (): Promise<number> => {
  const runs = await sql<{ id: string }[]>`
    SELECT id
    FROM mail.workflow_runs
    WHERE state IN ('queued', 'running', 'waiting_command')
    ORDER BY updated_at, id
    LIMIT 500
  `;
  for (const run of runs) await enqueueWorkflowRun(run.id);
  return runs.length;
};

const workflowScheduler = scheduler({ id: "mail-workflows" });
let workflowRuntimeStarted = false;

export const workflowRuntime = {
  start: async (): Promise<void> => {
    if (workflowRuntimeStarted) return;
    await workflowScheduler.create({
      id: "mail:workflows-due",
      cron: "* * * * *",
      meta: { appId: "mail", family: "mail:workflows", label: "Mail workflow dispatch" },
      process: submitDueWorkflowRuns,
    });
    workflowScheduler.start();
    await submitDueWorkflowRuns();
    workflowRuntimeStarted = true;
  },
  stop: async (): Promise<void> => {
    if (workflowRuntimeStarted) await workflowScheduler.stop();
    workflowJob.stop();
    workflowRuntimeStarted = false;
  },
};

export const executeWorkflowRunSlice = processRunSlice;
