import { listUsersWithAccess } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import { buildMailWorkflowCatalog, type MailWorkflowCatalog } from "../workflows";
import type { MailRequestContext } from "./auth";
import type { SqlClient } from "./workflow-data";

export const loadMailWorkflowCatalog = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  db?: SqlClient;
}): Promise<MailWorkflowCatalog> => {
  const db = params.db ?? sql;
  const [folders, accessRows, senderIdentities] = await Promise.all([
    db<{ id: string; name: string }[]>`
      SELECT DISTINCT folder.id, folder.name
      FROM mail.folders folder
      JOIN mail.remote_resources resource ON resource.id = folder.remote_resource_id
      JOIN mail.mailboxes mailbox ON mailbox.id = resource.mailbox_id
      WHERE mailbox.id = ${params.mailboxId}::uuid
        AND mailbox.deleted_at IS NULL
        AND folder.discovery_state = 'active'
        AND folder.selectable
        AND EXISTS (
          SELECT 1
          FROM mail.binding_folder_refs folder_ref
          JOIN mail.provider_bindings binding ON binding.id = folder_ref.binding_id
          JOIN mail.provider_connections connection ON connection.id = binding.connection_id
          WHERE folder_ref.folder_id = folder.id
            AND 'insert' = ANY(folder_ref.effective_rights)
            AND binding.state = 'active'
            AND binding.verified_scope_fingerprint = resource.scope_fingerprint
            AND binding.verified_secret_revision = connection.secret_revision
            AND connection.status = 'active'
            AND connection.encrypted_secret IS NOT NULL
            AND connection.owner_mailbox_id = mailbox.id
        )
      ORDER BY folder.id
    `,
    db<{ access_id: string }[]>`
      SELECT access_id
      FROM mail.mailbox_access
      WHERE mailbox_id = ${params.mailboxId}::uuid
    `,
    db<{ id: string; name: string }[]>`
      SELECT id, display_name || ' <' || from_address || '>' AS name
      FROM mail.sender_identities
      WHERE mailbox_id = ${params.mailboxId}::uuid
        AND status = 'verified'
        AND automation_policy = 'mailbox'
      ORDER BY id
    `,
  ]);
  const assignableUsers = await listUsersWithAccess({
    accessIds: accessRows.map((row) => row.access_id),
    minimumPermission: "write",
    limit: 10_000,
    db,
  });
  return buildMailWorkflowCatalog({
    folders,
    assignableUsers: assignableUsers.map((user) => ({ id: user.id, name: user.displayName || user.uid })),
    senderIdentities,
  });
};
