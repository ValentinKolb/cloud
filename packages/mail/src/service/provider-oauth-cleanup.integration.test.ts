import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { cleanupProviderOAuthFlows } from "./provider-oauth-cleanup";

const suite = process.env.MAIL_INTEGRATION_TESTS === "1" ? describe : describe.skip;
const hexToken = (): string => crypto.getRandomValues(new Uint8Array(32)).toHex();

suite("provider OAuth flow cleanup", () => {
  let userId: string;
  let mailboxId: string;
  let connectionId: string;
  const flowIds: string[] = [];

  beforeAll(async () => {
    await migrate();
    const suffix = crypto.randomUUID().slice(0, 8);
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, admin)
      VALUES (${`oauth-cleanup-${suffix}`}, 'local', 'user', 'OAuth Cleanup', false)
      RETURNING id
    `;
    if (!user) throw new Error("Failed to create OAuth cleanup user");
    userId = user.id;
    const [mailbox] = await sql<{ id: string }[]>`
      INSERT INTO mail.mailboxes (name, created_by_user_id)
      VALUES (${`OAuth cleanup ${suffix}`}, ${userId}::uuid)
      RETURNING id
    `;
    if (!mailbox) throw new Error("Failed to create OAuth cleanup mailbox");
    mailboxId = mailbox.id;
    const [connection] = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_connections (
        owner_mailbox_id, name, email, username, imap_host, imap_port, imap_tls_mode,
        smtp_host, smtp_port, smtp_tls_mode, secret_kind, encrypted_secret, oauth_provider_id
      ) VALUES (
        ${mailboxId}::uuid, 'OAuth cleanup', 'cleanup@example.com', 'cleanup@example.com',
        'imap.example.com', 993, 'implicit', 'smtp.example.com', 465, 'implicit',
        'oauth2', 'test-encrypted-secret', 'google'
      )
      RETURNING id
    `;
    if (!connection) throw new Error("Failed to create OAuth cleanup connection");
    connectionId = connection.id;
  });

  afterAll(async () => {
    if (mailboxId) await sql`DELETE FROM mail.mailboxes WHERE id = ${mailboxId}::uuid`;
    if (userId) await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
  });

  test("retains completed results and recovered connection checkpoints for their result window", async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO mail.provider_oauth_flows (
        state_hash, browser_nonce_hash, mailbox_id, user_id, provider_id, operation,
        connection_id, connection_input, encrypted_code_verifier, status,
        result_connection_id, result_code, expires_at, completed_at, created_at, updated_at
      ) VALUES
        (
          ${hexToken()}, ${hexToken()}, ${mailboxId}::uuid, ${userId}::uuid, 'google', 'create',
          NULL, '{}'::jsonb, 'destroyed', 'completed', ${connectionId}::uuid, 'CONNECTED',
          now() - interval '1 hour', now(), now() - interval '2 hours', now()
        ),
        (
          ${hexToken()}, ${hexToken()}, ${mailboxId}::uuid, ${userId}::uuid, 'google', 'reconnect',
          ${connectionId}::uuid, '{}'::jsonb, 'checkpoint-verifier', 'exchanging', ${connectionId}::uuid, NULL,
          now() - interval '1 minute', NULL, now() - interval '1 hour', now() - interval '10 minutes'
        )
      RETURNING id
    `;
    flowIds.push(...rows.map((row) => row.id));

    await cleanupProviderOAuthFlows();

    const retained = await sql<{ id: string; status: string; result_code: string | null }[]>`
      SELECT id, status, result_code
      FROM mail.provider_oauth_flows
      WHERE id = ANY(${sql.array(flowIds, "UUID")})
      ORDER BY id
    `;
    expect(retained).toHaveLength(2);
    expect(retained.map((row) => [row.status, row.result_code]).toSorted()).toEqual(
      [
        ["completed", "CONNECTED"],
        ["completed", "PARTIAL"],
      ].toSorted(),
    );
  });
});
