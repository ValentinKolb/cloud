import { text } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  parseProviderLimitSnapshot,
  PROVIDER_LIMIT_MAX_AGE_MS,
  type ProviderLimitSnapshot,
} from "../contracts";

type SqlClient = typeof sql;

export const activeSmtpMessageLimit = (
  snapshot: ProviderLimitSnapshot,
  now = Date.now(),
): number | null => {
  const checkedAt = Date.parse(snapshot.checkedAt);
  if (
    snapshot.smtp.status !== "supported" ||
    snapshot.smtp.maxMessageBytes === null ||
    !Number.isFinite(checkedAt) ||
    checkedAt > now + 5 * 60_000 ||
    now - checkedAt > PROVIDER_LIMIT_MAX_AGE_MS
  ) {
    return null;
  }
  return snapshot.smtp.maxMessageBytes;
};

export const loadBindingProviderLimits = async (
  db: SqlClient,
  bindingId: string,
): Promise<ProviderLimitSnapshot | null> => {
  const [row] = await db<{ limit_snapshot: unknown }[]>`
    SELECT connection.limit_snapshot
    FROM mail.provider_bindings binding
    JOIN mail.provider_connections connection ON connection.id = binding.connection_id
    WHERE binding.id = ${bindingId}::uuid
      AND binding.state = 'active'
      AND connection.status = 'active'
      AND connection.secret_revision = binding.verified_secret_revision
  `;
  return row ? parseProviderLimitSnapshot(row.limit_snapshot) : null;
};

const providerMessageSizeError = (
  byteLength: number,
  limitBytes: number,
): Error =>
  Object.assign(
    new Error(
      `This message is ${text.pprintBytes(byteLength)}, but the mail provider allows at most ${text.pprintBytes(limitBytes)}. Remove attachments or share large files with a download link.`,
    ),
    {
      code: "MESSAGE_EXCEEDS_PROVIDER_LIMIT",
      byteLength,
      limitBytes,
    },
  );

export const assertProviderMessageSize = (
  byteLength: number,
  limitBytes: number | null,
): void => {
  if (limitBytes !== null && byteLength > limitBytes) {
    throw providerMessageSizeError(byteLength, limitBytes);
  }
};
