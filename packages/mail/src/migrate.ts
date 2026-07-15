import { sql } from "bun";
import { SEARCH_CHUNK_CHARACTERS, SEARCH_CHUNK_OVERLAP_CHARACTERS } from "./service/search-chunks";

type SqlClient = typeof sql;

const createInitialSchema = async (db: SqlClient): Promise<void> => {
  await db`
    CREATE TABLE mail.mailboxes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
      description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
      connection_policy TEXT NOT NULL DEFAULT 'shared_connection'
        CHECK (connection_policy IN ('shared_connection', 'personal_provider_account')),
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
      owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      owner_service_account_id UUID REFERENCES auth.service_accounts(id) ON DELETE CASCADE,
      owner_mailbox_id UUID REFERENCES mail.mailboxes(id) ON DELETE CASCADE,
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
      CONSTRAINT provider_connections_one_owner CHECK (
        num_nonnulls(owner_user_id, owner_service_account_id, owner_mailbox_id) = 1
      ),
      CONSTRAINT provider_connections_secret_lifecycle CHECK (
        (status = 'revoked' AND encrypted_secret IS NULL) OR
        (status <> 'revoked' AND encrypted_secret IS NOT NULL)
      )
    )
  `;
  await db`
    CREATE UNIQUE INDEX provider_connections_user_name_idx
    ON mail.provider_connections (owner_user_id, lower(name))
    WHERE owner_user_id IS NOT NULL AND status <> 'revoked'
  `;
  await db`
    CREATE UNIQUE INDEX provider_connections_service_account_name_idx
    ON mail.provider_connections (owner_service_account_id, lower(name))
    WHERE owner_service_account_id IS NOT NULL AND status <> 'revoked'
  `;
  await db`
    CREATE UNIQUE INDEX provider_connections_mailbox_name_idx
    ON mail.provider_connections (owner_mailbox_id, lower(name))
    WHERE owner_mailbox_id IS NOT NULL AND status <> 'revoked'
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (remote_resource_id, connection_id)
    )
  `;
  await db`CREATE INDEX provider_bindings_resource_state_idx ON mail.provider_bindings (remote_resource_id, state, last_verified_at DESC)`;
  await db`CREATE INDEX provider_bindings_connection_idx ON mail.provider_bindings (connection_id, state)`;

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
      interactive_policy TEXT NOT NULL DEFAULT 'mailbox' CHECK (interactive_policy IN ('mailbox', 'actor')),
      automation_policy TEXT NOT NULL DEFAULT 'disabled' CHECK (automation_policy IN ('disabled', 'mailbox', 'pool')),
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

const replaceWorkflowFoundation = async (db: SqlClient): Promise<void> => {
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

  await db`
    CREATE TABLE mail.workflow_step_runs (
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
    CREATE INDEX workflow_step_runs_dispatch_idx
    ON mail.workflow_step_runs (target_id, state, step_key)
    WHERE state IN ('queued', 'running', 'waiting')
  `;
  await db`
    CREATE UNIQUE INDEX workflow_step_runs_command_idx
    ON mail.workflow_step_runs (command_id)
    WHERE command_id IS NOT NULL
  `;

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
