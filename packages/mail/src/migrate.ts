import { sql } from "bun";
import { SEARCH_CHUNK_CHARACTERS, SEARCH_CHUNK_OVERLAP_CHARACTERS } from "./service/search-chunks";

type SqlClient = typeof sql;

const enforceMailboxOwnedProviderBindings = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE OR REPLACE FUNCTION mail.enforce_provider_binding_mailbox()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      connection_mailbox UUID;
      resource_mailbox UUID;
    BEGIN
      SELECT owner_mailbox_id INTO connection_mailbox
      FROM mail.provider_connections
      WHERE id = NEW.connection_id;

      SELECT mailbox_id INTO resource_mailbox
      FROM mail.remote_resources
      WHERE id = NEW.remote_resource_id;

      IF connection_mailbox IS NULL OR resource_mailbox IS NULL OR connection_mailbox <> resource_mailbox THEN
        RAISE EXCEPTION 'Provider connection and remote resource must belong to the same mailbox'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $$
  `;
  await db`DROP TRIGGER IF EXISTS provider_bindings_mailbox_guard ON mail.provider_bindings`;
  await db`
    CREATE TRIGGER provider_bindings_mailbox_guard
    BEFORE INSERT OR UPDATE OF remote_resource_id, connection_id ON mail.provider_bindings
    FOR EACH ROW EXECUTE FUNCTION mail.enforce_provider_binding_mailbox()
  `;
};

const createInitialSchema = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE mail.mailboxes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
      health TEXT NOT NULL DEFAULT 'disconnected'
        CHECK (health IN (
          'disconnected', 'verifying', 'bootstrapping', 'active', 'auth_required',
          'degraded', 'reconnecting', 'connection_required', 'paused'
        )),
      health_reason TEXT CHECK (health_reason IS NULL OR char_length(health_reason) <= 1000),
      sync_enabled BOOLEAN NOT NULL DEFAULT true,
      search_backend TEXT NOT NULL DEFAULT 'native' CHECK (search_backend IN ('native', 'pg_textsearch')),
      created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_by_service_account_id UUID REFERENCES auth.service_accounts(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`
    CREATE INDEX mailboxes_active_created_idx
    ON mail.mailboxes (created_at DESC, id DESC)
    WHERE deleted_at IS NULL
  `;

  await db`
    CREATE TABLE mail.mailbox_access (
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
      PRIMARY KEY (mailbox_id, access_id)
    )
  `;
  await db`CREATE INDEX mailbox_access_access_idx ON mail.mailbox_access (access_id, mailbox_id)`;

  await db`
    CREATE TABLE mail.provider_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
      username TEXT NOT NULL CHECK (char_length(username) BETWEEN 1 AND 320),
      connector_kind TEXT NOT NULL DEFAULT 'imap_smtp' CHECK (connector_kind = 'imap_smtp'),
      imap_host TEXT NOT NULL CHECK (char_length(imap_host) BETWEEN 1 AND 253),
      imap_port INTEGER NOT NULL CHECK (imap_port BETWEEN 1 AND 65535),
      imap_tls_mode TEXT NOT NULL CHECK (imap_tls_mode IN ('implicit', 'starttls')),
      smtp_host TEXT NOT NULL CHECK (char_length(smtp_host) BETWEEN 1 AND 253),
      smtp_port INTEGER NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
      smtp_tls_mode TEXT NOT NULL CHECK (smtp_tls_mode IN ('implicit', 'starttls')),
      secret_kind TEXT NOT NULL CHECK (secret_kind IN ('password', 'oauth2')),
      encrypted_secret TEXT CHECK (encrypted_secret IS NULL OR char_length(encrypted_secret) > 0),
      secret_revision INTEGER NOT NULL DEFAULT 1 CHECK (secret_revision > 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'degraded', 'revoked')),
      authenticated_principal TEXT,
      capabilities JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(capabilities) = 'object'),
      server_identity JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(server_identity) = 'object'),
      last_verified_at TIMESTAMPTZ,
      last_error_code TEXT,
      last_error_message TEXT CHECK (last_error_message IS NULL OR char_length(last_error_message) <= 1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT provider_connections_secret_lifecycle CHECK (
        (status = 'revoked' AND encrypted_secret IS NULL) OR
        (status <> 'revoked' AND encrypted_secret IS NOT NULL)
      )
    )
  `;
  await db`
    CREATE UNIQUE INDEX provider_connections_mailbox_active_idx
    ON mail.provider_connections (owner_mailbox_id)
    WHERE status <> 'revoked'
  `;

  await db`
    CREATE TABLE mail.remote_resources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL UNIQUE REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      connector_kind TEXT NOT NULL DEFAULT 'imap_smtp' CHECK (connector_kind = 'imap_smtp'),
      remote_locator JSONB NOT NULL CHECK (jsonb_typeof(remote_locator) = 'object'),
      server_identity JSONB NOT NULL CHECK (jsonb_typeof(server_identity) = 'object'),
      scope_fingerprint TEXT NOT NULL CHECK (char_length(scope_fingerprint) = 64),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'degraded', 'connection_required', 'paused')),
      sync_generation BIGINT NOT NULL DEFAULT 1 CHECK (sync_generation > 0),
      current_fence_token BIGINT NOT NULL DEFAULT 0 CHECK (current_fence_token >= 0),
      discovery_generation BIGINT NOT NULL DEFAULT 0 CHECK (discovery_generation >= 0),
      last_sync_at TIMESTAMPTZ,
      last_discovery_at TIMESTAMPTZ,
      last_error_code TEXT,
      last_error_message TEXT CHECK (last_error_message IS NULL OR char_length(last_error_message) <= 1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX remote_resources_status_idx ON mail.remote_resources (status, last_sync_at)`;

  await db`
    CREATE TABLE mail.provider_bindings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      remote_resource_id UUID NOT NULL REFERENCES mail.remote_resources(id) ON DELETE CASCADE,
      connection_id UUID NOT NULL REFERENCES mail.provider_connections(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'verifying', 'active', 'degraded', 'revoked')),
      authenticated_principal TEXT,
      remote_locator JSONB NOT NULL CHECK (jsonb_typeof(remote_locator) = 'object'),
      capabilities JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(capabilities) = 'object'),
      rights JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rights) = 'object'),
      verification_evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(verification_evidence) = 'object'),
      verified_scope_fingerprint TEXT CHECK (verified_scope_fingerprint IS NULL OR char_length(verified_scope_fingerprint) = 64),
      last_verified_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      last_error_code TEXT,
      last_error_message TEXT CHECK (last_error_message IS NULL OR char_length(last_error_message) <= 1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`
    CREATE UNIQUE INDEX provider_bindings_resource_current_idx
    ON mail.provider_bindings (remote_resource_id)
    WHERE state <> 'revoked'
  `;
  await db`
    CREATE UNIQUE INDEX provider_bindings_connection_current_idx
    ON mail.provider_bindings (connection_id)
    WHERE state <> 'revoked'
  `;
  await db`CREATE INDEX provider_bindings_resource_state_idx ON mail.provider_bindings (remote_resource_id, state, last_verified_at DESC)`;
  await db`CREATE INDEX provider_bindings_connection_idx ON mail.provider_bindings (connection_id, state)`;
  await enforceMailboxOwnedProviderBindings(db);

  await db`
    CREATE TABLE mail.remote_namespaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      binding_id UUID NOT NULL REFERENCES mail.provider_bindings(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('personal', 'other_users', 'shared')),
      prefix TEXT NOT NULL,
      delimiter TEXT,
      discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (binding_id, kind, prefix)
    )
  `;

  await db`
    CREATE TABLE mail.folders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      remote_resource_id UUID NOT NULL REFERENCES mail.remote_resources(id) ON DELETE CASCADE,
      parent_id UUID REFERENCES mail.folders(id) ON DELETE SET NULL,
      stable_key TEXT NOT NULL CHECK (char_length(stable_key) BETWEEN 1 AND 1000),
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 1000),
      role TEXT NOT NULL DEFAULT 'other'
        CHECK (role IN ('inbox', 'sent', 'drafts', 'trash', 'archive', 'junk', 'all', 'other')),
      selectable BOOLEAN NOT NULL DEFAULT true,
      selected_for_sync BOOLEAN NOT NULL DEFAULT true,
      discovery_generation BIGINT NOT NULL DEFAULT 0 CHECK (discovery_generation >= 0),
      sync_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (sync_status IN ('pending', 'syncing', 'current', 'degraded', 'rebuilding', 'excluded')),
      envelope_cursor JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(envelope_cursor) = 'object'),
      body_cursor JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(body_cursor) = 'object'),
      attachment_cursor JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attachment_cursor) = 'object'),
      last_reconciled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (remote_resource_id, stable_key)
    )
  `;
  await db`CREATE INDEX folders_resource_parent_idx ON mail.folders (remote_resource_id, parent_id, name)`;
  await db`CREATE INDEX folders_sync_idx ON mail.folders (remote_resource_id, sync_status, role) WHERE selected_for_sync`;

  await db`
    CREATE TABLE mail.binding_folder_refs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      binding_id UUID NOT NULL REFERENCES mail.provider_bindings(id) ON DELETE CASCADE,
      folder_id UUID NOT NULL REFERENCES mail.folders(id) ON DELETE CASCADE,
      remote_path TEXT NOT NULL CHECK (char_length(remote_path) BETWEEN 1 AND 4000),
      delimiter TEXT,
      namespace_kind TEXT CHECK (namespace_kind IS NULL OR namespace_kind IN ('personal', 'other_users', 'shared')),
      uid_validity NUMERIC(20, 0) CHECK (uid_validity IS NULL OR uid_validity >= 0),
      highest_modseq NUMERIC(20, 0) CHECK (highest_modseq IS NULL OR highest_modseq >= 0),
      uid_next NUMERIC(20, 0) CHECK (uid_next IS NULL OR uid_next >= 0),
      subscribed BOOLEAN NOT NULL DEFAULT false,
      effective_rights TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      rights_source TEXT NOT NULL DEFAULT 'probe' CHECK (rights_source IN ('acl', 'select', 'probe', 'unknown')),
      last_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (binding_id, folder_id),
      UNIQUE (binding_id, remote_path)
    )
  `;
  await db`CREATE INDEX binding_folder_refs_folder_idx ON mail.binding_folder_refs (folder_id, binding_id)`;

  await db`
    CREATE TABLE mail.message_contents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      message_id TEXT,
      in_reply_to TEXT,
      reference_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      subject TEXT NOT NULL DEFAULT '',
      internal_date TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ,
      size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
      selected_headers JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(selected_headers) = 'object'),
      mime_structure JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(mime_structure) = 'object'),
      plain_text TEXT,
      sanitized_html TEXT,
      source_hash TEXT CHECK (source_hash IS NULL OR char_length(source_hash) = 64),
      content_hash TEXT NOT NULL CHECK (char_length(content_hash) = 64),
      hydration_status TEXT NOT NULL DEFAULT 'envelope'
        CHECK (hydration_status IN ('envelope', 'headers', 'body', 'complete', 'failed')),
      hydration_error_code TEXT,
      search_document TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('simple'::regconfig, coalesce(subject, '')), 'A') ||
        setweight(to_tsvector('simple'::regconfig, coalesce(plain_text, '')), 'B')
      ) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      hydrated_at TIMESTAMPTZ,
      UNIQUE (mailbox_id, content_hash)
    )
  `;
  await db`CREATE INDEX message_contents_mailbox_date_idx ON mail.message_contents (mailbox_id, internal_date DESC, id DESC)`;
  await db`CREATE INDEX message_contents_message_id_idx ON mail.message_contents (mailbox_id, lower(message_id)) WHERE message_id IS NOT NULL`;
  await db`CREATE INDEX message_contents_search_idx ON mail.message_contents USING GIN (search_document)`;
  await db`CREATE INDEX message_contents_subject_trgm_idx ON mail.message_contents USING GIN (subject gin_trgm_ops)`;

  await db`
    CREATE TABLE mail.message_addresses (
      message_id UUID NOT NULL REFERENCES mail.message_contents(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('from', 'reply_to', 'to', 'cc', 'bcc')),
      position INTEGER NOT NULL CHECK (position >= 0),
      display_name TEXT,
      email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
      normalized_email TEXT NOT NULL CHECK (normalized_email = lower(normalized_email)),
      PRIMARY KEY (message_id, role, position)
    )
  `;
  await db`CREATE INDEX message_addresses_lookup_idx ON mail.message_addresses (normalized_email, role, message_id)`;
  await db`CREATE INDEX message_addresses_trgm_idx ON mail.message_addresses USING GIN (normalized_email gin_trgm_ops)`;

  await db`
    CREATE TABLE mail.message_part_blobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content_hash TEXT NOT NULL UNIQUE CHECK (char_length(content_hash) = 64),
      byte_length BIGINT NOT NULL CHECK (byte_length >= 0),
      chunk_size INTEGER NOT NULL DEFAULT 1048576 CHECK (chunk_size BETWEEN 65536 AND 4194304),
      chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0),
      complete BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    )
  `;

  await db`
    CREATE TABLE mail.message_part_chunks (
      blob_id UUID NOT NULL REFERENCES mail.message_part_blobs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      bytes BYTEA NOT NULL CHECK (octet_length(bytes) <= 4194304),
      PRIMARY KEY (blob_id, position)
    )
  `;

  await db`
    CREATE TABLE mail.message_parts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID NOT NULL REFERENCES mail.message_contents(id) ON DELETE CASCADE,
      part_path TEXT NOT NULL CHECK (char_length(part_path) BETWEEN 1 AND 200),
      content_type TEXT NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 255),
      charset TEXT,
      transfer_encoding TEXT,
      disposition TEXT,
      content_id TEXT,
      filename TEXT,
      size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
      blob_id UUID REFERENCES mail.message_part_blobs(id) ON DELETE RESTRICT,
      hydration_status TEXT NOT NULL DEFAULT 'pending' CHECK (hydration_status IN ('pending', 'hydrating', 'complete', 'failed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (message_id, part_path)
    )
  `;
  await db`CREATE INDEX message_parts_message_idx ON mail.message_parts (message_id, part_path)`;
  await db`CREATE INDEX message_parts_blob_idx ON mail.message_parts (blob_id) WHERE blob_id IS NOT NULL`;

  await db`
    CREATE TABLE mail.attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID NOT NULL REFERENCES mail.message_contents(id) ON DELETE CASCADE,
      part_id UUID NOT NULL UNIQUE REFERENCES mail.message_parts(id) ON DELETE CASCADE,
      filename TEXT,
      content_type TEXT NOT NULL,
      disposition TEXT,
      content_id TEXT,
      checksum TEXT CHECK (checksum IS NULL OR char_length(checksum) = 64),
      size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
      blob_id UUID NOT NULL REFERENCES mail.message_part_blobs(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX attachments_message_idx ON mail.attachments (message_id, id)`;

  await db`
    CREATE TABLE mail.remote_message_refs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      folder_id UUID NOT NULL REFERENCES mail.folders(id) ON DELETE CASCADE,
      message_id UUID NOT NULL REFERENCES mail.message_contents(id) ON DELETE CASCADE,
      uid_validity NUMERIC(20, 0) NOT NULL CHECK (uid_validity >= 0),
      uid NUMERIC(20, 0) NOT NULL CHECK (uid > 0),
      modseq NUMERIC(20, 0) CHECK (modseq IS NULL OR modseq >= 0),
      connector_ref JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(connector_ref) = 'object'),
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      stale_at TIMESTAMPTZ,
      UNIQUE (folder_id, uid_validity, uid)
    )
  `;
  await db`CREATE INDEX remote_message_refs_message_idx ON mail.remote_message_refs (message_id, folder_id)`;
  await db`CREATE INDEX remote_message_refs_folder_scan_idx ON mail.remote_message_refs (folder_id, uid_validity, uid DESC) WHERE stale_at IS NULL`;

  await db`
    CREATE TABLE mail.message_placements (
      remote_message_ref_id UUID PRIMARY KEY REFERENCES mail.remote_message_refs(id) ON DELETE CASCADE,
      folder_id UUID NOT NULL REFERENCES mail.folders(id) ON DELETE CASCADE,
      message_id UUID NOT NULL REFERENCES mail.message_contents(id) ON DELETE CASCADE,
      flags TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      keywords TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      deleted_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX message_placements_folder_idx ON mail.message_placements (folder_id, message_id) WHERE deleted_at IS NULL`;
  await db`CREATE INDEX message_placements_message_idx ON mail.message_placements (message_id, folder_id) WHERE deleted_at IS NULL`;
  await db`CREATE INDEX message_placements_flags_idx ON mail.message_placements USING GIN (flags)`;
  await db`CREATE INDEX message_placements_keywords_idx ON mail.message_placements USING GIN (keywords)`;

  await db`
    CREATE TABLE mail.conversations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      subject TEXT NOT NULL DEFAULT '',
      participant_summary TEXT NOT NULL DEFAULT '',
      latest_inbound_at TIMESTAMPTZ,
      latest_outbound_at TIMESTAMPTZ,
      latest_message_at TIMESTAMPTZ NOT NULL,
      assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      work_status TEXT NOT NULL DEFAULT 'open' CHECK (work_status IN ('open', 'waiting', 'done')),
      response_needed BOOLEAN NOT NULL DEFAULT false,
      snoozed_until TIMESTAMPTZ,
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX conversations_mailbox_latest_idx ON mail.conversations (mailbox_id, latest_message_at DESC, id DESC)`;
  await db`CREATE INDEX conversations_mailbox_status_idx ON mail.conversations (mailbox_id, work_status, latest_message_at DESC, id DESC)`;

  await db`
    CREATE TABLE mail.conversation_messages (
      conversation_id UUID NOT NULL REFERENCES mail.conversations(id) ON DELETE CASCADE,
      message_id UUID NOT NULL UNIQUE REFERENCES mail.message_contents(id) ON DELETE CASCADE,
      position BIGINT NOT NULL CHECK (position >= 0),
      added_by TEXT NOT NULL DEFAULT 'heuristic' CHECK (added_by IN ('provider', 'headers', 'heuristic', 'manual')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, message_id)
    )
  `;
  await db`CREATE INDEX conversation_messages_order_idx ON mail.conversation_messages (conversation_id, position, message_id)`;

  await db`
    CREATE TABLE mail.sender_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '',
      from_address TEXT NOT NULL CHECK (char_length(from_address) BETWEEN 3 AND 320),
      reply_to TEXT,
      envelope_sender TEXT,
      automation_policy TEXT NOT NULL DEFAULT 'mailbox' CHECK (automation_policy IN ('disabled', 'mailbox')),
      sent_folder_id UUID REFERENCES mail.folders(id) ON DELETE SET NULL,
      drafts_folder_id UUID REFERENCES mail.folders(id) ON DELETE SET NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'rejected', 'disabled')),
      last_provider_rejection TEXT CHECK (last_provider_rejection IS NULL OR char_length(last_provider_rejection) <= 1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (mailbox_id, from_address)
    )
  `;
  await db`
    CREATE UNIQUE INDEX sender_identities_default_idx
    ON mail.sender_identities (mailbox_id)
    WHERE is_default AND status <> 'disabled'
  `;

  await db`
    CREATE TABLE mail.sender_identity_bindings (
      sender_identity_id UUID NOT NULL REFERENCES mail.sender_identities(id) ON DELETE CASCADE,
      binding_id UUID NOT NULL REFERENCES mail.provider_bindings(id) ON DELETE CASCADE,
      provider_principal TEXT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL,
      saves_sent_automatically BOOLEAN NOT NULL DEFAULT false,
      revoked_at TIMESTAMPTZ,
      last_error_code TEXT,
      PRIMARY KEY (sender_identity_id, binding_id)
    )
  `;

  await db`
    CREATE TABLE mail.commands (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('set_flags', 'move', 'copy', 'delete', 'send', 'sync_folder', 'discover_folders')),
      state TEXT NOT NULL DEFAULT 'queued'
        CHECK (state IN ('queued', 'executing', 'confirmed', 'failed', 'ambiguous', 'reconciled', 'needs_attention')),
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'service_account', 'workflow', 'system')),
      actor_id UUID,
      delegated_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
      request_hash TEXT NOT NULL CHECK (char_length(request_hash) = 64),
      correlation_id TEXT,
      target JSONB NOT NULL CHECK (jsonb_typeof(target) = 'object'),
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      expected_revision BIGINT,
      selected_binding_id UUID REFERENCES mail.provider_bindings(id) ON DELETE RESTRICT,
      rights_snapshot JSONB CHECK (rights_snapshot IS NULL OR jsonb_typeof(rights_snapshot) = 'object'),
      transport_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(transport_metadata) = 'object'),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      last_error_code TEXT,
      last_error_message TEXT CHECK (last_error_message IS NULL OR char_length(last_error_message) <= 1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT commands_actor_shape CHECK (
        (actor_kind = 'system' AND actor_id IS NULL) OR
        (actor_kind <> 'system' AND actor_id IS NOT NULL)
      ),
      UNIQUE (mailbox_id, idempotency_key)
    )
  `;
  await db`CREATE INDEX commands_dispatch_idx ON mail.commands (state, created_at, id) WHERE state IN ('queued', 'executing', 'ambiguous')`;
  await db`CREATE INDEX commands_mailbox_idx ON mail.commands (mailbox_id, created_at DESC, id DESC)`;
  await db`CREATE INDEX commands_binding_idx ON mail.commands (selected_binding_id, state) WHERE selected_binding_id IS NOT NULL`;

  await db`
    CREATE TABLE mail.drafts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      conversation_id UUID REFERENCES mail.conversations(id) ON DELETE SET NULL,
      sender_identity_id UUID NOT NULL REFERENCES mail.sender_identities(id) ON DELETE RESTRICT,
      author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'service_account')),
      author_id UUID NOT NULL,
      to_addresses JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(to_addresses) = 'array'),
      cc_addresses JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cc_addresses) = 'array'),
      bcc_addresses JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(bcc_addresses) = 'array'),
      subject TEXT NOT NULL DEFAULT '',
      body_markdown TEXT NOT NULL DEFAULT '',
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'scheduled', 'sending', 'sent', 'discarded')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX drafts_mailbox_state_idx ON mail.drafts (mailbox_id, state, updated_at DESC)`;

  await db`
    CREATE TABLE mail.outbox_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      draft_id UUID NOT NULL REFERENCES mail.drafts(id) ON DELETE RESTRICT,
      command_id UUID NOT NULL UNIQUE REFERENCES mail.commands(id) ON DELETE RESTRICT,
      sender_identity_id UUID NOT NULL REFERENCES mail.sender_identities(id) ON DELETE RESTRICT,
      selected_binding_id UUID NOT NULL REFERENCES mail.provider_bindings(id) ON DELETE RESTRICT,
      stable_message_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (state IN ('scheduled', 'undo_window', 'sending', 'accepted', 'sent_sync_pending', 'sent', 'failed', 'unknown', 'reconciled_accepted', 'reconciled_unsent', 'needs_attention')),
      scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      undo_until TIMESTAMPTZ,
      accepted_at TIMESTAMPTZ,
      provider_response JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_response) = 'object'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (mailbox_id, stable_message_id)
    )
  `;
  await db`CREATE INDEX outbox_ready_idx ON mail.outbox_submissions (state, scheduled_at, id) WHERE state IN ('scheduled', 'undo_window', 'unknown', 'sent_sync_pending')`;

  await db`
    CREATE TABLE mail.sync_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      remote_resource_id UUID NOT NULL REFERENCES mail.remote_resources(id) ON DELETE CASCADE,
      binding_id UUID NOT NULL REFERENCES mail.provider_bindings(id) ON DELETE RESTRICT,
      fence_token BIGINT NOT NULL CHECK (fence_token > 0),
      generation BIGINT NOT NULL CHECK (generation > 0),
      kind TEXT NOT NULL CHECK (kind IN ('discovery', 'incremental', 'backfill', 'reconcile', 'body_hydration', 'attachment_hydration')),
      state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'completed', 'failed', 'cancelled', 'stale_fence')),
      cursor_before JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(cursor_before) = 'object'),
      cursor_after JSONB CHECK (cursor_after IS NULL OR jsonb_typeof(cursor_after) = 'object'),
      stats JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(stats) = 'object'),
      error_code TEXT,
      error_message TEXT CHECK (error_message IS NULL OR char_length(error_message) <= 1000),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    )
  `;
  await db`CREATE INDEX sync_runs_resource_idx ON mail.sync_runs (remote_resource_id, started_at DESC)`;
  await db`CREATE INDEX sync_runs_running_idx ON mail.sync_runs (remote_resource_id, state) WHERE state = 'running'`;

  await db`
    CREATE TABLE mail.activity_events (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      conversation_id UUID REFERENCES mail.conversations(id) ON DELETE SET NULL,
      command_id UUID REFERENCES mail.commands(id) ON DELETE SET NULL,
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'service_account', 'workflow', 'system')),
      actor_id UUID,
      action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 200),
      outcome TEXT NOT NULL CHECK (outcome IN ('requested', 'confirmed', 'failed', 'reconciled')),
      target_type TEXT,
      target_id UUID,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX activity_events_mailbox_idx ON mail.activity_events (mailbox_id, created_at DESC, id DESC)`;
  await db`CREATE INDEX activity_events_conversation_idx ON mail.activity_events (conversation_id, created_at DESC, id DESC) WHERE conversation_id IS NOT NULL`;

  await db`
    CREATE OR REPLACE FUNCTION mail.touch_updated_at()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$
  `;

  for (const table of [
    "mailboxes",
    "provider_connections",
    "remote_resources",
    "provider_bindings",
    "folders",
    "binding_folder_refs",
    "conversations",
    "sender_identities",
    "commands",
    "drafts",
    "outbox_submissions",
  ]) {
    await db.unsafe(`
      CREATE TRIGGER ${table}_touch_updated_at
      BEFORE UPDATE ON mail.${table}
      FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
    `);
  }
};

const addHydrationClaims = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.message_contents
    ADD COLUMN hydration_claim_id UUID,
    ADD COLUMN hydration_claimed_at TIMESTAMPTZ
  `;
  await db`
    ALTER TABLE mail.message_contents
    DROP CONSTRAINT message_contents_hydration_status_check
  `;
  await db`
    ALTER TABLE mail.message_contents
    ADD CONSTRAINT message_contents_hydration_status_check
    CHECK (hydration_status IN ('envelope', 'headers', 'hydrating', 'body', 'complete', 'failed'))
  `;
  await db`
    ALTER TABLE mail.message_contents
    ADD CONSTRAINT message_contents_hydration_claim_check
    CHECK (
      (hydration_status = 'hydrating' AND hydration_claim_id IS NOT NULL AND hydration_claimed_at IS NOT NULL)
      OR
      (hydration_status <> 'hydrating' AND hydration_claim_id IS NULL AND hydration_claimed_at IS NULL)
    )
  `;
  await db`
    CREATE INDEX message_contents_hydration_queue_idx
    ON mail.message_contents (mailbox_id, hydration_status, internal_date DESC, id)
    WHERE hydration_status <> 'complete'
  `;
};

const addThreadingProjection = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.message_contents
    ADD COLUMN provider_thread_id TEXT,
    ADD COLUMN normalized_subject TEXT NOT NULL DEFAULT ''
  `;
  await db`
    CREATE INDEX message_contents_provider_thread_idx
    ON mail.message_contents (mailbox_id, provider_thread_id, internal_date DESC)
    WHERE provider_thread_id IS NOT NULL
  `;
  await db`
    CREATE INDEX message_contents_subject_thread_idx
    ON mail.message_contents (mailbox_id, normalized_subject, internal_date DESC)
    WHERE normalized_subject <> ''
  `;
};

const addFieldSearchDocuments = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.message_contents
    ADD COLUMN subject_search_document TSVECTOR GENERATED ALWAYS AS (
      to_tsvector('simple'::regconfig, coalesce(subject, ''))
    ) STORED,
    ADD COLUMN body_search_document TSVECTOR GENERATED ALWAYS AS (
      to_tsvector('simple'::regconfig, coalesce(plain_text, ''))
    ) STORED
  `;
  await db`CREATE INDEX message_contents_subject_search_idx ON mail.message_contents USING GIN (subject_search_document)`;
  await db`CREATE INDEX message_contents_body_search_idx ON mail.message_contents USING GIN (body_search_document)`;
};

const addOptionalBm25Index = async (db: SqlClient): Promise<void> => {
  await db.unsafe(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_textsearch') THEN
        BEGIN
          EXECUTE $index$
            CREATE INDEX IF NOT EXISTS message_contents_bm25_idx
            ON mail.message_contents USING bm25 (
              (COALESCE(subject, '') || ' ' || COALESCE(subject, '') || ' ' || COALESCE(plain_text, ''))
            ) WITH (text_config='simple')
          $index$;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'Optional Mail BM25 index unavailable: %', SQLERRM;
        END;
      END IF;
    END
    $$
  `);
};

const addDurableDraftSnapshots = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.drafts
    ADD COLUMN body_format TEXT NOT NULL DEFAULT 'markdown'
      CHECK (body_format IN ('plain', 'markdown'))
  `;
  await db`
    ALTER TABLE mail.outbox_submissions
    ADD COLUMN draft_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
      CHECK (jsonb_typeof(draft_snapshot) = 'object'),
    ADD COLUMN mime_blob_id UUID REFERENCES mail.message_part_blobs(id) ON DELETE RESTRICT
  `;
};

const addDurableCommandExecution = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.commands
    ADD COLUMN access_subject_kind TEXT,
    ADD COLUMN access_subject_id UUID,
    ADD COLUMN credential_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::text[]
  `;
  await db`
    UPDATE mail.commands
    SET
      access_subject_kind = CASE
        WHEN actor_kind = 'user' THEN 'user'
        WHEN actor_kind = 'service_account' AND delegated_user_id IS NOT NULL THEN 'user'
        WHEN actor_kind = 'service_account' THEN 'service_account'
        ELSE 'system'
      END,
      access_subject_id = CASE
        WHEN actor_kind = 'user' THEN actor_id
        WHEN actor_kind = 'service_account' AND delegated_user_id IS NOT NULL THEN delegated_user_id
        WHEN actor_kind = 'service_account' THEN actor_id
        ELSE NULL
      END
  `;
  await db`
    ALTER TABLE mail.commands
    ALTER COLUMN access_subject_kind SET NOT NULL,
    DROP CONSTRAINT commands_state_check,
    ADD CONSTRAINT commands_state_check CHECK (
      state IN ('queued', 'executing', 'confirmed', 'failed', 'cancelled', 'ambiguous', 'reconciled', 'needs_attention')
    ),
    ADD CONSTRAINT commands_access_subject_check CHECK (
      (access_subject_kind = 'system' AND access_subject_id IS NULL)
      OR
      (access_subject_kind IN ('user', 'service_account') AND access_subject_id IS NOT NULL)
    )
  `;
  await db`
    ALTER TABLE mail.outbox_submissions
    ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    ADD COLUMN last_error_code TEXT,
    ADD COLUMN last_error_message TEXT CHECK (last_error_message IS NULL OR char_length(last_error_message) <= 1000),
    DROP CONSTRAINT outbox_submissions_state_check,
    ADD CONSTRAINT outbox_submissions_state_check CHECK (
      state IN (
        'scheduled', 'undo_window', 'sending', 'accepted', 'sent_sync_pending', 'sent', 'failed',
        'cancelled', 'unknown', 'reconciled_accepted', 'reconciled_unsent', 'needs_attention'
      )
    )
  `;
  await db`
    CREATE INDEX commands_stale_execution_idx
    ON mail.commands (started_at, id)
    WHERE state = 'executing'
  `;
};

const addBoundedHydrationRetries = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.message_contents
    ADD COLUMN hydration_attempt INTEGER NOT NULL DEFAULT 0 CHECK (hydration_attempt >= 0)
  `;
  await db`DROP INDEX mail.message_contents_hydration_queue_idx`;
  await db`
    CREATE INDEX message_contents_hydration_queue_idx
    ON mail.message_contents (mailbox_id, hydration_status, internal_date DESC, id)
    WHERE hydration_status IN ('envelope', 'headers', 'body')
       OR (hydration_status = 'failed' AND hydration_attempt < 5)
  `;
};

const addChunkedBodySearch = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE mail.message_search_chunks (
      message_id UUID NOT NULL REFERENCES mail.message_contents(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      search_document TSVECTOR NOT NULL,
      PRIMARY KEY (message_id, position)
    )
  `;
  await db`
    CREATE INDEX message_search_chunks_document_idx
    ON mail.message_search_chunks USING GIN (search_document)
  `;
  const stride = SEARCH_CHUNK_CHARACTERS - SEARCH_CHUNK_OVERLAP_CHARACTERS;
  await db.unsafe(`
    INSERT INTO mail.message_search_chunks (message_id, position, search_document)
    SELECT
      mc.id,
      chunk.position,
      to_tsvector(
        'simple'::regconfig,
        substring(mc.plain_text FROM chunk.position * ${stride} + 1 FOR ${SEARCH_CHUNK_CHARACTERS})
      )
    FROM mail.message_contents mc
    CROSS JOIN LATERAL generate_series(
      0,
      (char_length(mc.plain_text) - 1) / ${stride}
    ) AS chunk(position)
    WHERE mc.plain_text IS NOT NULL AND mc.plain_text <> ''
  `);
  await db`DROP INDEX mail.message_contents_search_idx`;
  await db`DROP INDEX mail.message_contents_body_search_idx`;
  await db`
    ALTER TABLE mail.message_contents
    DROP COLUMN search_document,
    DROP COLUMN body_search_document
  `;
};

const addSearchBackendModes = async (db: SqlClient): Promise<void> => {
  await db`
    UPDATE mail.mailboxes
    SET search_backend = 'postgres'
    WHERE search_backend = 'native'
  `;
  await db`
    ALTER TABLE mail.mailboxes
    DROP CONSTRAINT mailboxes_search_backend_check,
    ALTER COLUMN search_backend SET DEFAULT 'auto',
    ADD CONSTRAINT mailboxes_search_backend_check
      CHECK (search_backend IN ('auto', 'postgres', 'pg_textsearch'))
  `;
};

const addCredentialRevisionBindings = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.provider_bindings
    ADD COLUMN verified_secret_revision INTEGER NOT NULL DEFAULT 1
      CHECK (verified_secret_revision > 0)
  `;
  await db`
    UPDATE mail.provider_bindings binding
    SET verified_secret_revision = connection.secret_revision
    FROM mail.provider_connections connection
    WHERE connection.id = binding.connection_id
  `;
  await db`
    ALTER TABLE mail.sender_identity_bindings
    ADD COLUMN verified_secret_revision INTEGER NOT NULL DEFAULT 1
      CHECK (verified_secret_revision > 0)
  `;
  await db`
    UPDATE mail.sender_identity_bindings sender_binding
    SET verified_secret_revision = connection.secret_revision
    FROM mail.provider_bindings binding
    JOIN mail.provider_connections connection ON connection.id = binding.connection_id
    WHERE binding.id = sender_binding.binding_id
  `;
  await db`
    ALTER TABLE mail.commands
    ADD COLUMN selected_secret_revision INTEGER
      CHECK (selected_secret_revision IS NULL OR selected_secret_revision > 0)
  `;
  await db`
    UPDATE mail.commands command
    SET selected_secret_revision = binding.verified_secret_revision
    FROM mail.provider_bindings binding
    WHERE binding.id = command.selected_binding_id
  `;
  await db`
    ALTER TABLE mail.commands
    ADD CONSTRAINT commands_selected_credential_check CHECK (
      (selected_binding_id IS NULL AND selected_secret_revision IS NULL)
      OR
      (selected_binding_id IS NOT NULL AND selected_secret_revision IS NOT NULL)
    )
  `;
};

const addCommandWorkerHeartbeats = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.commands
    ADD COLUMN worker_heartbeat_at TIMESTAMPTZ
  `;
  await db`DROP INDEX mail.commands_stale_execution_idx`;
  await db`
    CREATE INDEX commands_stale_execution_idx
    ON mail.commands (COALESCE(worker_heartbeat_at, started_at), id)
    WHERE state = 'executing'
  `;
};

const addLifecycleControlPlane = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.folders
    ADD COLUMN discovery_state TEXT NOT NULL DEFAULT 'active'
      CHECK (discovery_state IN ('active', 'missing', 'ambiguous')),
    ADD COLUMN missing_since TIMESTAMPTZ
  `;
  await db`
    ALTER TABLE mail.binding_folder_refs
    ADD COLUMN last_seen_generation BIGINT NOT NULL DEFAULT 0 CHECK (last_seen_generation >= 0),
    ADD COLUMN missing_since TIMESTAMPTZ
  `;
  await db`
    UPDATE mail.binding_folder_refs ref
    SET last_seen_generation = folder.discovery_generation
    FROM mail.folders folder
    WHERE folder.id = ref.folder_id
  `;
  await db`
    ALTER TABLE mail.commands
    ADD COLUMN result JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
    DROP CONSTRAINT commands_kind_check,
    ADD CONSTRAINT commands_kind_check CHECK (
      kind IN (
        'set_flags', 'move', 'copy', 'delete', 'send',
        'sync_mailbox', 'sync_folder', 'discover_folders', 'verify_binding', 'rebuild_folder', 'hydrate_missing'
      )
    )
  `;
  await db`
    CREATE INDEX binding_folder_refs_discovery_idx
    ON mail.binding_folder_refs (binding_id, last_seen_generation, folder_id)
  `;
  await db`
    CREATE INDEX folders_discovery_state_idx
    ON mail.folders (remote_resource_id, discovery_state, role, id)
  `;
};

const addProviderBackedOperations = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE mail.folder_role_overrides (
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('sent', 'drafts', 'trash', 'archive', 'junk')),
      folder_id UUID NOT NULL REFERENCES mail.folders(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (mailbox_id, role),
      UNIQUE (mailbox_id, folder_id)
    )
  `;
  await db`
    CREATE TRIGGER folder_role_overrides_touch_updated_at
    BEFORE UPDATE ON mail.folder_role_overrides
    FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
  `;
  await db`
    CREATE TABLE mail.draft_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      draft_id UUID NOT NULL REFERENCES mail.drafts(id) ON DELETE CASCADE,
      blob_id UUID NOT NULL REFERENCES mail.message_part_blobs(id) ON DELETE RESTRICT,
      filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
      content_type TEXT NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 255),
      byte_length BIGINT NOT NULL CHECK (byte_length >= 0),
      content_hash TEXT NOT NULL CHECK (char_length(content_hash) = 64),
      position INTEGER NOT NULL CHECK (position >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      removed_at TIMESTAMPTZ,
      UNIQUE (draft_id, position)
    )
  `;
  await db`CREATE INDEX draft_attachments_draft_idx ON mail.draft_attachments (draft_id, position, id)`;
  await db`
    ALTER TABLE mail.commands
    DROP CONSTRAINT commands_kind_check,
    ADD CONSTRAINT commands_kind_check CHECK (
      kind IN (
        'set_flags', 'change_message_state', 'move', 'copy', 'delete',
        'create_folder', 'rename_folder', 'delete_folder', 'set_folder_subscription', 'send',
        'sync_mailbox', 'sync_folder', 'discover_folders', 'verify_binding', 'rebuild_folder', 'hydrate_missing'
      )
    )
  `;
};

const hardenProviderBackedOperations = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.draft_attachments ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ`;
};

const addConversationCollaboration = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE mail.conversation_watchers (
      conversation_id UUID NOT NULL REFERENCES mail.conversations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, user_id)
    )
  `;
  await db`CREATE INDEX conversation_watchers_user_idx ON mail.conversation_watchers (user_id, conversation_id)`;

  await db`
    CREATE TABLE mail.conversation_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES mail.conversations(id) ON DELETE CASCADE,
      author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'service_account')),
      author_id UUID NOT NULL,
      body_markdown TEXT NOT NULL CHECK (char_length(body_markdown) BETWEEN 1 AND 50000),
      parent_comment_id UUID REFERENCES mail.conversation_comments(id) ON DELETE SET NULL,
      referenced_message_id UUID REFERENCES mail.message_contents(id) ON DELETE SET NULL,
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`CREATE INDEX conversation_comments_conversation_idx ON mail.conversation_comments (conversation_id, created_at, id)`;
  await db`
    CREATE TRIGGER conversation_comments_touch_updated_at
    BEFORE UPDATE ON mail.conversation_comments
    FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
  `;

  await db`
    CREATE TABLE mail.conversation_comment_versions (
      comment_id UUID NOT NULL REFERENCES mail.conversation_comments(id) ON DELETE CASCADE,
      revision BIGINT NOT NULL CHECK (revision > 0),
      body_markdown TEXT NOT NULL CHECK (char_length(body_markdown) BETWEEN 1 AND 50000),
      editor_kind TEXT NOT NULL CHECK (editor_kind IN ('user', 'service_account')),
      editor_id UUID NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (comment_id, revision)
    )
  `;

  await db`
    CREATE TABLE mail.conversation_comment_mentions (
      comment_id UUID NOT NULL,
      revision BIGINT NOT NULL,
      user_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (comment_id, revision, user_id),
      FOREIGN KEY (comment_id, revision)
        REFERENCES mail.conversation_comment_versions(comment_id, revision)
        ON DELETE CASCADE
    )
  `;
  await db`CREATE INDEX conversation_comment_mentions_user_idx ON mail.conversation_comment_mentions (user_id, created_at DESC, comment_id)`;

  await db`CREATE INDEX conversations_mailbox_assignee_idx ON mail.conversations (mailbox_id, assignee_user_id, latest_message_at DESC, id DESC)`;
  await db`CREATE INDEX conversations_mailbox_snoozed_idx ON mail.conversations (mailbox_id, snoozed_until, id) WHERE snoozed_until IS NOT NULL`;
  await db`CREATE INDEX conversations_mailbox_activity_idx ON mail.conversations (mailbox_id, updated_at DESC, id DESC)`;
};

const addWorkflowFoundation = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.commands
    ADD COLUMN initiator_actor_kind TEXT,
    ADD COLUMN initiator_actor_id UUID
  `;
  await db`
    ALTER TABLE mail.commands
    ADD CONSTRAINT commands_initiator_actor_check CHECK (
      (initiator_actor_kind IS NULL AND initiator_actor_id IS NULL)
      OR
      (initiator_actor_kind IN ('user', 'service_account') AND initiator_actor_id IS NOT NULL)
    )
  `;

  await db`
    CREATE TABLE mail.workflows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      lifecycle TEXT NOT NULL CHECK (lifecycle IN ('saved', 'one_shot')),
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
      current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
      created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('user', 'service_account')),
      created_by_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (id, mailbox_id)
    )
  `;
  await db`
    CREATE UNIQUE INDEX workflows_saved_name_idx
    ON mail.workflows (mailbox_id, lower(name))
    WHERE lifecycle = 'saved'
  `;

  await db`
    CREATE TABLE mail.workflow_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID NOT NULL,
      mailbox_id UUID NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
      definition_hash TEXT NOT NULL CHECK (char_length(definition_hash) = 64),
      created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('user', 'service_account')),
      created_by_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (workflow_id, mailbox_id)
        REFERENCES mail.workflows(id, mailbox_id)
        ON DELETE CASCADE,
      UNIQUE (workflow_id, version),
      UNIQUE (id, workflow_id, mailbox_id)
    )
  `;
  await db`CREATE INDEX workflow_versions_mailbox_idx ON mail.workflow_versions (mailbox_id, created_at DESC, id DESC)`;

  await db`
    CREATE TABLE mail.workflow_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      workflow_id UUID NOT NULL,
      workflow_version_id UUID NOT NULL,
      workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'backfill')),
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
        'queued', 'running', 'waiting_command', 'succeeded',
        'failed', 'canceled', 'needs_attention'
      )),
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'service_account')),
      actor_id UUID NOT NULL,
      delegated_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      access_subject_kind TEXT NOT NULL CHECK (access_subject_kind IN ('user', 'service_account')),
      access_subject_id UUID NOT NULL,
      credential_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
      request_hash TEXT NOT NULL CHECK (char_length(request_hash) = 64),
      target_query JSONB NOT NULL CHECK (jsonb_typeof(target_query) = 'object'),
      query_hash TEXT NOT NULL CHECK (char_length(query_hash) = 64),
      target_snapshot_hash TEXT NOT NULL CHECK (char_length(target_snapshot_hash) = 64),
      preview_hash TEXT NOT NULL CHECK (char_length(preview_hash) = 64),
      effect_budget JSONB NOT NULL CHECK (jsonb_typeof(effect_budget) = 'object'),
      action_counts JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(action_counts) = 'object'),
      target_count INTEGER NOT NULL DEFAULT 0 CHECK (target_count >= 0),
      action_target_count INTEGER NOT NULL DEFAULT 0 CHECK (action_target_count >= 0),
      completed_targets INTEGER NOT NULL DEFAULT 0 CHECK (completed_targets >= 0),
      failed_targets INTEGER NOT NULL DEFAULT 0 CHECK (failed_targets >= 0),
      cursor_ordinal BIGINT NOT NULL DEFAULT -1 CHECK (cursor_ordinal >= -1),
      last_error_code TEXT,
      last_error_message TEXT CHECK (last_error_message IS NULL OR char_length(last_error_message) <= 1000),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (workflow_version_id, workflow_id, mailbox_id)
        REFERENCES mail.workflow_versions(id, workflow_id, mailbox_id)
        ON DELETE RESTRICT,
      UNIQUE (mailbox_id, idempotency_key)
    )
  `;
  await db`
    CREATE INDEX workflow_runs_dispatch_idx
    ON mail.workflow_runs (state, updated_at, id)
    WHERE state IN ('queued', 'running', 'waiting_command')
  `;
  await db`CREATE INDEX workflow_runs_workflow_idx ON mail.workflow_runs (workflow_id, created_at DESC, id DESC)`;

  await db`
    CREATE TABLE mail.workflow_run_targets (
      run_id UUID NOT NULL REFERENCES mail.workflow_runs(id) ON DELETE CASCADE,
      ordinal BIGINT NOT NULL CHECK (ordinal >= 0),
      remote_message_ref_id UUID NOT NULL,
      message_id UUID NOT NULL,
      conversation_id UUID,
      source_folder_id UUID NOT NULL,
      source_state_hash TEXT NOT NULL CHECK (char_length(source_state_hash) = 64),
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN (
        'pending', 'running', 'waiting_command', 'succeeded', 'failed', 'needs_attention'
      )),
      planned_action_count INTEGER NOT NULL DEFAULT 0 CHECK (planned_action_count >= 0),
      last_error_code TEXT,
      last_error_message TEXT CHECK (last_error_message IS NULL OR char_length(last_error_message) <= 1000),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, ordinal),
      UNIQUE (run_id, remote_message_ref_id)
    )
  `;
  await db`
    CREATE INDEX workflow_run_targets_dispatch_idx
    ON mail.workflow_run_targets (run_id, state, ordinal)
    WHERE state IN ('pending', 'running', 'waiting_command')
  `;

  await db`
    CREATE TABLE mail.workflow_step_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL,
      target_ordinal BIGINT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      step_path TEXT NOT NULL CHECK (char_length(step_path) BETWEEN 1 AND 1000),
      action JSONB NOT NULL CHECK (jsonb_typeof(action) = 'object'),
      expected_conversation_revision BIGINT CHECK (expected_conversation_revision IS NULL OR expected_conversation_revision > 0),
      idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
        'queued', 'executing', 'waiting_command', 'succeeded', 'failed', 'needs_attention'
      )),
      command_id UUID REFERENCES mail.commands(id) ON DELETE SET NULL,
      attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
      result JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
      last_error_code TEXT,
      last_error_message TEXT CHECK (last_error_message IS NULL OR char_length(last_error_message) <= 1000),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (run_id, target_ordinal)
        REFERENCES mail.workflow_run_targets(run_id, ordinal)
        ON DELETE CASCADE,
      UNIQUE (run_id, target_ordinal, sequence),
      UNIQUE (run_id, target_ordinal, step_path),
      UNIQUE (idempotency_key)
    )
  `;
  await db`
    CREATE INDEX workflow_step_runs_dispatch_idx
    ON mail.workflow_step_runs (run_id, target_ordinal, state, sequence)
    WHERE state IN ('queued', 'executing', 'waiting_command')
  `;

  for (const table of ["workflows", "workflow_runs", "workflow_run_targets", "workflow_step_runs"]) {
    await db.unsafe(`
      CREATE TRIGGER ${table}_touch_updated_at
      BEFORE UPDATE ON mail.${table}
      FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
    `);
  }
};

const addWorkflowRuntimeFencing = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.workflow_step_runs
    ADD COLUMN provider_lease_token UUID,
    ADD COLUMN provider_lease_expires_at TIMESTAMPTZ,
    ADD CONSTRAINT workflow_step_runs_provider_lease_check CHECK (
      (provider_lease_token IS NULL AND provider_lease_expires_at IS NULL)
      OR
      (provider_lease_token IS NOT NULL AND provider_lease_expires_at IS NOT NULL)
    )
  `;
};

const hardenWorkflowFoundation = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.commands ADD COLUMN credential_id UUID`;
  await db`ALTER TABLE mail.commands ADD COLUMN credential_expires_at TIMESTAMPTZ`;
  await db`ALTER TABLE mail.workflow_runs ADD COLUMN credential_id UUID`;
  await db`ALTER TABLE mail.workflow_runs ADD COLUMN credential_expires_at TIMESTAMPTZ`;
  await db`
    CREATE FUNCTION mail.reject_workflow_version_update()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'workflow versions are immutable' USING ERRCODE = '55000';
    END;
    $$ LANGUAGE plpgsql
  `;
  await db`
    CREATE TRIGGER workflow_versions_reject_update
    BEFORE UPDATE ON mail.workflow_versions
    FOR EACH ROW EXECUTE FUNCTION mail.reject_workflow_version_update()
  `;
};

const addWorkflowRemotePreconditions = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.workflow_step_runs
    ADD COLUMN expected_remote_state JSONB,
    ADD CONSTRAINT workflow_step_runs_expected_remote_state_check CHECK (
      expected_remote_state IS NULL OR jsonb_typeof(expected_remote_state) = 'object'
    )
  `;
};

const repairWorkflowHardening = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.commands ADD COLUMN IF NOT EXISTS credential_expires_at TIMESTAMPTZ`;
  await db`ALTER TABLE mail.workflow_runs ADD COLUMN IF NOT EXISTS credential_expires_at TIMESTAMPTZ`;
  await db`
    UPDATE mail.commands
    SET
      state = 'needs_attention',
      last_error_code = 'AUTH_PROVENANCE_MISSING',
      last_error_message = 'Stored service credential provenance is unavailable after upgrade',
      finished_at = now()
    WHERE state IN ('queued', 'executing', 'ambiguous')
      AND (actor_kind = 'service_account' OR initiator_actor_kind = 'service_account')
      AND credential_id IS NULL
      AND credential_expires_at IS NULL
  `;
  await db`
    UPDATE mail.workflow_step_runs step
    SET
      state = 'failed',
      last_error_code = 'AUTH_PROVENANCE_MISSING',
      last_error_message = 'Stored service credential provenance is unavailable after upgrade',
      provider_lease_token = NULL,
      provider_lease_expires_at = NULL,
      finished_at = now()
    FROM mail.workflow_runs run
    WHERE step.run_id = run.id
      AND run.actor_kind = 'service_account'
      AND run.credential_id IS NULL
      AND run.credential_expires_at IS NULL
      AND step.state IN ('queued', 'executing', 'waiting_command')
  `;
  await db`
    UPDATE mail.workflow_run_targets target
    SET
      state = 'failed',
      last_error_code = 'AUTH_PROVENANCE_MISSING',
      last_error_message = 'Stored service credential provenance is unavailable after upgrade',
      finished_at = now()
    FROM mail.workflow_runs run
    WHERE target.run_id = run.id
      AND run.actor_kind = 'service_account'
      AND run.credential_id IS NULL
      AND run.credential_expires_at IS NULL
      AND target.state IN ('pending', 'running', 'waiting_command')
  `;
  await db`
    UPDATE mail.workflow_runs
    SET
      state = 'needs_attention',
      completed_targets = target.completed,
      failed_targets = target.failed,
      last_error_code = 'AUTH_PROVENANCE_MISSING',
      last_error_message = 'Stored service credential provenance is unavailable after upgrade',
      finished_at = now()
    FROM (
      SELECT
        run.id AS run_id,
        COUNT(target.run_id) FILTER (WHERE target.state = 'succeeded')::int AS completed,
        COUNT(target.run_id) FILTER (WHERE target.state IN ('failed', 'needs_attention'))::int AS failed
      FROM mail.workflow_runs run
      LEFT JOIN mail.workflow_run_targets target ON target.run_id = run.id
      WHERE run.actor_kind = 'service_account'
        AND run.credential_id IS NULL
        AND run.credential_expires_at IS NULL
        AND run.state IN ('queued', 'running', 'waiting_command')
      GROUP BY run.id
    ) target
    WHERE workflow_runs.id = target.run_id
  `;
  await db`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'mail.workflow_runs'::regclass
          AND conname = 'workflow_runs_actor_idempotency_key'
      ) THEN
        ALTER TABLE mail.workflow_runs DROP CONSTRAINT workflow_runs_actor_idempotency_key;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'mail.workflow_runs'::regclass
          AND conname = 'workflow_runs_mailbox_id_idempotency_key_key'
      ) THEN
        ALTER TABLE mail.workflow_runs
        ADD CONSTRAINT workflow_runs_mailbox_id_idempotency_key_key UNIQUE (mailbox_id, idempotency_key);
      END IF;
    END
    $$
  `;
};

const addConversationThreadOverrides = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE mail.conversation_thread_overrides (
      message_id UUID PRIMARY KEY REFERENCES mail.message_contents(id) ON DELETE CASCADE,
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL REFERENCES mail.conversations(id) ON DELETE CASCADE,
      reason TEXT NOT NULL CHECK (reason IN ('merge', 'split')),
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'service_account')),
      actor_id UUID NOT NULL,
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`
    CREATE INDEX conversation_thread_overrides_conversation_idx
    ON mail.conversation_thread_overrides (conversation_id, message_id)
  `;
};

const addCollaborationOperations = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE mail.conversation_reminders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL REFERENCES mail.conversations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      due_at TIMESTAMPTZ NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'canceled')),
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ,
      UNIQUE (conversation_id, user_id)
    )
  `;
  await db`
    CREATE INDEX conversation_reminders_due_idx
    ON mail.conversation_reminders (due_at, id)
    WHERE state = 'pending'
  `;

  await db`
    CREATE TABLE mail.collaboration_notification_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind TEXT NOT NULL CHECK (kind IN ('mention', 'reminder')),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL REFERENCES mail.conversations(id) ON DELETE CASCADE,
      recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      source_id UUID NOT NULL,
      source_revision BIGINT NOT NULL CHECK (source_revision > 0),
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'skipped')),
      available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
      claim_id UUID,
      claimed_at TIMESTAMPTZ,
      last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at TIMESTAMPTZ,
      CONSTRAINT collaboration_notification_claim_check CHECK (
        (state = 'sending' AND claim_id IS NOT NULL AND claimed_at IS NOT NULL)
        OR
        (state <> 'sending' AND claim_id IS NULL AND claimed_at IS NULL)
      ),
      UNIQUE (kind, source_id, source_revision, recipient_user_id)
    )
  `;
  await db`
    CREATE INDEX collaboration_notification_dispatch_idx
    ON mail.collaboration_notification_deliveries (available_at, created_at, id)
    WHERE state = 'pending'
  `;
  await db`
    CREATE INDEX collaboration_notification_stale_claim_idx
    ON mail.collaboration_notification_deliveries (claimed_at, id)
    WHERE state = 'sending'
  `;

  await db`
    CREATE TABLE mail.saved_conversation_views (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('private', 'mailbox')),
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      filter JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filter) = 'object'),
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('user', 'service_account')),
      created_by_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT saved_conversation_views_owner_check CHECK (
        (scope = 'private' AND owner_user_id IS NOT NULL)
        OR
        (scope = 'mailbox' AND owner_user_id IS NULL)
      )
    )
  `;
  await db`
    CREATE UNIQUE INDEX saved_conversation_views_private_name_idx
    ON mail.saved_conversation_views (mailbox_id, owner_user_id, lower(name))
    WHERE scope = 'private'
  `;
  await db`
    CREATE UNIQUE INDEX saved_conversation_views_mailbox_name_idx
    ON mail.saved_conversation_views (mailbox_id, lower(name))
    WHERE scope = 'mailbox'
  `;
  await db`
    CREATE INDEX saved_conversation_views_list_idx
    ON mail.saved_conversation_views (mailbox_id, scope, owner_user_id, name, id)
  `;

  for (const table of ["conversation_reminders", "collaboration_notification_deliveries", "saved_conversation_views"]) {
    await db.unsafe(`
      CREATE TRIGGER ${table}_touch_updated_at
      BEFORE UPDATE ON mail.${table}
      FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
    `);
  }
};

const hardenRuntimeHistory = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE INDEX IF NOT EXISTS workflow_runs_mailbox_history_idx
    ON mail.workflow_runs (mailbox_id, created_at DESC, id DESC)
  `;
  await db`
    ALTER TABLE mail.activity_events
    DROP CONSTRAINT IF EXISTS activity_events_conversation_id_fkey
  `;
};

const addVerifiedSourceIdentityLookup = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE INDEX IF NOT EXISTS message_contents_source_identity_idx
    ON mail.message_contents (mailbox_id, source_hash, created_at, id)
    WHERE source_hash IS NOT NULL AND hydration_status = 'complete'
  `;
};

const createCanonicalWorkflowStepRuns = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE IF NOT EXISTS mail.workflow_step_runs (
      target_id UUID NOT NULL REFERENCES mail.workflow_run_targets(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL CHECK (char_length(step_key) BETWEEN 1 AND 1000),
      source_path JSONB NOT NULL CHECK (jsonb_typeof(source_path) = 'array'),
      iteration_path JSONB NOT NULL CHECK (jsonb_typeof(iteration_path) = 'array'),
      path JSONB NOT NULL CHECK (jsonb_typeof(path) = 'array'),
      mode TEXT NOT NULL CHECK (mode IN ('execute', 'dryRun')),
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
        'queued', 'running', 'waiting', 'succeeded', 'failed', 'skipped', 'indeterminate', 'needs_attention'
      )),
      outcome JSONB,
      dependency JSONB CHECK (dependency IS NULL OR jsonb_typeof(dependency) = 'object'),
      command_id UUID REFERENCES mail.commands(id) ON DELETE SET NULL,
      execution_generation BIGINT NOT NULL CHECK (execution_generation >= 0),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT workflow_step_runs_waiting_dependency_check CHECK (
        (state = 'waiting' AND dependency IS NOT NULL)
        OR (state <> 'waiting' AND dependency IS NULL)
      ),
      CONSTRAINT workflow_step_runs_outcome_check CHECK (
        (state IN ('succeeded', 'failed', 'skipped', 'indeterminate', 'needs_attention') AND outcome IS NOT NULL)
        OR (state IN ('queued', 'running', 'waiting') AND outcome IS NULL)
      ),
      PRIMARY KEY (target_id, step_key)
    )
  `;
  await db`
    CREATE INDEX IF NOT EXISTS workflow_step_runs_dispatch_idx
    ON mail.workflow_step_runs (target_id, state, step_key)
    WHERE state IN ('queued', 'running', 'waiting')
  `;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS workflow_step_runs_command_idx
    ON mail.workflow_step_runs (command_id)
    WHERE command_id IS NOT NULL
  `;
};

const replaceWorkflowFoundation = async (db: SqlClient): Promise<void> => {
  const [canonical] = await db<{ present: boolean }[]>`
    SELECT
      to_regclass('mail.workflows') IS NOT NULL
      AND to_regclass('mail.workflow_versions') IS NOT NULL
      AND to_regclass('mail.workflow_run_targets') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mail' AND table_name = 'workflow_versions' AND column_name = 'version_identity'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mail' AND table_name = 'workflow_run_targets' AND column_name = 'target_key'
      ) AS present
  `;
  if (canonical?.present) {
    const stepRunsMissing = await db<{ missing: boolean }[]>`
      SELECT to_regclass('mail.workflow_step_runs') IS NULL AS missing
    `;
    await createCanonicalWorkflowStepRuns(db);
    if (stepRunsMissing[0]?.missing) {
      await db`
        CREATE TRIGGER workflow_step_runs_touch_updated_at
        BEFORE UPDATE ON mail.workflow_step_runs
        FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
      `;
    }
    return;
  }

  await db`
    ALTER TABLE IF EXISTS mail.workflows
    DROP CONSTRAINT IF EXISTS workflows_current_version_fkey,
    DROP CONSTRAINT IF EXISTS workflows_active_version_fkey
  `;
  await db`DROP TABLE IF EXISTS mail.workflow_step_runs`;
  await db`DROP TABLE IF EXISTS mail.workflow_run_targets`;
  await db`DROP TABLE IF EXISTS mail.workflow_runs`;
  await db`DROP TABLE IF EXISTS mail.workflow_trigger_events`;
  await db`DROP TABLE IF EXISTS mail.workflow_activations`;
  await db`DROP TABLE IF EXISTS mail.workflow_versions`;
  await db`DROP TABLE IF EXISTS mail.workflows`;
  await db`DROP FUNCTION IF EXISTS mail.reject_workflow_version_update()`;

  await db`
    CREATE TABLE mail.workflows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
      priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN -1000 AND 1000),
      current_version_id UUID NOT NULL,
      active_version_id UUID,
      created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('user', 'service_account')),
      created_by_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (id, mailbox_id)
    )
  `;
  await db`
    CREATE UNIQUE INDEX workflows_mailbox_name_idx
    ON mail.workflows (mailbox_id, lower(name))
  `;
  await db`
    CREATE INDEX workflows_mailbox_priority_idx
    ON mail.workflows (mailbox_id, priority, id)
  `;
  await db`
    CREATE INDEX workflows_active_idx
    ON mail.workflows (mailbox_id, priority, id)
    WHERE active_version_id IS NOT NULL
  `;

  await db`
    CREATE TABLE mail.workflow_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      version_identity TEXT NOT NULL UNIQUE CHECK (char_length(version_identity) BETWEEN 1 AND 200),
      workflow_id UUID NOT NULL,
      mailbox_id UUID NOT NULL,
      source TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 200000),
      source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
      ir JSONB NOT NULL CHECK (jsonb_typeof(ir) = 'object'),
      bound_plan JSONB NOT NULL CHECK (jsonb_typeof(bound_plan) = 'object'),
      diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(diagnostics) = 'array'),
      effect_budget JSONB NOT NULL CHECK (jsonb_typeof(effect_budget) = 'object'),
      language_id TEXT NOT NULL CHECK (char_length(language_id) BETWEEN 1 AND 200),
      language_version INTEGER NOT NULL CHECK (language_version > 0),
      manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
      catalog_hash TEXT NOT NULL CHECK (catalog_hash ~ '^[a-f0-9]{64}$'),
      compiler_name TEXT NOT NULL CHECK (char_length(compiler_name) BETWEEN 1 AND 200),
      compiler_version TEXT NOT NULL CHECK (char_length(compiler_version) BETWEEN 1 AND 200),
      created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('user', 'service_account')),
      created_by_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (workflow_id, mailbox_id)
        REFERENCES mail.workflows(id, mailbox_id)
        ON DELETE CASCADE,
      UNIQUE (id, workflow_id, mailbox_id),
      UNIQUE (id, workflow_id, mailbox_id, version_identity, source_hash)
    )
  `;
  await db`
    CREATE INDEX workflow_versions_workflow_history_idx
    ON mail.workflow_versions (workflow_id, created_at DESC, id DESC)
  `;
  await db`
    CREATE INDEX workflow_versions_source_hash_idx
    ON mail.workflow_versions (source_hash, id)
  `;

  await db`
    ALTER TABLE mail.workflows
    ADD CONSTRAINT workflows_current_version_fkey
      FOREIGN KEY (current_version_id, id, mailbox_id)
      REFERENCES mail.workflow_versions(id, workflow_id, mailbox_id)
      DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT workflows_active_version_fkey
      FOREIGN KEY (active_version_id, id, mailbox_id)
      REFERENCES mail.workflow_versions(id, workflow_id, mailbox_id)
      DEFERRABLE INITIALLY DEFERRED
  `;

  await db`
    CREATE TABLE mail.workflow_activations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL,
      workflow_id UUID NOT NULL,
      workflow_version_id UUID NOT NULL,
      trigger_key TEXT NOT NULL CHECK (char_length(trigger_key) BETWEEN 1 AND 200),
      trigger_kind TEXT NOT NULL CHECK (char_length(trigger_kind) BETWEEN 1 AND 120),
      trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_config) = 'object'),
      authorization_snapshot JSONB NOT NULL CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
      enabled BOOLEAN NOT NULL DEFAULT true,
      diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(diagnostics) = 'array'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (workflow_version_id, workflow_id, mailbox_id)
        REFERENCES mail.workflow_versions(id, workflow_id, mailbox_id)
        ON DELETE CASCADE,
      UNIQUE (workflow_id, trigger_key)
    )
  `;
  await db`
    CREATE INDEX workflow_activations_dispatch_idx
    ON mail.workflow_activations (mailbox_id, trigger_kind, workflow_version_id, id)
    WHERE enabled
  `;

  await db`
    CREATE TABLE mail.workflow_trigger_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      trigger_kind TEXT NOT NULL CHECK (char_length(trigger_kind) BETWEEN 1 AND 120),
      delivery_key TEXT NOT NULL CHECK (char_length(delivery_key) BETWEEN 1 AND 500),
      occurred_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
      execution_generation BIGINT NOT NULL DEFAULT 0 CHECK (execution_generation >= 0),
      lease_owner TEXT,
      lease_token UUID,
      lease_expires_at TIMESTAMPTZ,
      result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
      last_error JSONB CHECK (last_error IS NULL OR jsonb_typeof(last_error) = 'object'),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT workflow_trigger_events_lease_check CHECK (
        (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
        OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      ),
      UNIQUE (mailbox_id, trigger_kind, delivery_key)
    )
  `;
  await db`
    CREATE INDEX workflow_trigger_events_dispatch_idx
    ON mail.workflow_trigger_events (state, lease_expires_at, occurred_at, id)
    WHERE state IN ('queued', 'running')
  `;

  await db`
    CREATE TABLE mail.workflow_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      workflow_id UUID NOT NULL,
      workflow_version_id UUID NOT NULL,
      version_identity TEXT NOT NULL,
      source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
      kind TEXT NOT NULL CHECK (kind IN ('invoke', 'backfill', 'oneShot', 'trigger')),
      mode TEXT NOT NULL CHECK (mode IN ('execute', 'dryRun')),
      channel TEXT NOT NULL CHECK (channel IN ('ui', 'api', 'bulk', 'agent', 'schedule', 'event')),
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
        'queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'needs_attention'
      )),
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'service_account', 'workflow', 'system')),
      actor_id UUID,
      authorization_snapshot JSONB NOT NULL CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
      inputs JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(inputs) = 'object'),
      target_query JSONB NOT NULL CHECK (jsonb_typeof(target_query) = 'object'),
      preflight_hash TEXT CHECK (preflight_hash IS NULL OR preflight_hash ~ '^[a-f0-9]{64}$'),
      idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
      request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
      occurred_at TIMESTAMPTZ NOT NULL,
      target_count INTEGER NOT NULL DEFAULT 0 CHECK (target_count >= 0),
      queued_targets INTEGER NOT NULL DEFAULT 0 CHECK (queued_targets >= 0),
      running_targets INTEGER NOT NULL DEFAULT 0 CHECK (running_targets >= 0),
      waiting_targets INTEGER NOT NULL DEFAULT 0 CHECK (waiting_targets >= 0),
      succeeded_targets INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_targets >= 0),
      failed_targets INTEGER NOT NULL DEFAULT 0 CHECK (failed_targets >= 0),
      canceled_targets INTEGER NOT NULL DEFAULT 0 CHECK (canceled_targets >= 0),
      needs_attention_targets INTEGER NOT NULL DEFAULT 0 CHECK (needs_attention_targets >= 0),
      result JSONB,
      last_error JSONB CHECK (last_error IS NULL OR jsonb_typeof(last_error) = 'object'),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (workflow_version_id, workflow_id, mailbox_id, version_identity, source_hash)
        REFERENCES mail.workflow_versions(id, workflow_id, mailbox_id, version_identity, source_hash)
        ON DELETE RESTRICT,
      CONSTRAINT workflow_runs_actor_check CHECK (
        (actor_kind = 'system' AND actor_id IS NULL)
        OR (actor_kind <> 'system' AND actor_id IS NOT NULL)
      ),
      CONSTRAINT workflow_runs_preflight_check CHECK (
        (mode = 'dryRun' AND preflight_hash IS NULL)
        OR (mode = 'execute' AND preflight_hash IS NOT NULL)
      ),
      CONSTRAINT workflow_runs_target_progress_check CHECK (
        target_count = queued_targets + running_targets + waiting_targets + succeeded_targets
          + failed_targets + canceled_targets + needs_attention_targets
      ),
      CONSTRAINT workflow_runs_mailbox_workflow_mode_idempotency_key
        UNIQUE (mailbox_id, workflow_id, mode, idempotency_key)
    )
  `;
  await db`
    CREATE INDEX workflow_runs_dispatch_idx
    ON mail.workflow_runs (state, updated_at, id)
    WHERE state IN ('queued', 'running', 'waiting')
  `;
  await db`
    CREATE INDEX workflow_runs_mailbox_history_idx
    ON mail.workflow_runs (mailbox_id, created_at DESC, id DESC)
  `;
  await db`
    CREATE INDEX workflow_runs_workflow_history_idx
    ON mail.workflow_runs (workflow_id, created_at DESC, id DESC)
  `;

  await db`
    CREATE TABLE mail.workflow_run_targets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_run_id UUID NOT NULL REFERENCES mail.workflow_runs(id) ON DELETE CASCADE,
      ordinal BIGINT NOT NULL CHECK (ordinal >= 0),
      target_key TEXT NOT NULL CHECK (char_length(target_key) BETWEEN 1 AND 500),
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN (
        'queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'needs_attention'
      )),
      execution_generation BIGINT NOT NULL DEFAULT 0 CHECK (execution_generation >= 0),
      execution_clock_at TIMESTAMPTZ,
      lease_owner TEXT,
      lease_token UUID,
      lease_expires_at TIMESTAMPTZ,
      cancel_requested_at TIMESTAMPTZ,
      cancel_reason TEXT CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 1000),
      frozen_inputs JSONB NOT NULL CHECK (jsonb_typeof(frozen_inputs) = 'object'),
      frozen_source JSONB NOT NULL,
      frozen_preconditions JSONB NOT NULL,
      result JSONB,
      last_error JSONB CHECK (last_error IS NULL OR jsonb_typeof(last_error) = 'object'),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT workflow_run_targets_lease_check CHECK (
        (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
        OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      ),
      UNIQUE (parent_run_id, ordinal),
      UNIQUE (parent_run_id, target_key)
    )
  `;
  await db`
    CREATE INDEX workflow_run_targets_dispatch_idx
    ON mail.workflow_run_targets (state, lease_expires_at, parent_run_id, ordinal)
    WHERE state IN ('queued', 'running')
  `;
  await db`
    CREATE INDEX workflow_run_targets_parent_state_idx
    ON mail.workflow_run_targets (parent_run_id, state, ordinal)
  `;

  await createCanonicalWorkflowStepRuns(db);

  for (const table of [
    "workflows",
    "workflow_activations",
    "workflow_trigger_events",
    "workflow_runs",
    "workflow_run_targets",
    "workflow_step_runs",
  ]) {
    await db.unsafe(`
      CREATE TRIGGER ${table}_touch_updated_at
      BEFORE UPDATE ON mail.${table}
      FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
    `);
  }

  await db`
    CREATE FUNCTION mail.reject_workflow_version_update()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'workflow versions are immutable' USING ERRCODE = '55000';
    END;
    $$ LANGUAGE plpgsql
  `;
  await db`
    CREATE TRIGGER workflow_versions_reject_update
    BEFORE UPDATE ON mail.workflow_versions
    FOR EACH ROW EXECUTE FUNCTION mail.reject_workflow_version_update()
  `;
};

const addDurableWorkflowMaterialization = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.workflow_runs
      ADD COLUMN materialization_cursor_internal_date TIMESTAMPTZ,
      ADD COLUMN materialization_cursor_target_key UUID,
      ADD COLUMN materialization_digest TEXT,
      ADD COLUMN materialization_expected_digest TEXT,
      ADD COLUMN materialization_action_counts JSONB,
      DROP CONSTRAINT workflow_runs_state_check,
      DROP CONSTRAINT workflow_runs_target_progress_check,
      ADD CONSTRAINT workflow_runs_state_check CHECK (state IN (
        'materializing', 'queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'needs_attention'
      )),
      ADD CONSTRAINT workflow_runs_target_progress_check CHECK (
        (state = 'materializing'
          AND queued_targets <= target_count
          AND running_targets = 0
          AND waiting_targets = 0
          AND succeeded_targets = 0
          AND failed_targets = 0
          AND canceled_targets = 0
          AND needs_attention_targets = 0)
        OR (state <> 'materializing'
          AND target_count = queued_targets + running_targets + waiting_targets + succeeded_targets
            + failed_targets + canceled_targets + needs_attention_targets)
      ),
      ADD CONSTRAINT workflow_runs_materialization_check CHECK (
        (state = 'materializing'
          AND kind = 'backfill'
          AND mode = 'execute'
          AND target_count > 0
          AND materialization_digest IS NOT NULL
          AND materialization_digest ~ '^[a-f0-9]{64}$'
          AND materialization_expected_digest IS NOT NULL
          AND materialization_expected_digest ~ '^[a-f0-9]{64}$'
          AND materialization_action_counts IS NOT NULL
          AND jsonb_typeof(materialization_action_counts) = 'object'
          AND finished_at IS NULL
          AND (
            (materialization_cursor_internal_date IS NULL AND materialization_cursor_target_key IS NULL)
            OR (materialization_cursor_internal_date IS NOT NULL AND materialization_cursor_target_key IS NOT NULL)
          ))
        OR (state <> 'materializing'
          AND materialization_cursor_internal_date IS NULL
          AND materialization_cursor_target_key IS NULL
          AND materialization_digest IS NULL
          AND materialization_expected_digest IS NULL
          AND materialization_action_counts IS NULL)
      )
  `;
};

const hardenCanonicalWorkflowAuthority = async (db: SqlClient): Promise<void> => {
  await db`UPDATE mail.workflow_runs SET channel = 'api' WHERE channel = 'cli'`;
  await db`
    ALTER TABLE mail.workflow_runs
      DROP CONSTRAINT workflow_runs_channel_check,
      DROP CONSTRAINT workflow_runs_actor_kind_check,
      ADD CONSTRAINT workflow_runs_channel_check CHECK (channel IN ('ui', 'api', 'bulk', 'agent', 'schedule', 'event')),
      ADD CONSTRAINT workflow_runs_actor_kind_check CHECK (actor_kind IN ('user', 'service_account', 'workflow', 'system'))
  `;
};

const scopeWorkflowRunIdempotency = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.workflow_runs
      DROP CONSTRAINT IF EXISTS workflow_runs_mailbox_id_mode_idempotency_key_key,
      DROP CONSTRAINT IF EXISTS workflow_runs_mailbox_workflow_mode_idempotency_key,
      ADD CONSTRAINT workflow_runs_mailbox_workflow_mode_idempotency_key
        UNIQUE (mailbox_id, workflow_id, mode, idempotency_key)
  `;
};

const pinWorkflowTriggerDeliveries = async (db: SqlClient): Promise<void> => {
  await db`DROP TABLE IF EXISTS mail.workflow_trigger_events`;
  await db`
    CREATE TABLE mail.workflow_trigger_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      activation_id UUID NOT NULL,
      workflow_id UUID NOT NULL,
      workflow_version_id UUID NOT NULL,
      trigger_key TEXT NOT NULL CHECK (char_length(trigger_key) BETWEEN 1 AND 200),
      trigger_kind TEXT NOT NULL CHECK (char_length(trigger_kind) BETWEEN 1 AND 120),
      trigger_config JSONB NOT NULL CHECK (jsonb_typeof(trigger_config) = 'object'),
      authorization_snapshot JSONB NOT NULL CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
      version_identity TEXT NOT NULL CHECK (char_length(version_identity) BETWEEN 1 AND 200),
      workflow_source_hash TEXT NOT NULL CHECK (workflow_source_hash ~ '^[a-f0-9]{64}$'),
      bound_plan JSONB NOT NULL CHECK (jsonb_typeof(bound_plan) = 'object'),
      effect_budget JSONB NOT NULL CHECK (jsonb_typeof(effect_budget) = 'object'),
      manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
      catalog_hash TEXT NOT NULL CHECK (catalog_hash ~ '^[a-f0-9]{64}$'),
      delivery_key TEXT NOT NULL CHECK (char_length(delivery_key) BETWEEN 1 AND 500),
      occurred_at TIMESTAMPTZ NOT NULL,
      trigger_values JSONB NOT NULL CHECK (jsonb_typeof(trigger_values) = 'object'),
      target_key TEXT NOT NULL CHECK (char_length(target_key) BETWEEN 1 AND 500),
      frozen_source JSONB NOT NULL CHECK (jsonb_typeof(frozen_source) = 'object'),
      frozen_preconditions JSONB NOT NULL CHECK (jsonb_typeof(frozen_preconditions) = 'object'),
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
      execution_generation BIGINT NOT NULL DEFAULT 0 CHECK (execution_generation >= 0),
      lease_owner TEXT,
      lease_token UUID,
      lease_expires_at TIMESTAMPTZ,
      result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
      last_error JSONB CHECK (last_error IS NULL OR jsonb_typeof(last_error) = 'object'),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (workflow_version_id, workflow_id, mailbox_id, version_identity, workflow_source_hash)
        REFERENCES mail.workflow_versions(id, workflow_id, mailbox_id, version_identity, source_hash)
        ON DELETE CASCADE,
      CONSTRAINT workflow_trigger_events_lease_check CHECK (
        (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
        OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      ),
      CONSTRAINT workflow_trigger_events_activation_delivery_unique
        UNIQUE (activation_id, trigger_kind, delivery_key)
    )
  `;
  await db`
    CREATE INDEX workflow_trigger_events_dispatch_idx
    ON mail.workflow_trigger_events (state, lease_expires_at, occurred_at, id)
    WHERE state IN ('queued', 'running')
  `;
  await db`
    CREATE TRIGGER workflow_trigger_events_touch_updated_at
    BEFORE UPDATE ON mail.workflow_trigger_events
    FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
  `;
};

const freezeWorkflowExecutionInputs = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.workflow_run_targets ADD COLUMN frozen_hydration JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await db`
    UPDATE mail.workflow_run_targets target
    SET execution_clock_at = run.occurred_at
    FROM mail.workflow_runs run
    WHERE run.id = target.parent_run_id
      AND target.execution_clock_at IS NULL
  `;
  await db`ALTER TABLE mail.workflow_run_targets ALTER COLUMN execution_clock_at SET NOT NULL`;
};

const fenceWorkflowProviderEffects = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.commands
      ADD COLUMN provider_effect_started_at TIMESTAMPTZ,
      ADD COLUMN provider_effect_attempt INTEGER,
      ADD CONSTRAINT commands_provider_effect_check CHECK (
        (provider_effect_started_at IS NULL AND provider_effect_attempt IS NULL)
        OR (provider_effect_started_at IS NOT NULL AND provider_effect_attempt IS NOT NULL AND provider_effect_attempt > 0)
      )
  `;
};

const addDurableDraftContinuity = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.drafts
      ADD COLUMN intent TEXT NOT NULL DEFAULT 'new'
        CHECK (intent IN ('new', 'reply', 'reply_all', 'forward')),
      ADD COLUMN source_message_id UUID REFERENCES mail.message_contents(id) ON DELETE RESTRICT,
      ADD COLUMN last_editor_kind TEXT CHECK (last_editor_kind IN ('user', 'service_account')),
      ADD COLUMN last_editor_id UUID
  `;
  await db`
    UPDATE mail.drafts draft
    SET
      intent = CASE WHEN draft.conversation_id IS NULL THEN 'new' ELSE 'reply' END,
      source_message_id = CASE
        WHEN draft.conversation_id IS NULL THEN NULL
        ELSE (
          SELECT conversation_message.message_id
          FROM mail.conversation_messages conversation_message
          JOIN mail.message_contents message ON message.id = conversation_message.message_id
          WHERE conversation_message.conversation_id = draft.conversation_id
          ORDER BY conversation_message.position DESC, message.internal_date DESC, message.id DESC
          LIMIT 1
        )
      END,
      last_editor_kind = draft.author_kind,
      last_editor_id = draft.author_id
  `;
  await db`
    UPDATE mail.drafts
    SET conversation_id = NULL, intent = 'new'
    WHERE conversation_id IS NOT NULL AND source_message_id IS NULL
  `;
  await db`
    ALTER TABLE mail.drafts
      ALTER COLUMN last_editor_kind SET NOT NULL,
      ALTER COLUMN last_editor_id SET NOT NULL,
      ADD CONSTRAINT drafts_intent_source_check CHECK (
        (intent = 'new' AND conversation_id IS NULL AND source_message_id IS NULL)
        OR (intent <> 'new' AND conversation_id IS NOT NULL AND source_message_id IS NOT NULL)
      )
  `;
  await db`
    CREATE TABLE mail.draft_recovery_copies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      draft_id UUID NOT NULL REFERENCES mail.drafts(id) ON DELETE CASCADE,
      base_revision BIGINT NOT NULL CHECK (base_revision > 0),
      content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
      content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
      creator_kind TEXT NOT NULL CHECK (creator_kind IN ('user', 'service_account')),
      creator_id UUID NOT NULL,
      restored_at TIMESTAMPTZ,
      restored_by_kind TEXT CHECK (restored_by_kind IN ('user', 'service_account')),
      restored_by_id UUID,
      resulting_revision BIGINT CHECK (resulting_revision IS NULL OR resulting_revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT draft_recovery_restore_check CHECK (
        (restored_at IS NULL AND restored_by_kind IS NULL AND restored_by_id IS NULL AND resulting_revision IS NULL)
        OR (restored_at IS NOT NULL AND restored_by_kind IS NOT NULL AND restored_by_id IS NOT NULL AND resulting_revision IS NOT NULL)
      ),
      UNIQUE (draft_id, base_revision, creator_kind, creator_id, content_hash)
    )
  `;
  await db`
    CREATE INDEX draft_recovery_copies_draft_idx
    ON mail.draft_recovery_copies (draft_id, created_at DESC, id DESC)
  `;

  await db`
    CREATE TABLE mail.draft_attachment_uploads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      draft_id UUID NOT NULL REFERENCES mail.drafts(id) ON DELETE CASCADE,
      blob_id UUID NOT NULL REFERENCES mail.message_part_blobs(id) ON DELETE CASCADE,
      filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
      content_type TEXT NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 255),
      byte_length BIGINT NOT NULL CHECK (byte_length BETWEEN 0 AND 104857600),
      received_bytes BIGINT NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= byte_length),
      next_position INTEGER NOT NULL DEFAULT 0 CHECK (next_position >= 0),
      state TEXT NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'uploaded', 'attached', 'cancelled')),
      creator_kind TEXT NOT NULL CHECK (creator_kind IN ('user', 'service_account')),
      creator_id UUID NOT NULL,
      attachment_id UUID UNIQUE REFERENCES mail.draft_attachments(id) ON DELETE SET NULL,
      finalized_revision BIGINT CHECK (finalized_revision IS NULL OR finalized_revision > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT draft_attachment_upload_state_check CHECK (
        (state = 'attached' AND attachment_id IS NOT NULL AND finalized_revision IS NOT NULL)
        OR (state <> 'attached' AND attachment_id IS NULL AND finalized_revision IS NULL)
      )
    )
  `;
  await db`
    CREATE INDEX draft_attachment_uploads_active_idx
    ON mail.draft_attachment_uploads (updated_at, id)
    WHERE state IN ('uploading', 'uploaded')
  `;
  await db`
    CREATE TRIGGER draft_attachment_uploads_touch_updated_at
    BEFORE UPDATE ON mail.draft_attachment_uploads
    FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
  `;
};

const hardenDurableDraftContinuity = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.draft_attachment_uploads
      DROP CONSTRAINT draft_attachment_uploads_blob_id_fkey,
      ALTER COLUMN blob_id DROP NOT NULL,
      ADD CONSTRAINT draft_attachment_uploads_blob_id_fkey
        FOREIGN KEY (blob_id) REFERENCES mail.message_part_blobs(id) ON DELETE SET NULL,
      ADD CONSTRAINT draft_attachment_uploads_blob_state_check CHECK (
        (state = 'cancelled' AND blob_id IS NULL)
        OR (state <> 'cancelled' AND blob_id IS NOT NULL)
      ),
      ADD CONSTRAINT draft_attachment_uploads_received_state_check CHECK (
        state IN ('uploading', 'cancelled')
        OR received_bytes = byte_length
      )
  `;
  await db`
    CREATE INDEX drafts_source_message_idx
    ON mail.drafts (source_message_id)
    WHERE source_message_id IS NOT NULL
  `;
  await db`
    CREATE INDEX draft_recovery_copies_unresolved_idx
    ON mail.draft_recovery_copies (draft_id, created_at DESC, id DESC)
    WHERE restored_at IS NULL
  `;
  await db`
    CREATE INDEX draft_attachment_uploads_draft_idx
    ON mail.draft_attachment_uploads (draft_id, created_at, id)
  `;
};

const hardCutMailboxOwnedConnections = async (db: SqlClient): Promise<void> => {
  await db`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'mail' AND table_name = 'mailboxes' AND column_name = 'connection_policy'
      ) THEN
        IF EXISTS (SELECT 1 FROM mail.mailboxes WHERE connection_policy <> 'shared_connection') THEN
          RAISE EXCEPTION 'Mail personal provider accounts must be removed before applying the mailbox-owned connection cut';
        END IF;
        ALTER TABLE mail.mailboxes DROP COLUMN connection_policy;
      END IF;
    END
    $$
  `;

  await db`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'mail' AND table_name = 'provider_connections' AND column_name = 'owner_user_id'
      ) THEN
        IF EXISTS (SELECT 1 FROM mail.provider_connections WHERE owner_mailbox_id IS NULL) THEN
          RAISE EXCEPTION 'Mail user-owned provider connections must be removed before applying the mailbox-owned connection cut';
        END IF;
        DROP INDEX IF EXISTS mail.provider_connections_user_name_idx;
        DROP INDEX IF EXISTS mail.provider_connections_service_account_name_idx;
        ALTER TABLE mail.provider_connections
          DROP CONSTRAINT IF EXISTS provider_connections_one_owner,
          DROP COLUMN owner_user_id,
          DROP COLUMN owner_service_account_id,
          ALTER COLUMN owner_mailbox_id SET NOT NULL;
      END IF;
    END
    $$
  `;

  await db`DROP INDEX IF EXISTS mail.provider_connections_mailbox_name_idx`;
  await db`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT owner_mailbox_id
        FROM mail.provider_connections
        WHERE status <> 'revoked'
        GROUP BY owner_mailbox_id
        HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'Mail mailboxes with multiple active provider connections must be resolved before applying the hard cut';
      END IF;
    END
    $$
  `;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS provider_connections_mailbox_active_idx
    ON mail.provider_connections (owner_mailbox_id)
    WHERE status <> 'revoked'
  `;

  await db`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT remote_resource_id
        FROM mail.provider_bindings
        WHERE state <> 'revoked'
        GROUP BY remote_resource_id
        HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'Mail remote resources with multiple provider bindings must be resolved before applying the hard cut';
      END IF;
    END
    $$
  `;
  await db`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT connection_id
        FROM mail.provider_bindings
        WHERE state <> 'revoked'
        GROUP BY connection_id
        HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION 'Mail connections with multiple current provider bindings must be resolved before applying the hard cut';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM mail.provider_bindings binding
        JOIN mail.remote_resources resource ON resource.id = binding.remote_resource_id
        JOIN mail.provider_connections connection ON connection.id = binding.connection_id
        WHERE binding.state <> 'revoked'
          AND connection.owner_mailbox_id <> resource.mailbox_id
      ) THEN
        RAISE EXCEPTION 'Mail provider bindings must connect resources and credentials owned by the same mailbox';
      END IF;
    END
    $$
  `;
  await db`ALTER TABLE mail.provider_bindings DROP CONSTRAINT IF EXISTS provider_bindings_remote_resource_id_connection_id_key`;
  await db`DROP INDEX IF EXISTS mail.provider_bindings_resource_unique_idx`;
  await db`DROP INDEX IF EXISTS mail.provider_bindings_connection_unique_idx`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS provider_bindings_resource_current_idx
    ON mail.provider_bindings (remote_resource_id)
    WHERE state <> 'revoked'
  `;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS provider_bindings_connection_current_idx
    ON mail.provider_bindings (connection_id)
    WHERE state <> 'revoked'
  `;
  await enforceMailboxOwnedProviderBindings(db);

  await db`UPDATE mail.sender_identities SET automation_policy = 'disabled' WHERE automation_policy = 'pool'`;
  await db`ALTER TABLE mail.sender_identities DROP COLUMN IF EXISTS interactive_policy`;
  await db`ALTER TABLE mail.sender_identities DROP CONSTRAINT IF EXISTS sender_identities_automation_policy_check`;
  await db`
    ALTER TABLE mail.sender_identities
    ADD CONSTRAINT sender_identities_automation_policy_check CHECK (automation_policy IN ('disabled', 'mailbox'))
  `;
};

const installSearchReferenceCompatibility = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE OR REPLACE FUNCTION mail.search_reference_matches(
      searched_message_id UUID,
      searched_query TEXT,
      searched_match TEXT
    ) RETURNS BOOLEAN
    LANGUAGE plpgsql
    STABLE
    AS $$
    DECLARE
      matched BOOLEAN;
    BEGIN
      IF to_regclass('mail.conversation_references') IS NULL THEN
        RETURN false;
      END IF;
      EXECUTE $query$
        SELECT EXISTS (
          SELECT 1
          FROM mail.conversation_messages link
          JOIN mail.conversation_references reference_row
            ON reference_row.conversation_id = link.conversation_id
          WHERE link.message_id = $1
            AND CASE
              WHEN $3 = 'exact' THEN lower(btrim(COALESCE(to_jsonb(reference_row)->>'value', ''))) = lower(btrim($2))
              WHEN $3 = 'words' THEN NOT EXISTS (
                SELECT 1
                FROM regexp_split_to_table(lower(btrim($2)), '\\s+') token
                WHERE strpos(lower(COALESCE(to_jsonb(reference_row)->>'value', '')), token) = 0
              )
              ELSE strpos(lower(COALESCE(to_jsonb(reference_row)->>'value', '')), lower($2)) > 0
            END
        )
      $query$ INTO matched USING searched_message_id, searched_query, searched_match;
      RETURN matched;
    END;
    $$
  `;
};

const addStructuredSearchAndLocalTags = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.conversations
    ADD CONSTRAINT conversations_id_mailbox_unique UNIQUE (id, mailbox_id)
  `;
  await db`
    CREATE TABLE mail.local_tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
      normalized_name TEXT NOT NULL CHECK (
        normalized_name = lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))
        AND char_length(normalized_name) BETWEEN 1 AND 80
      ),
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_by_actor_kind TEXT NOT NULL CHECK (created_by_actor_kind IN ('user', 'service_account')),
      created_by_actor_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (mailbox_id, normalized_name),
      UNIQUE (id, mailbox_id)
    )
  `;
  await db`CREATE INDEX local_tags_mailbox_name_idx ON mail.local_tags (mailbox_id, normalized_name, id)`;
  await db`
    CREATE TRIGGER local_tags_touch_updated_at
    BEFORE UPDATE ON mail.local_tags
    FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
  `;
  await db`
    CREATE TABLE mail.conversation_local_tags (
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL,
      tag_id UUID NOT NULL,
      assigned_by_actor_kind TEXT NOT NULL CHECK (assigned_by_actor_kind IN ('user', 'service_account')),
      assigned_by_actor_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, tag_id),
      FOREIGN KEY (conversation_id, mailbox_id)
        REFERENCES mail.conversations(id, mailbox_id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id, mailbox_id)
        REFERENCES mail.local_tags(id, mailbox_id) ON DELETE CASCADE
    )
  `;
  await db`CREATE INDEX conversation_local_tags_tag_idx ON mail.conversation_local_tags (mailbox_id, tag_id, conversation_id)`;

  await installSearchReferenceCompatibility(db);
};

const addConversationReferencesAndResponsePolicies = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE mail.reference_schemes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
      normalized_name TEXT NOT NULL CHECK (
        normalized_name = lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))
        AND char_length(normalized_name) BETWEEN 1 AND 80
      ),
      pattern TEXT NOT NULL CHECK (pattern = btrim(pattern) AND char_length(pattern) BETWEEN 1 AND 120),
      next_sequence BIGINT NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
      enabled BOOLEAN NOT NULL DEFAULT true,
      is_default BOOLEAN NOT NULL DEFAULT false,
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_by_actor_kind TEXT NOT NULL CHECK (created_by_actor_kind IN ('user', 'service_account')),
      created_by_actor_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (mailbox_id, normalized_name),
      UNIQUE (id, mailbox_id)
    )
  `;
  await db`
    CREATE UNIQUE INDEX reference_schemes_default_idx
    ON mail.reference_schemes (mailbox_id)
    WHERE enabled AND is_default
  `;
  await db`CREATE INDEX reference_schemes_mailbox_idx ON mail.reference_schemes (mailbox_id, enabled DESC, normalized_name, id)`;
  await db`
    CREATE TRIGGER reference_schemes_touch_updated_at
    BEFORE UPDATE ON mail.reference_schemes
    FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
  `;

  await db`
    CREATE TABLE mail.conversation_references (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL,
      origin_conversation_id UUID NOT NULL,
      scheme_id UUID NOT NULL,
      scheme_revision BIGINT NOT NULL CHECK (scheme_revision > 0),
      value TEXT NOT NULL CHECK (value = btrim(value) AND char_length(value) BETWEEN 1 AND 160),
      normalized_value TEXT NOT NULL CHECK (normalized_value = lower(value)),
      sequence BIGINT NOT NULL CHECK (sequence > 0),
      role TEXT NOT NULL CHECK (role IN ('primary', 'alias')),
      allocated_by_actor_kind TEXT NOT NULL CHECK (allocated_by_actor_kind IN ('user', 'service_account', 'workflow')),
      allocated_by_actor_id UUID NOT NULL,
      idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
      allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (conversation_id, mailbox_id)
        REFERENCES mail.conversations(id, mailbox_id) ON DELETE CASCADE,
      FOREIGN KEY (scheme_id, mailbox_id)
        REFERENCES mail.reference_schemes(id, mailbox_id) ON DELETE RESTRICT,
      UNIQUE (mailbox_id, normalized_value),
      UNIQUE (scheme_id, sequence)
    )
  `;
  await db`
    CREATE UNIQUE INDEX conversation_references_primary_idx
    ON mail.conversation_references (conversation_id)
    WHERE role = 'primary'
  `;
  await db`CREATE INDEX conversation_references_lookup_idx ON mail.conversation_references (mailbox_id, normalized_value, conversation_id)`;
  await db`
    CREATE UNIQUE INDEX conversation_references_mailbox_idempotency_idx
    ON mail.conversation_references (mailbox_id, idempotency_key)
  `;
  await db`CREATE INDEX conversation_references_conversation_idx ON mail.conversation_references (conversation_id, role, allocated_at, id)`;
  await db`
    CREATE OR REPLACE FUNCTION mail.protect_conversation_reference_allocation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.mailbox_id <> OLD.mailbox_id
        OR NEW.origin_conversation_id <> OLD.origin_conversation_id
        OR NEW.scheme_id <> OLD.scheme_id
        OR NEW.scheme_revision <> OLD.scheme_revision
        OR NEW.value <> OLD.value
        OR NEW.normalized_value <> OLD.normalized_value
        OR NEW.sequence <> OLD.sequence
        OR NEW.allocated_by_actor_kind <> OLD.allocated_by_actor_kind
        OR NEW.allocated_by_actor_id <> OLD.allocated_by_actor_id
        OR NEW.idempotency_key <> OLD.idempotency_key
        OR NEW.allocated_at <> OLD.allocated_at
      THEN
        RAISE EXCEPTION 'Conversation reference allocation fields are immutable'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $$
  `;
  await db`
    CREATE TRIGGER conversation_references_protect_allocation
    BEFORE UPDATE ON mail.conversation_references
    FOR EACH ROW EXECUTE FUNCTION mail.protect_conversation_reference_allocation()
  `;

  await db`
    CREATE TABLE mail.response_schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
      normalized_name TEXT NOT NULL CHECK (
        normalized_name = lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))
        AND char_length(normalized_name) BETWEEN 1 AND 80
      ),
      definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
      enabled BOOLEAN NOT NULL DEFAULT true,
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_by_actor_kind TEXT NOT NULL CHECK (created_by_actor_kind IN ('user', 'service_account')),
      created_by_actor_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (mailbox_id, normalized_name),
      UNIQUE (id, mailbox_id)
    )
  `;
  await db`CREATE INDEX response_schedules_mailbox_idx ON mail.response_schedules (mailbox_id, enabled DESC, normalized_name, id)`;
  await db`
    CREATE TRIGGER response_schedules_touch_updated_at
    BEFORE UPDATE ON mail.response_schedules
    FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
  `;

  await db`
    CREATE TABLE mail.automatic_reply_effects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      workflow_version_id UUID NOT NULL REFERENCES mail.workflow_versions(id) ON DELETE RESTRICT,
      workflow_target_id UUID NOT NULL REFERENCES mail.workflow_run_targets(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL CHECK (char_length(step_key) BETWEEN 1 AND 500),
      message_id UUID NOT NULL REFERENCES mail.message_contents(id) ON DELETE RESTRICT,
      conversation_id UUID NOT NULL REFERENCES mail.conversations(id) ON DELETE RESTRICT,
      sender_identity_id UUID NOT NULL REFERENCES mail.sender_identities(id) ON DELETE RESTRICT,
      response_schedule_id UUID REFERENCES mail.response_schedules(id) ON DELETE RESTRICT,
      recipient TEXT NOT NULL CHECK (char_length(recipient) BETWEEN 3 AND 320),
      state TEXT NOT NULL CHECK (state IN ('suppressed', 'queued', 'confirmed', 'failed', 'needs_attention')),
      suppression_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      command_id UUID REFERENCES mail.commands(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (workflow_version_id, workflow_target_id, step_key)
    )
  `;
  await db`
    CREATE INDEX automatic_reply_rate_idx
    ON mail.automatic_reply_effects (mailbox_id, recipient, created_at DESC)
    WHERE state IN ('queued', 'confirmed', 'needs_attention')
  `;
  await db`
    CREATE TRIGGER automatic_reply_effects_touch_updated_at
    BEFORE UPDATE ON mail.automatic_reply_effects
    FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
  `;
};

const hardenConversationReferencesAndResponsePolicies = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.conversations DROP COLUMN IF EXISTS primary_reference`;
  await db`
    ALTER TABLE mail.conversation_references
    DROP CONSTRAINT IF EXISTS conversation_references_conversation_id_scheme_id_key
  `;
  await db`ALTER TABLE mail.conversation_references ADD COLUMN IF NOT EXISTS origin_conversation_id UUID`;
  await db`ALTER TABLE mail.conversation_references ADD COLUMN IF NOT EXISTS scheme_revision BIGINT`;
  await db`ALTER TABLE mail.conversation_references ADD COLUMN IF NOT EXISTS idempotency_key TEXT`;
  await db`
    UPDATE mail.conversation_references reference
    SET
      origin_conversation_id = COALESCE(reference.origin_conversation_id, reference.conversation_id),
      scheme_revision = COALESCE(reference.scheme_revision, scheme.revision),
      idempotency_key = COALESCE(reference.idempotency_key, 'migration:' || reference.id::text)
    FROM mail.reference_schemes scheme
    WHERE scheme.id = reference.scheme_id
      AND (
        reference.origin_conversation_id IS NULL
        OR reference.scheme_revision IS NULL
        OR reference.idempotency_key IS NULL
      )
  `;
  await db`ALTER TABLE mail.conversation_references ALTER COLUMN origin_conversation_id SET NOT NULL`;
  await db`ALTER TABLE mail.conversation_references ALTER COLUMN scheme_revision SET NOT NULL`;
  await db`ALTER TABLE mail.conversation_references ALTER COLUMN idempotency_key SET NOT NULL`;
  await db`ALTER TABLE mail.conversation_references DROP CONSTRAINT IF EXISTS conversation_references_scheme_revision_check`;
  await db`
    ALTER TABLE mail.conversation_references
    ADD CONSTRAINT conversation_references_scheme_revision_check CHECK (scheme_revision > 0)
  `;
  await db`ALTER TABLE mail.conversation_references DROP CONSTRAINT IF EXISTS conversation_references_idempotency_key_check`;
  await db`
    ALTER TABLE mail.conversation_references
    ADD CONSTRAINT conversation_references_idempotency_key_check CHECK (char_length(idempotency_key) BETWEEN 1 AND 200)
  `;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS conversation_references_mailbox_idempotency_idx
    ON mail.conversation_references (mailbox_id, idempotency_key)
  `;
  await db`
    CREATE OR REPLACE FUNCTION mail.protect_conversation_reference_allocation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.mailbox_id <> OLD.mailbox_id
        OR NEW.origin_conversation_id <> OLD.origin_conversation_id
        OR NEW.scheme_id <> OLD.scheme_id
        OR NEW.scheme_revision <> OLD.scheme_revision
        OR NEW.value <> OLD.value
        OR NEW.normalized_value <> OLD.normalized_value
        OR NEW.sequence <> OLD.sequence
        OR NEW.allocated_by_actor_kind <> OLD.allocated_by_actor_kind
        OR NEW.allocated_by_actor_id <> OLD.allocated_by_actor_id
        OR NEW.idempotency_key <> OLD.idempotency_key
        OR NEW.allocated_at <> OLD.allocated_at
      THEN
        RAISE EXCEPTION 'Conversation reference allocation fields are immutable'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END
    $$
  `;
  await db`DROP TRIGGER IF EXISTS conversation_references_protect_allocation ON mail.conversation_references`;
  await db`
    CREATE TRIGGER conversation_references_protect_allocation
    BEFORE UPDATE ON mail.conversation_references
    FOR EACH ROW EXECUTE FUNCTION mail.protect_conversation_reference_allocation()
  `;
};

const finalizeConversationReferenceMergeSemantics = async (db: SqlClient): Promise<void> => {
  await db`
    ALTER TABLE mail.conversation_references
    DROP CONSTRAINT IF EXISTS conversation_references_conversation_id_scheme_id_key
  `;
};

const hardenAutomaticReplyExecution = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.drafts ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'`;
  await db`ALTER TABLE mail.drafts DROP CONSTRAINT drafts_author_kind_check`;
  await db`ALTER TABLE mail.drafts DROP CONSTRAINT drafts_last_editor_kind_check`;
  await db`ALTER TABLE mail.drafts ADD CONSTRAINT drafts_author_kind_check CHECK (author_kind IN ('user', 'service_account', 'workflow'))`;
  await db`
    ALTER TABLE mail.drafts
    ADD CONSTRAINT drafts_last_editor_kind_check CHECK (last_editor_kind IN ('user', 'service_account', 'workflow'))
  `;
  await db`
    ALTER TABLE mail.drafts
    ADD CONSTRAINT drafts_origin_check CHECK (
      (origin = 'user' AND author_kind IN ('user', 'service_account') AND last_editor_kind IN ('user', 'service_account'))
      OR (origin = 'workflow' AND author_kind = 'workflow' AND last_editor_kind = 'workflow')
    )
  `;
  await db`CREATE INDEX drafts_origin_state_idx ON mail.drafts (mailbox_id, origin, state, updated_at DESC)`;

  await db`ALTER TABLE mail.automatic_reply_effects ADD COLUMN draft_id UUID REFERENCES mail.drafts(id) ON DELETE RESTRICT`;
  await db`ALTER TABLE mail.automatic_reply_effects ADD COLUMN request_hash TEXT`;
  await db`ALTER TABLE mail.automatic_reply_effects ADD COLUMN response_schedule_revision BIGINT`;
  await db`ALTER TABLE mail.automatic_reply_effects ADD COLUMN protocol_facts JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await db`ALTER TABLE mail.automatic_reply_effects ADD COLUMN scheduled_at TIMESTAMPTZ`;
  await db`
    ALTER TABLE mail.automatic_reply_effects
    ADD CONSTRAINT automatic_reply_effects_request_hash_check CHECK (request_hash IS NULL OR request_hash ~ '^[a-f0-9]{64}$')
  `;
  await db`
    ALTER TABLE mail.automatic_reply_effects
    ADD CONSTRAINT automatic_reply_effects_schedule_revision_check
    CHECK (response_schedule_revision IS NULL OR response_schedule_revision > 0)
  `;
  await db`
    ALTER TABLE mail.automatic_reply_effects
    ADD CONSTRAINT automatic_reply_effects_protocol_facts_check CHECK (jsonb_typeof(protocol_facts) = 'object')
  `;
  await db`
    CREATE UNIQUE INDEX automatic_reply_effects_command_idx
    ON mail.automatic_reply_effects (command_id)
    WHERE command_id IS NOT NULL
  `;
};

const repairResponsePolicyExecution = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.automatic_reply_effects ALTER COLUMN recipient DROP NOT NULL`;
  await db`ALTER TABLE mail.automatic_reply_effects DROP CONSTRAINT IF EXISTS automatic_reply_effects_recipient_check`;
  await db`
    ALTER TABLE mail.automatic_reply_effects
    ADD CONSTRAINT automatic_reply_effects_recipient_check CHECK (recipient IS NULL OR char_length(recipient) BETWEEN 3 AND 320)
  `;
  await db`ALTER TABLE mail.automatic_reply_effects DROP CONSTRAINT IF EXISTS automatic_reply_effects_state_check`;
  await db`
    ALTER TABLE mail.automatic_reply_effects
    ADD CONSTRAINT automatic_reply_effects_state_check
    CHECK (state IN ('suppressed', 'queued', 'confirmed', 'failed', 'cancelled', 'needs_attention'))
  `;
};

const addConversationReferenceRequestLedger = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE UNIQUE INDEX conversation_references_id_mailbox_idx
    ON mail.conversation_references (id, mailbox_id)
  `;
  await db`
    CREATE TABLE mail.conversation_reference_requests (
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
      origin_conversation_id UUID NOT NULL,
      scheme_id UUID NOT NULL REFERENCES mail.reference_schemes(id) ON DELETE RESTRICT,
      reference_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (mailbox_id, idempotency_key),
      FOREIGN KEY (reference_id, mailbox_id)
        REFERENCES mail.conversation_references(id, mailbox_id) ON DELETE RESTRICT
    )
  `;
  await db`
    INSERT INTO mail.conversation_reference_requests (
      mailbox_id, idempotency_key, origin_conversation_id, scheme_id, reference_id, created_at
    )
    SELECT
      reference.mailbox_id,
      reference.idempotency_key,
      reference.origin_conversation_id,
      reference.scheme_id,
      reference.id,
      reference.allocated_at
    FROM mail.conversation_references reference
  `;
};

const addComposeTemplatesAndStyles = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE mail.compose_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('signature', 'snippet')),
      scope TEXT NOT NULL CHECK (scope IN ('private', 'mailbox')),
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
      normalized_name TEXT NOT NULL CHECK (char_length(normalized_name) BETWEEN 1 AND 120),
      shortcut TEXT NOT NULL CHECK (shortcut ~ '^[a-z][a-z0-9_]{0,39}$'),
      body_template TEXT NOT NULL CHECK (char_length(body_template) BETWEEN 1 AND 200000),
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_by_actor_kind TEXT NOT NULL CHECK (created_by_actor_kind IN ('user', 'service_account')),
      created_by_actor_id UUID NOT NULL,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT compose_templates_scope_owner_check CHECK (
        (scope = 'private' AND owner_user_id IS NOT NULL)
        OR (scope = 'mailbox' AND owner_user_id IS NULL)
      )
    )
  `;
  await db`
    CREATE UNIQUE INDEX compose_templates_mailbox_shortcut_idx
    ON mail.compose_templates (mailbox_id, shortcut)
    WHERE scope = 'mailbox' AND archived_at IS NULL
  `;
  await db`
    CREATE UNIQUE INDEX compose_templates_private_shortcut_idx
    ON mail.compose_templates (mailbox_id, owner_user_id, shortcut)
    WHERE scope = 'private' AND archived_at IS NULL
  `;
  await db`
    CREATE INDEX compose_templates_visible_idx
    ON mail.compose_templates (mailbox_id, kind, scope, normalized_name, id)
    WHERE archived_at IS NULL
  `;
  await db`
    CREATE UNIQUE INDEX compose_templates_mailbox_id_idx
    ON mail.compose_templates (mailbox_id, id)
  `;
  await db`
    CREATE UNIQUE INDEX sender_identities_mailbox_id_idx
    ON mail.sender_identities (mailbox_id, id)
  `;

  await db`
    CREATE TABLE mail.compose_signature_defaults (
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      sender_identity_id UUID NOT NULL,
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      template_id UUID NOT NULL,
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT compose_signature_defaults_sender_fk
        FOREIGN KEY (mailbox_id, sender_identity_id)
        REFERENCES mail.sender_identities (mailbox_id, id) ON DELETE CASCADE,
      CONSTRAINT compose_signature_defaults_template_fk
        FOREIGN KEY (mailbox_id, template_id)
        REFERENCES mail.compose_templates (mailbox_id, id) ON DELETE CASCADE
    )
  `;
  await db`
    CREATE UNIQUE INDEX compose_signature_defaults_mailbox_idx
    ON mail.compose_signature_defaults (mailbox_id, sender_identity_id)
    WHERE user_id IS NULL
  `;
  await db`
    CREATE UNIQUE INDEX compose_signature_defaults_user_idx
    ON mail.compose_signature_defaults (mailbox_id, sender_identity_id, user_id)
    WHERE user_id IS NOT NULL
  `;
  await db`
    CREATE INDEX compose_signature_defaults_template_idx
    ON mail.compose_signature_defaults (template_id)
  `;

  await db`
    CREATE TABLE mail.compose_styles (
      mailbox_id UUID PRIMARY KEY REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      custom_css TEXT NOT NULL DEFAULT '' CHECK (char_length(custom_css) <= 100000),
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      updated_by_actor_kind TEXT CHECK (updated_by_actor_kind IS NULL OR updated_by_actor_kind IN ('user', 'service_account')),
      updated_by_actor_id UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT compose_styles_actor_check CHECK (
        (updated_by_actor_kind IS NULL AND updated_by_actor_id IS NULL)
        OR (updated_by_actor_kind IS NOT NULL AND updated_by_actor_id IS NOT NULL)
      )
    )
  `;
  await db`
    INSERT INTO mail.compose_styles (mailbox_id)
    SELECT id FROM mail.mailboxes
    ON CONFLICT (mailbox_id) DO NOTHING
  `;
};

const hardenComposeTemplateReferences = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS compose_templates_mailbox_id_idx
    ON mail.compose_templates (mailbox_id, id)
  `;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS sender_identities_mailbox_id_idx
    ON mail.sender_identities (mailbox_id, id)
  `;
  await db`
    ALTER TABLE mail.compose_signature_defaults
      DROP CONSTRAINT IF EXISTS compose_signature_defaults_sender_identity_id_fkey,
      DROP CONSTRAINT IF EXISTS compose_signature_defaults_template_id_fkey,
      DROP CONSTRAINT IF EXISTS compose_signature_defaults_sender_fk,
      DROP CONSTRAINT IF EXISTS compose_signature_defaults_template_fk,
      ADD CONSTRAINT compose_signature_defaults_sender_fk
        FOREIGN KEY (mailbox_id, sender_identity_id)
        REFERENCES mail.sender_identities (mailbox_id, id) ON DELETE CASCADE,
      ADD CONSTRAINT compose_signature_defaults_template_fk
        FOREIGN KEY (mailbox_id, template_id)
        REFERENCES mail.compose_templates (mailbox_id, id) ON DELETE CASCADE
  `;
};

const addStableScheduledSendOrdering = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.outbox_submissions ADD COLUMN requested_at TIMESTAMPTZ`;
  await db`UPDATE mail.outbox_submissions SET requested_at = scheduled_at`;
  await db`ALTER TABLE mail.outbox_submissions ALTER COLUMN requested_at SET NOT NULL`;
  await db`
    CREATE INDEX outbox_scheduled_view_idx
    ON mail.outbox_submissions (mailbox_id, requested_at, id)
    WHERE state IN ('scheduled', 'undo_window')
  `;
};

const guardStableScheduledSendOrdering = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE OR REPLACE FUNCTION mail.guard_outbox_requested_at()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        NEW.requested_at := COALESCE(NEW.requested_at, NEW.scheduled_at);
      ELSIF NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
        RAISE EXCEPTION 'outbox requested_at is immutable' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$
  `;
  await db`DROP TRIGGER IF EXISTS outbox_requested_at_guard ON mail.outbox_submissions`;
  await db`
    CREATE TRIGGER outbox_requested_at_guard
    BEFORE INSERT OR UPDATE OF requested_at ON mail.outbox_submissions
    FOR EACH ROW EXECUTE FUNCTION mail.guard_outbox_requested_at()
  `;
};

const normalizeProviderBindingAccountEvidence = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE OR REPLACE FUNCTION mail.normalize_provider_binding_account_evidence()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      locator_account_id TEXT;
      evidence_account_id TEXT;
    BEGIN
      locator_account_id := NULLIF(NEW.remote_locator ->> 'accountId', '');
      IF locator_account_id IS NULL THEN
        RETURN NEW;
      END IF;

      evidence_account_id := NULLIF(NEW.verification_evidence ->> 'accountId', '');
      IF evidence_account_id IS NULL THEN
        NEW.verification_evidence := jsonb_set(
          COALESCE(NEW.verification_evidence, '{}'::jsonb),
          '{accountId}',
          to_jsonb(locator_account_id),
          true
        );
      ELSIF evidence_account_id <> locator_account_id THEN
        RAISE EXCEPTION 'provider binding account evidence does not match its remote locator'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$
  `;
  await db`DROP TRIGGER IF EXISTS provider_bindings_account_evidence_guard ON mail.provider_bindings`;
  await db`
    CREATE TRIGGER provider_bindings_account_evidence_guard
    BEFORE INSERT OR UPDATE OF remote_locator, verification_evidence ON mail.provider_bindings
    FOR EACH ROW EXECUTE FUNCTION mail.normalize_provider_binding_account_evidence()
  `;
  await db`
    UPDATE mail.provider_bindings
    SET verification_evidence = verification_evidence
    WHERE NULLIF(remote_locator ->> 'accountId', '') IS NOT NULL
      AND NULLIF(verification_evidence ->> 'accountId', '') IS NULL
  `;
  await db`
    ALTER TABLE mail.provider_bindings
    ADD CONSTRAINT provider_bindings_account_evidence_matches
    CHECK (
      NULLIF(remote_locator ->> 'accountId', '') IS NULL
      OR verification_evidence ->> 'accountId' = remote_locator ->> 'accountId'
    )
  `;
};

const addManagedAutomaticReplyConfigurations = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE UNIQUE INDEX sender_identities_id_mailbox_idx
    ON mail.sender_identities (id, mailbox_id)
  `;
  await db`
    CREATE TABLE mail.automatic_reply_configurations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mailbox_id UUID NOT NULL REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
      workflow_id UUID NOT NULL,
      response_schedule_id UUID NOT NULL,
      sender_identity_id UUID NOT NULL,
      name TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
      normalized_name TEXT NOT NULL CHECK (
        normalized_name = lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))
        AND char_length(normalized_name) BETWEEN 1 AND 80
      ),
      subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 998),
      body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2097152),
      format TEXT NOT NULL CHECK (format IN ('plain', 'markdown')),
      minimum_interval_hours INTEGER NOT NULL CHECK (minimum_interval_hours BETWEEN 0 AND 8760),
      inactive_behavior TEXT NOT NULL CHECK (inactive_behavior IN ('skip', 'defer')),
      enabled BOOLEAN NOT NULL DEFAULT true,
      revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_by_actor_kind TEXT NOT NULL CHECK (created_by_actor_kind IN ('user', 'service_account')),
      created_by_actor_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (workflow_id, mailbox_id)
        REFERENCES mail.workflows(id, mailbox_id) ON DELETE RESTRICT,
      FOREIGN KEY (response_schedule_id, mailbox_id)
        REFERENCES mail.response_schedules(id, mailbox_id) ON DELETE RESTRICT,
      FOREIGN KEY (sender_identity_id, mailbox_id)
        REFERENCES mail.sender_identities(id, mailbox_id) ON DELETE RESTRICT,
      UNIQUE (mailbox_id, normalized_name),
      UNIQUE (workflow_id),
      UNIQUE (response_schedule_id)
    )
  `;
  await db`
    CREATE INDEX automatic_reply_configurations_mailbox_idx
    ON mail.automatic_reply_configurations (mailbox_id, enabled DESC, normalized_name, id)
  `;
  await db`
    CREATE TRIGGER automatic_reply_configurations_touch_updated_at
    BEFORE UPDATE ON mail.automatic_reply_configurations
    FOR EACH ROW EXECUTE FUNCTION mail.touch_updated_at()
  `;
};

const hardenManagedAutomaticReplyConfigurations = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE UNIQUE INDEX automatic_reply_configurations_one_active_idx
    ON mail.automatic_reply_configurations (mailbox_id)
    WHERE enabled
  `;
  await db`DROP INDEX mail.automatic_reply_rate_idx`;
  await db`
    CREATE INDEX automatic_reply_rate_idx
    ON mail.automatic_reply_effects (mailbox_id, recipient, state, updated_at DESC)
    WHERE state IN ('queued', 'confirmed', 'needs_attention')
  `;
};

const addAutomaticReplyDeliveryTimestamps = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.automatic_reply_effects ADD COLUMN confirmed_at TIMESTAMPTZ`;
  await db`
    UPDATE mail.automatic_reply_effects
    SET confirmed_at = updated_at
    WHERE state = 'confirmed'
  `;
  await db`DROP INDEX mail.automatic_reply_rate_idx`;
  await db`
    CREATE INDEX automatic_reply_rate_idx
    ON mail.automatic_reply_effects (mailbox_id, recipient, state, confirmed_at DESC)
    WHERE state IN ('queued', 'confirmed', 'needs_attention')
  `;
};

const guardAutomaticReplyDeliveryTimestamps = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.automatic_reply_effects DROP CONSTRAINT IF EXISTS automatic_reply_effects_confirmed_at_check`;
  await db`
    ALTER TABLE mail.automatic_reply_effects
    ADD CONSTRAINT automatic_reply_effects_confirmed_at_check
    CHECK (state <> 'confirmed' OR confirmed_at IS NOT NULL)
  `;
};

const defaultSenderAutomationToMailbox = async (db: SqlClient): Promise<void> => {
  await db`ALTER TABLE mail.sender_identities ALTER COLUMN automation_policy SET DEFAULT 'mailbox'`;
};

const migrations = [
  { version: 1, name: "initial_mail_schema", run: createInitialSchema },
  { version: 2, name: "message_hydration_claims", run: addHydrationClaims },
  { version: 3, name: "message_threading_projection", run: addThreadingProjection },
  { version: 4, name: "field_search_documents", run: addFieldSearchDocuments },
  { version: 5, name: "optional_bm25_index", run: addOptionalBm25Index },
  { version: 6, name: "durable_draft_snapshots", run: addDurableDraftSnapshots },
  { version: 7, name: "durable_command_execution", run: addDurableCommandExecution },
  { version: 8, name: "bounded_hydration_retries", run: addBoundedHydrationRetries },
  { version: 9, name: "chunked_body_search", run: addChunkedBodySearch },
  { version: 10, name: "search_backend_modes", run: addSearchBackendModes },
  { version: 11, name: "credential_revision_bindings", run: addCredentialRevisionBindings },
  { version: 12, name: "command_worker_heartbeats", run: addCommandWorkerHeartbeats },
  { version: 13, name: "lifecycle_control_plane", run: addLifecycleControlPlane },
  { version: 14, name: "provider_backed_operations", run: addProviderBackedOperations },
  { version: 15, name: "provider_backed_operations_hardening", run: hardenProviderBackedOperations },
  { version: 16, name: "conversation_collaboration", run: addConversationCollaboration },
  { version: 17, name: "workflow_foundation", run: addWorkflowFoundation },
  { version: 18, name: "workflow_runtime_fencing", run: addWorkflowRuntimeFencing },
  { version: 19, name: "workflow_foundation_hardening", run: hardenWorkflowFoundation },
  { version: 20, name: "workflow_remote_preconditions", run: addWorkflowRemotePreconditions },
  { version: 21, name: "workflow_hardening_repair", run: repairWorkflowHardening },
  { version: 22, name: "conversation_thread_overrides", run: addConversationThreadOverrides },
  { version: 23, name: "collaboration_operations", run: addCollaborationOperations },
  { version: 24, name: "runtime_history_hardening", run: hardenRuntimeHistory },
  { version: 25, name: "verified_source_identity_lookup", run: addVerifiedSourceIdentityLookup },
  { version: 26, name: "canonical_workflow_foundation", run: replaceWorkflowFoundation },
  { version: 27, name: "durable_workflow_materialization", run: addDurableWorkflowMaterialization },
  { version: 28, name: "canonical_workflow_authority", run: hardenCanonicalWorkflowAuthority },
  { version: 29, name: "workflow_scoped_idempotency", run: scopeWorkflowRunIdempotency },
  { version: 30, name: "pinned_workflow_trigger_deliveries", run: pinWorkflowTriggerDeliveries },
  { version: 31, name: "frozen_workflow_execution_inputs", run: freezeWorkflowExecutionInputs },
  { version: 32, name: "fenced_workflow_provider_effects", run: fenceWorkflowProviderEffects },
  { version: 33, name: "durable_draft_continuity", run: addDurableDraftContinuity },
  { version: 34, name: "hardened_draft_continuity", run: hardenDurableDraftContinuity },
  { version: 35, name: "mailbox_owned_provider_connections", run: hardCutMailboxOwnedConnections },
  { version: 36, name: "mailbox_owned_provider_binding_invariants", run: hardCutMailboxOwnedConnections },
  { version: 37, name: "structured_search_local_tags", run: addStructuredSearchAndLocalTags },
  { version: 38, name: "conversation_references_response_policies", run: addConversationReferencesAndResponsePolicies },
  { version: 39, name: "conversation_references_response_policies_hardening", run: hardenConversationReferencesAndResponsePolicies },
  { version: 40, name: "conversation_reference_merge_semantics", run: finalizeConversationReferenceMergeSemantics },
  { version: 41, name: "automatic_reply_execution_hardening", run: hardenAutomaticReplyExecution },
  { version: 42, name: "search_reference_rolling_compatibility", run: installSearchReferenceCompatibility },
  { version: 43, name: "response_policy_execution_repairs", run: repairResponsePolicyExecution },
  { version: 44, name: "conversation_reference_request_ledger", run: addConversationReferenceRequestLedger },
  { version: 45, name: "compose_templates_and_styles", run: addComposeTemplatesAndStyles },
  { version: 46, name: "compose_template_reference_hardening", run: hardenComposeTemplateReferences },
  { version: 47, name: "stable_scheduled_send_ordering", run: addStableScheduledSendOrdering },
  { version: 48, name: "stable_scheduled_send_ordering_guard", run: guardStableScheduledSendOrdering },
  { version: 49, name: "provider_binding_account_evidence", run: normalizeProviderBindingAccountEvidence },
  { version: 50, name: "managed_automatic_reply_configurations", run: addManagedAutomaticReplyConfigurations },
  { version: 51, name: "managed_automatic_reply_invariants", run: hardenManagedAutomaticReplyConfigurations },
  { version: 52, name: "automatic_reply_delivery_timestamps", run: addAutomaticReplyDeliveryTimestamps },
  { version: 53, name: "automatic_reply_delivery_timestamp_guard", run: guardAutomaticReplyDeliveryTimestamps },
  { version: 54, name: "sender_automation_ready_by_default", run: defaultSenderAutomationToMailbox },
] as const;

export const migrate = async (): Promise<void> => {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('cloud.mail.migrations', 0))`;
    await tx`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await tx`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    await tx`CREATE SCHEMA IF NOT EXISTS mail`;
    await tx`
      CREATE TABLE IF NOT EXISTS mail.schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const applied = await tx<{ version: number }[]>`SELECT version FROM mail.schema_migrations`;
    const appliedVersions = new Set(applied.map((row) => row.version));

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      await migration.run(tx);
      await tx`
        INSERT INTO mail.schema_migrations (version, name)
        VALUES (${migration.version}, ${migration.name})
      `;
    }
  });
};
