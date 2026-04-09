import { sql } from "bun";
import { storedRealmFromProviderProfile } from "../accounts/storage";
import type { UserProfile, UserProvider } from "@valentinkolb/cloud-contracts/shared";

export type DeletedAccountReason =
  | "ipa_expired_demoted"
  | "ipa_expired_deleted"
  | "sync_out_of_scope_demoted"
  | "sync_out_of_scope_deleted"
  | "guest_expired_deleted"
  | "local_user_expired_deleted"
  | "manual_delete"
  | "manual_demote";

type SqlExecutor = typeof sql;

export const writeDeletedAccountAudit = async (config: {
  userId: string;
  uid: string;
  mail: string | null;
  displayName: string | null;
  previousRealm?: string;
  previousProvider?: UserProvider;
  previousProfile?: UserProfile;
  reason: DeletedAccountReason;
  meta?: Record<string, unknown>;
  db?: SqlExecutor;
}): Promise<void> => {
  const db = config.db ?? sql;
  const previousRealm =
    config.previousRealm ??
    (config.previousProvider && config.previousProfile
      ? storedRealmFromProviderProfile(config.previousProvider, config.previousProfile)
      : null);
  if (!previousRealm) {
    throw new Error("Deleted account audit requires previousRealm or previousProvider/previousProfile");
  }
  await db`
    INSERT INTO auth.deleted_accounts (deleted_user_id, uid, mail, display_name, previous_realm, reason, meta)
    VALUES (
      ${config.userId}::uuid,
      ${config.uid},
      ${config.mail},
      ${config.displayName},
      ${previousRealm},
      ${config.reason},
      ${JSON.stringify(config.meta ?? {})}::jsonb
    )
  `;
};
