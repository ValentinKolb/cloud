import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "bun";
import type { ConnectorVerification } from "../contracts";
import { migrate } from "../migrate";
import { grantMailboxAccess, revokeMailboxAccess, updateMailboxAccess } from "./access";
import type { MailRequestContext } from "./auth";
import { confirmProviderBinding, rediscoverProviderBinding } from "./bindings";
import { sha256Json } from "./canonical";
import { createMailCommand } from "./commands";
import { imapSmtpConnector } from "./connectors";
import { getMailboxOperationalHealth } from "./health";
import { executeMaintenanceCommand, stopMaintenanceRuntime, submitDueMaintenanceCommands } from "./maintenance-runtime";
import { createMailbox, updateMailbox } from "./mailboxes";
import { createProviderConnection } from "./provider-connections";
import { claimFence, commitSyncBatch, executeBindingRediscovery, hydrateMessageBatch } from "./sync-runtime";

const enabled = process.env.MAIL_INTEGRATION_TESTS === "1";
const suite = enabled ? describe : describe.skip;

const contextFor = (user: { id: string; uid: string; admin: boolean }): MailRequestContext => ({
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
      roles: user.admin ? ["admin", "user"] : ["user"],
      memberofGroupIds: [],
      memberofGroups: [],
      admin: user.admin,
    } as never,
  },
  accessSubject: { type: "user", userId: user.id },
  requestId: `mail-lifecycle-${user.uid}`,
});

const fixtureVerification = (): ConnectorVerification => ({
  authenticatedPrincipal: "lifecycle@example.com",
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
    acl: true,
    notify: false,
    gmailExtensions: false,
  },
  accounts: [
    {
      id: "lifecycle@example.com",
      name: "Lifecycle fixture",
      locator: {},
      namespaces: [{ kind: "personal", prefix: "", delimiter: "/" }],
    },
  ],
});

const remoteFolder = (
  path: string,
  uidValidity: string,
  role: "inbox" | "other" = "other",
  rights = ["read", "write_flags", "insert", "move", "delete_messages"],
) => ({
  stableKey: `${path}:${uidValidity}`,
  path,
  name: path,
  delimiter: "/",
  parentPath: null,
  role,
  subscribed: true,
  selectable: true,
  uidValidity,
  uidNext: "1",
  highestModseq: "1",
  rights,
  rightsSource: "acl" as const,
});

suite("mail lifecycle control plane", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const users: string[] = [];
  const accessIds: string[] = [];
  let mailboxId = "";
  let connectionId = "";
  let secondaryConnectionId = "";
  let bindingId = "";
  let inboxFolderId = "";
  let adminContext: MailRequestContext;
  let collaboratorContext: MailRequestContext;

  beforeAll(async () => {
    await migrate();
    const [admin] = await sql<{ id: string; uid: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES (${`mail-lifecycle-admin-${suffix}`}, 'local', 'user', 'Mail Lifecycle Admin', true)
      RETURNING id, uid
    `;
    const [collaborator] = await sql<{ id: string; uid: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES (${`mail-lifecycle-user-${suffix}`}, 'local', 'user', 'Mail Lifecycle User', false)
      RETURNING id, uid
    `;
    if (!admin || !collaborator) throw new Error("Failed to create mail lifecycle users");
    users.push(admin.id, collaborator.id);
    adminContext = contextFor({ ...admin, admin: true });
    collaboratorContext = contextFor({ ...collaborator, admin: false });

    const mailbox = await createMailbox(adminContext, {
      name: `Lifecycle ${suffix}`,
      connectionPolicy: "shared_connection",
    });
    if (!mailbox.ok) throw new Error(mailbox.error.message);
    mailboxId = mailbox.data.id;
    const readAccess = await grantMailboxAccess({
      context: adminContext,
      mailboxId,
      principal: { type: "user", userId: collaborator.id },
      permission: "read",
    });
    if (!readAccess.ok) throw new Error(readAccess.error.message);
    accessIds.push(readAccess.data.id);

    const verify = spyOn(imapSmtpConnector, "verify").mockResolvedValue(fixtureVerification());
    try {
      const connection = await createProviderConnection({
        context: adminContext,
        owner: { type: "mailbox", mailboxId },
        input: {
          name: `Lifecycle fixture ${suffix}`,
          email: "lifecycle@example.com",
          username: "lifecycle@example.com",
          imap: { host: "imap.example.com", port: 993, tlsMode: "implicit" },
          smtp: { host: "smtp.example.com", port: 587, tlsMode: "starttls" },
          secret: { kind: "password", password: "fixture-secret" },
        },
      });
      if (!connection.ok) throw new Error(connection.error.message);
      connectionId = connection.data.connection.id;
      const secondaryConnection = await createProviderConnection({
        context: adminContext,
        owner: { type: "mailbox", mailboxId },
        input: {
          name: `Lifecycle restricted fixture ${suffix}`,
          email: "lifecycle@example.com",
          username: "lifecycle@example.com",
          imap: { host: "imap.example.com", port: 993, tlsMode: "implicit" },
          smtp: { host: "smtp.example.com", port: 587, tlsMode: "starttls" },
          secret: { kind: "password", password: "fixture-secret" },
        },
      });
      if (!secondaryConnection.ok) throw new Error(secondaryConnection.error.message);
      secondaryConnectionId = secondaryConnection.data.connection.id;
    } finally {
      verify.mockRestore();
    }

    const serverKey = sha256Json({
      host: "imap.example.com",
      port: 993,
      tlsMode: "implicit",
      serverInfo: { name: "fixture" },
    });
    const initialFolders = [remoteFolder("INBOX", "10", "inbox"), remoteFolder("Projects", "20")];
    const evidence = {
      version: 1,
      serverKey,
      rootPath: "",
      namespaces: [{ kind: "personal", prefix: "", delimiter: "/" }],
      folders: initialFolders.map((folder) => ({
        relativePath: folder.path,
        parentRelativePath: null,
        name: folder.name,
        role: folder.role,
        remotePath: folder.path,
        delimiter: folder.delimiter,
        selectable: folder.selectable,
        subscribed: folder.subscribed,
        uidValidity: folder.uidValidity,
        uidNext: folder.uidNext,
        highestModseq: folder.highestModseq,
        rights: folder.rights,
        rightsSource: folder.rightsSource,
        samples: [],
      })),
    };
    const scope = sha256Json(evidence);
    const [resource] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_resources (
        mailbox_id, remote_locator, server_identity, scope_fingerprint, status, discovery_generation
      )
      VALUES (${mailboxId}::uuid, ${{ accountId: "lifecycle@example.com", rootPath: "" }}::jsonb, '{}'::jsonb, ${scope}, 'active', 0)
      RETURNING id
    `;
    const [binding] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_bindings (
        remote_resource_id, connection_id, state, authenticated_principal, remote_locator,
        capabilities, rights, verification_evidence, verified_scope_fingerprint,
        verified_secret_revision, last_verified_at
      )
      VALUES (
        ${resource!.id}::uuid, ${connectionId}::uuid, 'active', 'lifecycle@example.com',
        ${{ accountId: "lifecycle@example.com", rootPath: "" }}::jsonb, '{}'::jsonb, '{}'::jsonb,
        ${evidence}::jsonb, ${scope}, 1, now()
      )
      RETURNING id
    `;
    bindingId = binding!.id;
  });

  afterAll(async () => {
    if (mailboxId) await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
    if (accessIds.length > 0) {
      await sql`DELETE FROM auth.access WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${accessIds}::jsonb))`;
    }
    if (users.length > 0) {
      await sql`DELETE FROM auth.users WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${users}::jsonb))`;
    }
  });

  test("rediscovery projects ACL rights and conservatively reconciles rename and removal", async () => {
    const verify = spyOn(imapSmtpConnector, "verify").mockResolvedValue(fixtureVerification());
    const discover = spyOn(imapSmtpConnector, "discoverFolders").mockResolvedValue([
      remoteFolder("INBOX", "10", "inbox"),
      remoteFolder("Projects", "20"),
    ]);
    try {
      const first = await rediscoverProviderBinding({ bindingId });
      expect(first).toMatchObject({ discovered: 2, missing: 0, ambiguous: 0, rightsSources: { acl: 2 } });
      const [inbox] = await sql<{ id: string }[]>`
        SELECT folder.id
        FROM mail.folders folder
        JOIN mail.binding_folder_refs ref ON ref.folder_id = folder.id
        WHERE ref.binding_id = ${bindingId}::uuid AND ref.remote_path = 'INBOX'
      `;
      inboxFolderId = inbox!.id;
      const [project] = await sql<{ id: string }[]>`
        SELECT folder.id
        FROM mail.folders folder
        JOIN mail.binding_folder_refs ref ON ref.folder_id = folder.id
        WHERE ref.binding_id = ${bindingId}::uuid AND ref.remote_path = 'Projects'
      `;

      discover.mockResolvedValue([remoteFolder("INBOX", "10", "inbox"), remoteFolder("Clients", "20")]);
      const renamed = await rediscoverProviderBinding({ bindingId });
      expect(renamed.renamed).toBe(1);
      const [renamedProject] = await sql<{ id: string; rights_source: string; namespace_kind: string | null }[]>`
        SELECT folder.id, ref.rights_source, ref.namespace_kind
        FROM mail.folders folder
        JOIN mail.binding_folder_refs ref ON ref.folder_id = folder.id
        WHERE ref.binding_id = ${bindingId}::uuid AND ref.remote_path = 'Clients'
      `;
      expect(renamedProject).toEqual({ id: project!.id, rights_source: "acl", namespace_kind: "personal" });

      discover.mockResolvedValue([
        remoteFolder("INBOX", "10", "inbox"),
        remoteFolder("Active", "20"),
        remoteFolder("Clients", "40"),
      ]);
      const renamedAndRecreated = await rediscoverProviderBinding({ bindingId });
      expect(renamedAndRecreated.renamed).toBe(1);
      const recreatedFolders = await sql<{ id: string; remote_path: string; uid_validity: string }[]>`
        SELECT folder.id, ref.remote_path, ref.uid_validity::text
        FROM mail.folders folder
        JOIN mail.binding_folder_refs ref ON ref.folder_id = folder.id
        WHERE ref.binding_id = ${bindingId}::uuid AND ref.remote_path IN ('Active', 'Clients')
        ORDER BY ref.uid_validity
      `;
      expect(recreatedFolders[0]).toEqual({ id: project!.id, remote_path: "Active", uid_validity: "20" });
      expect(recreatedFolders[1]).toMatchObject({ remote_path: "Clients", uid_validity: "40" });
      expect(recreatedFolders[1]?.id).not.toBe(project!.id);
      const replacementFolderId = recreatedFolders[1]!.id;

      const [resource] = await sql<{ remote_resource_id: string; discovery_generation: number }[]>`
        SELECT binding.remote_resource_id, resource.discovery_generation
        FROM mail.provider_bindings binding
        JOIN mail.remote_resources resource ON resource.id = binding.remote_resource_id
        WHERE binding.id = ${bindingId}::uuid
      `;
      const [staleArchive] = await sql<{ id: string }[]>`
        INSERT INTO mail.folders (
          remote_resource_id, stable_key, name, role, selectable, selected_for_sync,
          discovery_generation, discovery_state, missing_since, sync_status
        )
        VALUES (
          ${resource!.remote_resource_id}::uuid,
          ${sha256Json({ version: 1, relativePath: "Archive" })},
          'Archive',
          'other',
          true,
          true,
          ${resource!.discovery_generation},
          'missing',
          now(),
          'excluded'
        )
        RETURNING id
      `;
      await sql`
        INSERT INTO mail.binding_folder_refs (
          binding_id, folder_id, remote_path, delimiter, uid_validity, uid_next,
          subscribed, effective_rights, rights_source, last_seen_generation, missing_since
        )
        VALUES (
          ${bindingId}::uuid,
          ${staleArchive!.id}::uuid,
          'Archive',
          '/',
          30,
          1,
          true,
          ARRAY[]::text[],
          'unknown',
          ${resource!.discovery_generation},
          now()
        )
      `;
      discover.mockResolvedValue([
        remoteFolder("INBOX", "10", "inbox"),
        remoteFolder("Archive", "20"),
        remoteFolder("Clients", "40"),
      ]);
      const conflictedRename = await rediscoverProviderBinding({ bindingId });
      expect(conflictedRename).toMatchObject({ ambiguous: 2, renamed: 0 });
      const [conflictedHealth] = await sql<{ health: string }[]>`
        SELECT health FROM mail.mailboxes WHERE id = ${mailboxId}::uuid
      `;
      expect(conflictedHealth?.health).toBe("degraded");
      const conflictingFolders = await sql<{ id: string; discovery_state: string; remote_path: string; uid_validity: string }[]>`
        SELECT folder.id, folder.discovery_state, ref.remote_path, ref.uid_validity::text
        FROM mail.folders folder
        JOIN mail.binding_folder_refs ref ON ref.folder_id = folder.id AND ref.binding_id = ${bindingId}::uuid
        WHERE folder.id IN (${project!.id}::uuid, ${staleArchive!.id}::uuid)
        ORDER BY ref.uid_validity
      `;
      expect(conflictingFolders).toEqual([
        { id: project!.id, discovery_state: "ambiguous", remote_path: "Active", uid_validity: "20" },
        { id: staleArchive!.id, discovery_state: "ambiguous", remote_path: "Archive", uid_validity: "30" },
      ]);
      await sql`DELETE FROM mail.folders WHERE id = ${staleArchive!.id}::uuid`;

      discover.mockResolvedValue([remoteFolder("INBOX", "10", "inbox"), remoteFolder("Clients", "40")]);
      const removed = await rediscoverProviderBinding({ bindingId });
      expect(removed.missing).toBe(1);
      const [missing] = await sql<{ discovery_state: string; selected_for_sync: boolean; missing_since: Date | null }[]>`
        SELECT discovery_state, selected_for_sync, missing_since
        FROM mail.folders
        WHERE id = ${project!.id}::uuid
      `;
      expect(missing?.discovery_state).toBe("missing");
      expect(missing?.selected_for_sync).toBe(true);
      expect(missing?.missing_since).toBeInstanceOf(Date);
      await sql`DELETE FROM mail.folders WHERE id = ${replacementFolderId}::uuid`;
      discover.mockResolvedValue([remoteFolder("INBOX", "10", "inbox")]);
      await rediscoverProviderBinding({ bindingId });

      await sql`
        UPDATE mail.provider_bindings SET state = 'degraded', last_error_code = 'AUTHENTICATIONFAILED' WHERE id = ${bindingId}::uuid
      `;
      await sql`
        UPDATE mail.provider_connections SET status = 'degraded', last_error_code = 'AUTHENTICATIONFAILED' WHERE id = ${connectionId}::uuid
      `;
      await sql`UPDATE mail.mailboxes SET health = 'auth_required' WHERE id = ${mailboxId}::uuid`;
      await rediscoverProviderBinding({ bindingId });
      const [recovered] = await sql<{ binding_state: string; connection_state: string; mailbox_health: string }[]>`
        SELECT binding.state AS binding_state, connection.status AS connection_state, mailbox.health AS mailbox_health
        FROM mail.provider_bindings binding
        JOIN mail.provider_connections connection ON connection.id = binding.connection_id
        JOIN mail.remote_resources resource ON resource.id = binding.remote_resource_id
        JOIN mail.mailboxes mailbox ON mailbox.id = resource.mailbox_id
        WHERE binding.id = ${bindingId}::uuid
      `;
      expect(recovered).toEqual({ binding_state: "active", connection_state: "active", mailbox_health: "bootstrapping" });

      discover.mockImplementation(async () => {
        await Bun.sleep(75);
        return [remoteFolder("INBOX", "10", "inbox")];
      });
      const concurrent = await Promise.allSettled([
        executeBindingRediscovery(bindingId, false, async () => undefined),
        executeBindingRediscovery(bindingId, false, async () => undefined),
      ]);
      expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = concurrent.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "SYNC_BUSY" });
    } finally {
      discover.mockRestore();
      verify.mockRestore();
    }
  });

  test("confirming a pending binding activates its discovered folders", async () => {
    await sql`
      UPDATE mail.provider_bindings
      SET state = 'pending', verified_scope_fingerprint = NULL
      WHERE id = ${bindingId}::uuid
    `;
    const confirmed = await confirmProviderBinding({ context: adminContext, mailboxId, bindingId });
    expect(confirmed.ok && confirmed.data.state).toBe("active");
    const [inbox] = await sql<{ discovery_state: string; selected_for_sync: boolean; sync_status: string }[]>`
      SELECT folder.discovery_state, folder.selected_for_sync, folder.sync_status
      FROM mail.folders folder
      JOIN mail.binding_folder_refs ref ON ref.folder_id = folder.id
      WHERE ref.binding_id = ${bindingId}::uuid AND ref.remote_path = 'INBOX'
    `;
    expect(inbox).toEqual({ discovery_state: "active", selected_for_sync: true, sync_status: "pending" });
  });

  test("a restricted binding cannot disable a folder readable through another binding", async () => {
    const [trusted] = await sql<
      { remote_resource_id: string; scope_fingerprint: string; verification_evidence: Record<string, unknown> | string }[]
    >`
      SELECT binding.remote_resource_id, resource.scope_fingerprint, binding.verification_evidence
      FROM mail.provider_bindings binding
      JOIN mail.remote_resources resource ON resource.id = binding.remote_resource_id
      WHERE binding.id = ${bindingId}::uuid
    `;
    const [restricted] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_bindings (
        remote_resource_id, connection_id, state, authenticated_principal, remote_locator,
        capabilities, rights, verification_evidence, verified_scope_fingerprint,
        verified_secret_revision, last_verified_at
      )
      VALUES (
        ${trusted!.remote_resource_id}::uuid,
        ${secondaryConnectionId}::uuid,
        'active',
        'lifecycle@example.com',
        ${{ accountId: "lifecycle@example.com", rootPath: "" }}::jsonb,
        ${fixtureVerification().capabilities}::jsonb,
        '{}'::jsonb,
        ${
          typeof trusted!.verification_evidence === "string"
            ? JSON.parse(trusted!.verification_evidence)
            : trusted!.verification_evidence
        }::jsonb,
        ${trusted!.scope_fingerprint},
        1,
        now()
      )
      RETURNING id
    `;
    const verify = spyOn(imapSmtpConnector, "verify").mockResolvedValue(fixtureVerification());
    const discover = spyOn(imapSmtpConnector, "discoverFolders").mockResolvedValue([remoteFolder("INBOX", "10", "inbox", [])]);
    try {
      await rediscoverProviderBinding({ bindingId: restricted!.id });
      const [inbox] = await sql<{ selected_for_sync: boolean; sync_status: string; discovery_state: string }[]>`
        SELECT selected_for_sync, sync_status, discovery_state
        FROM mail.folders
        WHERE id = ${inboxFolderId}::uuid
      `;
      expect(inbox).toEqual({ selected_for_sync: true, sync_status: "pending", discovery_state: "active" });
    } finally {
      discover.mockRestore();
      verify.mockRestore();
      await sql`DELETE FROM mail.provider_bindings WHERE id = ${restricted!.id}::uuid`;
    }
  });

  test("an in-flight rediscovery cannot overwrite a newer credential revision", async () => {
    const verify = spyOn(imapSmtpConnector, "verify").mockResolvedValue(fixtureVerification());
    const discover = spyOn(imapSmtpConnector, "discoverFolders").mockImplementation(async () => {
      await Bun.sleep(75);
      return [remoteFolder("INBOX", "10", "inbox")];
    });
    try {
      const rediscovery = rediscoverProviderBinding({ bindingId });
      await Bun.sleep(15);
      await sql.begin(async (tx) => {
        await tx`UPDATE mail.provider_connections SET secret_revision = 2 WHERE id = ${connectionId}::uuid`;
        await tx`
          UPDATE mail.provider_bindings
          SET
            state = 'pending',
            last_error_code = 'CREDENTIAL_REVERIFICATION_REQUIRED',
            last_error_message = 'newer credential revision'
          WHERE id = ${bindingId}::uuid
        `;
      });
      await expect(rediscovery).rejects.toMatchObject({ code: "CREDENTIAL_REVISION_CHANGED" });
      const [binding] = await sql<{ state: string; last_error_code: string; last_error_message: string }[]>`
        SELECT state, last_error_code, last_error_message
        FROM mail.provider_bindings
        WHERE id = ${bindingId}::uuid
      `;
      expect(binding).toEqual({
        state: "pending",
        last_error_code: "CREDENTIAL_REVERIFICATION_REQUIRED",
        last_error_message: "newer credential revision",
      });
    } finally {
      discover.mockRestore();
      verify.mockRestore();
      await sql.begin(async (tx) => {
        await tx`UPDATE mail.provider_connections SET secret_revision = 1 WHERE id = ${connectionId}::uuid`;
        await tx`
          UPDATE mail.provider_bindings
          SET state = 'active', last_error_code = NULL, last_error_message = NULL
          WHERE id = ${bindingId}::uuid
        `;
      });
    }
  });

  test("health remains readable when a personal mailbox has no active provider", async () => {
    const personal = await createMailbox(adminContext, {
      name: `Personal health ${suffix}`,
      connectionPolicy: "personal_provider_account",
    });
    expect(personal.ok).toBe(true);
    if (!personal.ok) return;
    const [access] = await sql<{ access_id: string }[]>`
      SELECT access_id FROM mail.mailbox_access WHERE mailbox_id = ${personal.data.id}::uuid
    `;
    try {
      const health = await getMailboxOperationalHealth(adminContext, personal.data.id);
      expect(health.ok).toBe(true);
      if (health.ok) expect(health.data.bindings.total).toBe(0);
    } finally {
      await sql`DELETE FROM mail.mailboxes WHERE id = ${personal.data.id}::uuid`;
      if (access) await sql`DELETE FROM auth.access WHERE id = ${access.access_id}::uuid`;
    }
  });

  test("a newer sync fence rejects an older worker before commit", async () => {
    const [resource] = await sql<{ id: string }[]>`
      SELECT remote_resource_id AS id FROM mail.provider_bindings WHERE id = ${bindingId}::uuid
    `;
    const selectedFolders = await sql<{ id: string }[]>`
      UPDATE mail.folders
      SET selected_for_sync = false
      WHERE remote_resource_id = ${resource!.id}::uuid AND selected_for_sync = true
      RETURNING id
    `;
    const first = await claimFence(resource!.id, bindingId, "incremental");
    const second = await claimFence(resource!.id, bindingId, "incremental");
    try {
      await expect(
        commitSyncBatch({
          folder: {
            folder_id: inboxFolderId,
            mailbox_id: mailboxId,
            remote_resource_id: resource!.id,
            sync_generation: first.generation,
            envelope_cursor: {},
            role: "inbox",
          },
          folderId: inboxFolderId,
          bindingId,
          secretRevision: 1,
          fence: first,
          status: { uidValidity: "10", uidNext: 1, highestModseq: "1", messages: 0 },
          beforeCursor: null,
          cursor: {},
          uidValidityChanged: false,
          envelopeBatch: null,
          envelopeKind: null,
          flagChanges: [],
          reconcileWindow: null,
        } as never),
      ).rejects.toMatchObject({ code: "STALE_SYNC_FENCE" });
      const runs = await sql<{ id: string; state: string }[]>`
        SELECT id, state FROM mail.sync_runs WHERE id IN (${first.runId}::uuid, ${second.runId}::uuid) ORDER BY id
      `;
      expect(runs.find((run) => run.id === first.runId)?.state).toBe("stale_fence");
      expect(runs.find((run) => run.id === second.runId)?.state).toBe("running");
    } finally {
      await sql`
        UPDATE mail.sync_runs SET state = 'completed', finished_at = now() WHERE id = ${second.runId}::uuid AND state = 'running'
      `;
      if (selectedFolders.length > 0) {
        await sql`
          UPDATE mail.folders
          SET selected_for_sync = true
          WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${selectedFolders.map((folder) => folder.id)}::jsonb))
        `;
      }
    }
  });

  test("stale maintenance execution is recovered and completed by the durable worker", async () => {
    const command = await createMailCommand({
      context: adminContext,
      mailboxId,
      input: { kind: "hydrate_missing", idempotencyKey: `stale-worker-${suffix}` },
      enqueue: false,
    });
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    await sql`
      UPDATE mail.commands
      SET
        state = 'executing',
        attempt = 1,
        started_at = now() - interval '20 minutes',
        worker_heartbeat_at = now() - interval '20 minutes'
      WHERE id = ${command.data.id}::uuid
    `;
    try {
      const submitted = await submitDueMaintenanceCommands();
      expect(submitted.recovered).toBeGreaterThanOrEqual(1);
      let state = "executing";
      for (let attempt = 0; attempt < 100 && state !== "confirmed"; attempt += 1) {
        await Bun.sleep(20);
        const [row] = await sql<{ state: string }[]>`SELECT state FROM mail.commands WHERE id = ${command.data.id}::uuid`;
        state = row?.state ?? "missing";
      }
      expect(state).toBe("confirmed");
    } finally {
      stopMaintenanceRuntime();
    }
  });

  test("maintenance commands are admin-only, idempotent, durable, and expose health", async () => {
    const denied = await createMailCommand({
      context: collaboratorContext,
      mailboxId,
      input: { kind: "sync_mailbox", idempotencyKey: `denied-${suffix}` },
      enqueue: false,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("FORBIDDEN");

    const created = await createMailCommand({
      context: adminContext,
      mailboxId,
      input: { kind: "sync_mailbox", idempotencyKey: `sync-${suffix}` },
      enqueue: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const replay = await createMailCommand({
      context: adminContext,
      mailboxId,
      input: { kind: "sync_mailbox", idempotencyKey: `sync-${suffix}` },
      enqueue: false,
    });
    expect(replay.ok && replay.data.id).toBe(created.data.id);
    expect(await executeMaintenanceCommand(created.data.id, undefined, { enqueueWork: false })).toBe("confirmed");
    const [stored] = await sql<{ state: string; result: Record<string, unknown> | string }[]>`
      SELECT state, result FROM mail.commands WHERE id = ${created.data.id}::uuid
    `;
    const result = typeof stored?.result === "string" ? JSON.parse(stored.result) : stored?.result;
    expect(stored?.state).toBe("confirmed");
    expect(result).toEqual({ queuedFolders: 1 });

    const health = await getMailboxOperationalHealth(adminContext, mailboxId);
    expect(health.ok).toBe(true);
    if (health.ok) {
      expect(health.data.bindings.active).toBe(1);
      expect(health.data.discovery.activeFolders).toBe(1);
      expect(health.data.discovery.missingFolders).toBe(1);
      expect(health.data.bindings.rightsSources["acl"]).toBe(1);
      expect(health.data.commands.states["confirmed"]).toBeGreaterThanOrEqual(1);
    }

    const [pausedMessage] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id, message_id, subject, internal_date, size_bytes, content_hash, hydration_status, hydration_attempt
      )
      VALUES (
        ${mailboxId}::uuid,
        ${`<paused-${suffix}@example.com>`},
        'Paused hydration',
        now(),
        1,
        ${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")},
        'envelope',
        0
      )
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid)
      VALUES (${inboxFolderId}::uuid, ${pausedMessage!.id}::uuid, 10, 999999)
    `;
    const paused = await updateMailbox({ context: adminContext, mailboxId, syncEnabled: false });
    expect(paused.ok && paused.data.health).toBe("paused");
    const download = spyOn(imapSmtpConnector, "downloadSourceBatch").mockRejectedValue(new Error("paused hydration reached IMAP"));
    try {
      await expect(
        hydrateMessageBatch({
          input: { messageId: pausedMessage!.id },
          signal: new AbortController().signal,
          heartbeat: async () => undefined,
        } as never),
      ).resolves.toEqual({ hydrated: false });
      expect(download).not.toHaveBeenCalled();
    } finally {
      download.mockRestore();
    }
    const failedVerify = spyOn(imapSmtpConnector, "verify").mockRejectedValue(
      Object.assign(new Error("fixture authentication failure"), { code: "AUTHENTICATIONFAILED" }),
    );
    const failedDiscovery = spyOn(imapSmtpConnector, "discoverFolders").mockRejectedValue(
      Object.assign(new Error("fixture authentication failure"), { code: "AUTHENTICATIONFAILED" }),
    );
    try {
      await expect(rediscoverProviderBinding({ bindingId })).rejects.toMatchObject({ code: "AUTHENTICATIONFAILED" });
      const [pausedHealth] = await sql<{ health: string }[]>`
        SELECT health FROM mail.mailboxes WHERE id = ${mailboxId}::uuid
      `;
      expect(pausedHealth?.health).toBe("paused");
    } finally {
      failedDiscovery.mockRestore();
      failedVerify.mockRestore();
      await sql`
        UPDATE mail.provider_bindings
        SET state = 'active', last_error_code = NULL, last_error_message = NULL
        WHERE id = ${bindingId}::uuid
      `;
      await sql`
        UPDATE mail.provider_connections
        SET status = 'active', last_error_code = NULL, last_error_message = NULL
        WHERE id = ${connectionId}::uuid
      `;
    }
    const pausedCommand = await createMailCommand({
      context: adminContext,
      mailboxId,
      input: { kind: "sync_mailbox", idempotencyKey: `paused-sync-${suffix}` },
      enqueue: false,
    });
    expect(pausedCommand.ok).toBe(true);
    if (pausedCommand.ok) {
      expect(await executeMaintenanceCommand(pausedCommand.data.id, undefined, { enqueueWork: false })).toBe("confirmed");
      const [storedPaused] = await sql<{ result: Record<string, unknown> | string }[]>`
        SELECT result FROM mail.commands WHERE id = ${pausedCommand.data.id}::uuid
      `;
      expect(typeof storedPaused?.result === "string" ? JSON.parse(storedPaused.result) : storedPaused?.result).toEqual({ queuedFolders: 0 });
    }
    const resumed = await updateMailbox({ context: adminContext, mailboxId, syncEnabled: true });
    expect(resumed.ok && resumed.data.health).toBe("bootstrapping");
  });

  test("folder rebuild retains content while invalidating remote placement and hydration retry resets failures", async () => {
    const [message] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id, message_id, subject, internal_date, size_bytes, content_hash, hydration_status, hydration_attempt
      )
      VALUES (${mailboxId}::uuid, '<rebuild@example.com>', 'Rebuild', now(), 1, ${"a".repeat(64)}, 'complete', 0)
      RETURNING id
    `;
    const [remoteRef] = await sql<{ id: string }[]>`
      INSERT INTO mail.remote_message_refs (folder_id, message_id, uid_validity, uid)
      VALUES (${inboxFolderId}::uuid, ${message!.id}::uuid, 10, 1)
      RETURNING id
    `;
    await sql`
      INSERT INTO mail.message_placements (remote_message_ref_id, folder_id, message_id)
      VALUES (${remoteRef!.id}::uuid, ${inboxFolderId}::uuid, ${message!.id}::uuid)
    `;
    const rebuild = await createMailCommand({
      context: adminContext,
      mailboxId,
      input: { kind: "rebuild_folder", folderId: inboxFolderId, idempotencyKey: `rebuild-${suffix}` },
      enqueue: false,
    });
    expect(rebuild.ok).toBe(true);
    if (!rebuild.ok) return;
    expect(await executeMaintenanceCommand(rebuild.data.id, undefined, { enqueueWork: false })).toBe("confirmed");
    const [rebuilt] = await sql<
      { sync_status: string; stale: boolean; placement_deleted: boolean; content_exists: boolean }[]
    >`
      SELECT
        folder.sync_status,
        ref.stale_at IS NOT NULL AS stale,
        placement.deleted_at IS NOT NULL AS placement_deleted,
        EXISTS (SELECT 1 FROM mail.message_contents WHERE id = ${message!.id}::uuid) AS content_exists
      FROM mail.folders folder
      JOIN mail.remote_message_refs ref ON ref.folder_id = folder.id
      JOIN mail.message_placements placement ON placement.remote_message_ref_id = ref.id
      WHERE folder.id = ${inboxFolderId}::uuid AND ref.id = ${remoteRef!.id}::uuid
    `;
    expect(rebuilt).toEqual({ sync_status: "rebuilding", stale: true, placement_deleted: true, content_exists: true });

    const [failed] = await sql<{ id: string }[]>`
      INSERT INTO mail.message_contents (
        mailbox_id, message_id, subject, internal_date, size_bytes, content_hash, hydration_status, hydration_attempt
      )
      VALUES (${mailboxId}::uuid, '<hydrate@example.com>', 'Hydrate', now(), 1, ${"b".repeat(64)}, 'failed', 5)
      RETURNING id
    `;
    const hydrate = await createMailCommand({
      context: adminContext,
      mailboxId,
      input: { kind: "hydrate_missing", idempotencyKey: `hydrate-${suffix}` },
      enqueue: false,
    });
    expect(hydrate.ok).toBe(true);
    if (!hydrate.ok) return;
    expect(await executeMaintenanceCommand(hydrate.data.id, undefined, { enqueueWork: false })).toBe("confirmed");
    const [hydrated] = await sql<{ hydration_status: string; hydration_attempt: number }[]>`
      SELECT hydration_status, hydration_attempt FROM mail.message_contents WHERE id = ${failed!.id}::uuid
    `;
    expect(hydrated).toEqual({ hydration_status: "envelope", hydration_attempt: 0 });
  });

  test("execution rechecks administration access after command creation", async () => {
    const access = accessIds[0]!;
    const promoted = await updateMailboxAccess({ context: adminContext, mailboxId, accessId: access, permission: "admin" });
    expect(promoted.ok).toBe(true);
    const command = await createMailCommand({
      context: collaboratorContext,
      mailboxId,
      input: { kind: "hydrate_missing", idempotencyKey: `revoked-${suffix}` },
      enqueue: false,
    });
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    const revoked = await revokeMailboxAccess({ context: adminContext, mailboxId, accessId: access });
    expect(revoked.ok).toBe(true);
    expect(await executeMaintenanceCommand(command.data.id, undefined, { enqueueWork: false })).toBe("failed");
    const [stored] = await sql<{ state: string; last_error_code: string | null }[]>`
      SELECT state, last_error_code FROM mail.commands WHERE id = ${command.data.id}::uuid
    `;
    expect(stored).toEqual({ state: "failed", last_error_code: "ACCESS_REVOKED" });
  });
});
