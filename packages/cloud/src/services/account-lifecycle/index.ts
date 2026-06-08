import { sql } from "bun";
import type { User } from "../../contracts/shared";
import { logger } from "../logging";
import { notifications } from "../notifications";
import { applyIpaAccountTransitionPolicy } from "../accounts/switching";
import { audit } from "../audit";
import { get as getSetting } from "../settings";
import { renderTemplate } from "../settings/templates";
import { session } from "../session";
import { getConfiguredExpiryDays, parseIpaAccountTransitionPolicy } from "../account-model";
import { getFreeIpaConfig } from "../freeipa-config";
import { parsePgJsonRecord } from "../postgres";
import { dates } from "../../shared";
import { err, fail, freeipa, ok, type Result } from "../../server/services";
import { writeDeletedAccountAudit } from "./audit";
import { getIpaUrl } from "../ipa/guard";

const log = logger("auth:lifecycle");

type DbRow = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;

type ReminderKind = "account_expiry";

type ReminderCandidate = {
  userId: string;
  uid: string;
  mail: string;
  givenName: string;
  displayName: string;
  expiresAt: Date;
  kind: ReminderKind;
  accountKind: "ipa" | "local-user" | "local-guest";
};

type LifecycleSummary = {
  scanned: number;
  changed: number;
  skipped: number;
  failed: number;
};

const settingInt = async (key: string, fallback: number): Promise<number> => {
  const raw = await getSetting<number | string | null>(key);
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const getIpaExpiresDays = async (): Promise<number> => getConfiguredExpiryDays("ipa", "user");

const getLocalUserExpiresDays = async (): Promise<number> => getConfiguredExpiryDays("local", "user");
const getGuestExpiresDays = async (): Promise<number> => {
  return getConfiguredExpiryDays("local", "guest");
};
const getDeletedAccountsRetentionDays = async (): Promise<number> => settingInt("user.account.deleted_accounts_retention_days", 365);
const getReminderHistoryRetentionDays = async (): Promise<number> => settingInt("user.account.reminder_history_retention_days", 365);

const parseReminderDays = async (): Promise<number[]> => {
  const raw = await getSetting<number[]>("user.account.reminder_days");
  const parsed = Array.isArray(raw) ? raw.filter((entry) => Number.isInteger(entry) && entry > 0) : [];
  return [...new Set(parsed)].sort((a, b) => b - a);
};

const upsertReminderAttempt = async (config: {
  userId: string;
  uid: string;
  mail: string;
  displayName: string;
  kind: ReminderKind;
  thresholdDays: number;
  targetExpiryAt: Date;
}): Promise<{ id: string; status: "pending" | "sent" | "error" }> => {
  const rows = await sql<DbRow[]>`
    INSERT INTO auth.account_lifecycle_reminders (
      user_id, uid, mail, display_name, kind, threshold_days, target_expiry_at, status, attempt_count, created_at
    )
    VALUES (
      ${config.userId}::uuid, ${config.uid}, ${config.mail}, ${config.displayName}, ${config.kind}, ${config.thresholdDays}, ${config.targetExpiryAt}, 'pending', 0, now()
    )
    ON CONFLICT (user_id, kind, threshold_days, target_expiry_at) WHERE user_id IS NOT NULL DO UPDATE
    SET uid = EXCLUDED.uid,
        mail = EXCLUDED.mail,
        display_name = EXCLUDED.display_name,
        status = CASE WHEN auth.account_lifecycle_reminders.status = 'sent' THEN 'sent' ELSE 'pending' END
    RETURNING id, status
  `;

  return {
    id: rows[0]!.id as string,
    status: rows[0]!.status as "pending" | "sent" | "error",
  };
};

const markReminderSuccess = async (id: string): Promise<void> => {
  await sql`
    UPDATE auth.account_lifecycle_reminders
    SET status = 'sent',
        attempt_count = attempt_count + 1,
        last_attempt_at = now(),
        sent_at = now(),
        last_error = NULL
    WHERE id = ${id}::uuid
  `;
};

const markReminderError = async (id: string, error: string): Promise<void> => {
  await sql`
    UPDATE auth.account_lifecycle_reminders
    SET status = 'error',
        attempt_count = attempt_count + 1,
        last_attempt_at = now(),
        last_error = ${error}
    WHERE id = ${id}::uuid
  `;
};

const deleteFromFreeIpa = async (ipaSession: string, uid: string): Promise<{ ok: true } | { ok: false; error: string }> => {
  const response = await freeipa.client.call({ url: await getIpaUrl(), ipaSession, method: "user_del", args: [uid], options: {} });
  if (!response.error) return { ok: true };

  const message = (response.error.message ?? "").toLowerCase();
  const isNotFound = message.includes("not found") || message.includes("does not exist");
  if (isNotFound) return { ok: true };

  return { ok: false, error: response.error.message };
};

const resolveExtendUrl = async (): Promise<string> => {
  const appUrl = await getSetting<string>("app.url");
  const base = appUrl && appUrl.length > 0 ? appUrl : "";
  if (base.startsWith("http://") || base.startsWith("https://")) return `${base.replace(/\/+$/, "")}/auth/extend`;
  if (base.length > 0) return `https://${base.replace(/\/+$/, "")}/auth/extend`;
  return "/auth/extend";
};

const listReminderCandidates = async (thresholdDays: number): Promise<ReminderCandidate[]> => {
  const rows = await sql<DbRow[]>`
    SELECT id,
           uid,
           mail,
           given_name,
           display_name,
           account_expires AS expires_at,
           'account_expiry'::text AS kind,
           'ipa'::text AS account_kind
    FROM auth.users
    WHERE provider = 'ipa'
      AND mail IS NOT NULL
      AND account_expires IS NOT NULL
      AND now() >= account_expires - (${thresholdDays} * interval '1 day')
      AND now() < account_expires

    UNION ALL

    SELECT id,
           uid,
           mail,
           given_name,
           display_name,
           account_expires AS expires_at,
           'account_expiry'::text AS kind,
           'local-guest'::text AS account_kind
    FROM auth.users
    WHERE provider = 'local'
      AND profile = 'guest'
      AND mail IS NOT NULL
      AND account_expires IS NOT NULL
      AND now() >= account_expires - (${thresholdDays} * interval '1 day')
      AND now() < account_expires

    UNION ALL

    SELECT id,
           uid,
           mail,
           given_name,
           display_name,
           account_expires AS expires_at,
           'account_expiry'::text AS kind,
           'local-user'::text AS account_kind
    FROM auth.users
    WHERE provider = 'local'
      AND profile = 'user'
      AND mail IS NOT NULL
      AND account_expires IS NOT NULL
      AND now() >= account_expires - (${thresholdDays} * interval '1 day')
      AND now() < account_expires
  `;

  return rows.map(
    (row): ReminderCandidate => ({
      userId: row.id as string,
      uid: row.uid as string,
      mail: row.mail as string,
      givenName: ((row.given_name as string) || "").trim(),
      displayName: ((row.display_name as string) || "").trim(),
      expiresAt: row.expires_at as Date,
      kind: row.kind as ReminderKind,
      accountKind: row.account_kind as ReminderCandidate["accountKind"],
    }),
  );
};

export const accountLifecycle = {
  demoteExpiredIpaUsers: async (): Promise<LifecycleSummary> => {
    const freeIpaConfig = (await getFreeIpaConfig());
    if (!freeIpaConfig.enabled) {
      log.info("Expired IPA demotion skipped", { reason: "freeipa_disabled" });
      return { scanned: 0, changed: 0, skipped: 0, failed: 0 };
    }
    if (!freeIpaConfig.configured) {
      throw new Error("FreeIPA is enabled but not fully configured.");
    }

    const rows = await sql<DbRow[]>`
      SELECT id, uid, mail, display_name, profile, account_expires
      FROM auth.users
      WHERE provider = 'ipa'
        AND account_expires IS NOT NULL
        AND account_expires <= now()
      ORDER BY account_expires ASC
    `;

    const transitionPolicy = parseIpaAccountTransitionPolicy(
      await getSetting<string | null>("freeipa.account_transition_policy"),
    );
    const ipaSession = await freeipa.session.getServiceSession({
      url: freeIpaConfig.url,
      serviceUser: freeIpaConfig.serviceUser,
      servicePassword: freeIpaConfig.servicePassword,
    });
    const summary: LifecycleSummary = {
      scanned: rows.length,
      changed: 0,
      skipped: 0,
      failed: 0,
    };

    for (const row of rows) {
      const userId = row.id as string;
      const uid = row.uid as string;
      const previousProfile = (row.profile as User["profile"] | null) ?? "guest";
      const ipaDelete = await deleteFromFreeIpa(ipaSession, uid);
      if (!ipaDelete.ok) {
        summary.failed += 1;
        log.error("Failed to delete expired IPA account", { uid, userId, error: ipaDelete.error });
        continue;
      }

      try {
        if (transitionPolicy === "delete") {
          await sql.begin(async (tx) => {
            await writeDeletedAccountAudit({
              db: tx,
              userId,
              uid,
              mail: (row.mail as string) ?? null,
              displayName: (row.display_name as string) ?? null,
              previousProvider: "ipa",
              previousProfile,
              reason: "ipa_expired_deleted",
              meta: {
                reason: "ipa_account_expired",
              },
            });
            await tx`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
          });
        } else {
          await sql.begin(async (tx) => {
            const target = await applyIpaAccountTransitionPolicy({
              userId,
              currentProfile: previousProfile,
              policy: transitionPolicy,
              db: tx,
            });
            await writeDeletedAccountAudit({
              db: tx,
              userId,
              uid,
              mail: (row.mail as string) ?? null,
              displayName: (row.display_name as string) ?? null,
              previousProvider: "ipa",
              previousProfile,
              reason: "ipa_expired_demoted",
              meta: {
                accountExpiresAt: target.accountExpires?.toISOString() ?? null,
                targetProfile: target.targetProfile,
                policy: transitionPolicy,
              },
            });
          });
        }
        await session.revokeAllForUser(userId);
        summary.changed += 1;
      } catch (error) {
        summary.failed += 1;
        log.error("Failed to demote expired IPA account", {
          uid,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  },

  cleanupExpiredGuests: async (): Promise<LifecycleSummary> => {
    const rows = await sql<DbRow[]>`
      SELECT id, uid, mail, display_name
      FROM auth.users
      WHERE provider = 'local'
        AND profile = 'guest'
        AND account_expires IS NOT NULL
        AND account_expires <= now()
      ORDER BY account_expires ASC
    `;

    const summary: LifecycleSummary = {
      scanned: rows.length,
      changed: 0,
      skipped: 0,
      failed: 0,
    };

    for (const row of rows) {
      const userId = row.id as string;
      const uid = row.uid as string;
      try {
        await sql.begin(async (tx) => {
          await writeDeletedAccountAudit({
            db: tx,
            userId,
            uid,
            mail: (row.mail as string) ?? null,
            displayName: (row.display_name as string) ?? null,
            previousProvider: "local",
            previousProfile: "guest",
            reason: "guest_expired_deleted",
          });
          await tx`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
        });
        await session.revokeAllForUser(userId);
        summary.changed += 1;
      } catch (error) {
        summary.failed += 1;
        log.error("Failed to delete expired guest account", {
          uid,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  },

  cleanupExpiredLocalUsers: async (): Promise<LifecycleSummary> => {
    const rows = await sql<DbRow[]>`
      SELECT id, uid, mail, display_name
      FROM auth.users
      WHERE provider = 'local'
        AND profile = 'user'
        AND account_expires IS NOT NULL
        AND account_expires <= now()
      ORDER BY account_expires ASC
    `;

    const summary: LifecycleSummary = {
      scanned: rows.length,
      changed: 0,
      skipped: 0,
      failed: 0,
    };

    for (const row of rows) {
      const userId = row.id as string;
      const uid = row.uid as string;
      try {
        await sql.begin(async (tx) => {
          await writeDeletedAccountAudit({
            db: tx,
            userId,
            uid,
            mail: (row.mail as string) ?? null,
            displayName: (row.display_name as string) ?? null,
            previousProvider: "local",
            previousProfile: "user",
            reason: "local_user_expired_deleted",
          });
          await tx`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
        });
        await session.revokeAllForUser(userId);
        summary.changed += 1;
      } catch (error) {
        summary.failed += 1;
        log.error("Failed to delete expired local user account", {
          uid,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  },

  sendExpiryReminders: async (): Promise<LifecycleSummary> => {
    const days = await parseReminderDays();
    if (days.length === 0) {
      return { scanned: 0, changed: 0, skipped: 0, failed: 0 };
    }

    const template = await getSetting<string>("mail.account_expiry_reminder");
    const appName = (await getSetting<string>("app.name")) || "Cloud";
    const contactEmail = (await getSetting<string>("app.contact_email")) || "";
    const extendUrl = await resolveExtendUrl();

    let scanned = 0;
    let changed = 0;
    let skipped = 0;
    let failed = 0;

    for (const thresholdDays of days) {
      const candidates = await listReminderCandidates(thresholdDays);
      scanned += candidates.length;

      for (const candidate of candidates) {
      const attempt = await upsertReminderAttempt({
        userId: candidate.userId,
        uid: candidate.uid,
        mail: candidate.mail,
        displayName: candidate.displayName,
        kind: candidate.kind,
        thresholdDays,
        targetExpiryAt: candidate.expiresAt,
      });

        if (attempt.status === "sent") {
          skipped += 1;
          continue;
        }

        const expiryText = dates.formatDate(candidate.expiresAt);

        const subject = `${appName} account expires soon`;
        const html = renderTemplate(template, {
          FIRST_NAME: candidate.givenName || candidate.displayName || candidate.uid,
          DISPLAY_NAME: candidate.displayName || candidate.uid,
          EXPIRY: expiryText,
          EXTEND_URL: extendUrl,
          APP_NAME: appName,
          CONTACT_EMAIL: contactEmail,
          ACCOUNT_KIND: candidate.accountKind,
        });

        try {
          const notification = await notifications.send({
            type: "email",
            recipient: candidate.mail,
            subject,
            rawHtml: html,
            autoSend: true,
          });
          if (notification.status === "error") {
            await markReminderError(attempt.id, notification.error ?? "Notification delivery failed");
            failed += 1;
            continue;
          }

          await markReminderSuccess(attempt.id);
          changed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await markReminderError(attempt.id, message);
          failed += 1;
          log.error("Failed to send expiry reminder", {
            userId: candidate.userId,
            uid: candidate.uid,
            kind: candidate.kind,
            thresholdDays,
            error: message,
          });
        }
      }
    }

    return { scanned, changed, skipped, failed };
  },

  cleanupLifecycleAudit: async (): Promise<LifecycleSummary> => {
    const [deletedAccountsRetentionDays, reminderHistoryRetentionDays] = await Promise.all([
      getDeletedAccountsRetentionDays(),
      getReminderHistoryRetentionDays(),
    ]);

    const deletedRows =
      deletedAccountsRetentionDays > 0
        ? await sql<DbRow[]>`
            DELETE FROM auth.deleted_accounts
            WHERE deleted_at < now() - (${deletedAccountsRetentionDays} * interval '1 day')
            RETURNING id
          `
        : [];
    const reminderRows =
      reminderHistoryRetentionDays > 0
        ? await sql<DbRow[]>`
            DELETE FROM auth.account_lifecycle_reminders
            WHERE created_at < now() - (${reminderHistoryRetentionDays} * interval '1 day')
            RETURNING id
          `
        : [];

    return {
      scanned: deletedRows.length + reminderRows.length,
      changed: deletedRows.length + reminderRows.length,
      skipped: 0,
      failed: 0,
    };
  },

  runIpaBackfill: async (): Promise<LifecycleSummary> => {
    const freeIpaConfig = (await getFreeIpaConfig());
    if (!freeIpaConfig.enabled) {
      log.info("IPA backfill skipped", { reason: "freeipa_disabled" });
      return { scanned: 0, changed: 0, skipped: 0, failed: 0 };
    }
    if (!freeIpaConfig.configured) {
      throw new Error("FreeIPA is enabled but not fully configured.");
    }

    const configuredDays = await getIpaExpiresDays();
    if (configuredDays <= 0) {
      return { scanned: 0, changed: 0, skipped: 0, failed: 0 };
    }

    const days = Math.max(configuredDays, 7);
    const minimumExpiry = new Date(Date.now() + days * DAY_MS);
    minimumExpiry.setUTCHours(23, 59, 59, 0);
    const ipaExpiry = freeipa.util.toGeneralizedTime(minimumExpiry);
    const ipaSession = await freeipa.session.getServiceSession({
      url: freeIpaConfig.url,
      serviceUser: freeIpaConfig.serviceUser,
      servicePassword: freeIpaConfig.servicePassword,
    });

    const rows = await sql<DbRow[]>`
      SELECT id, uid, account_expires
      FROM auth.users
      WHERE provider = 'ipa'
        AND (account_expires IS NULL OR account_expires < ${minimumExpiry})
      ORDER BY uid
    `;

    const summary: LifecycleSummary = {
      scanned: rows.length,
      changed: 0,
      skipped: 0,
      failed: 0,
    };

    for (const row of rows) {
      const userId = row.id as string;
      const uid = row.uid as string;
      const remote = await freeipa.client.call({
        url: freeIpaConfig.url,
        ipaSession,
        method: "user_show",
        args: [uid],
        options: { all: true },
      });
      if (remote.error) {
        summary.failed += 1;
        log.error("IPA backfill read failed", { uid, userId, error: remote.error.message });
        continue;
      }

      const remoteResult = remote.result?.result as Record<string, unknown> | undefined;
      const remoteExpiry = freeipa.util.parseGeneralizedTime(remoteResult?.krbprincipalexpiration);
      if (remoteExpiry && remoteExpiry >= minimumExpiry) {
        await sql`
          UPDATE auth.users
          SET account_expires = ${remoteExpiry}
          WHERE id = ${userId}::uuid
        `;
        await sql`
          INSERT INTO auth.user_ipa_data (user_id, synced_at)
          VALUES (${userId}::uuid, now())
          ON CONFLICT (user_id) DO UPDATE SET synced_at = EXCLUDED.synced_at
        `;
        summary.skipped += 1;
        continue;
      }

      const response = await freeipa.client.call({
        url: freeIpaConfig.url,
        ipaSession,
        method: "user_mod",
        args: [uid],
        options: { krbprincipalexpiration: ipaExpiry },
      });
      if (response.error) {
        summary.failed += 1;
        log.error("IPA backfill failed", { uid, userId, error: response.error.message });
        continue;
      }

      await sql`
        UPDATE auth.users
        SET account_expires = ${minimumExpiry}
        WHERE id = ${userId}::uuid
      `;
      await sql`
        INSERT INTO auth.user_ipa_data (user_id, synced_at)
        VALUES (${userId}::uuid, now())
        ON CONFLICT (user_id) DO UPDATE SET synced_at = EXCLUDED.synced_at
      `;
      summary.changed += 1;
    }

    return summary;
  },

  runLocalUserBackfill: async (): Promise<LifecycleSummary> => {
    const configuredDays = await getLocalUserExpiresDays();
    if (configuredDays <= 0) {
      return { scanned: 0, changed: 0, skipped: 0, failed: 0 };
    }

    const days = Math.max(configuredDays, 7);
    const target = new Date(Date.now() + days * DAY_MS);

    const rows = await sql<DbRow[]>`
      UPDATE auth.users
      SET account_expires = ${target}
      WHERE provider = 'local'
        AND profile = 'user'
        AND (account_expires IS NULL OR account_expires < ${target})
      RETURNING id
    `;

    return {
      scanned: rows.length,
      changed: rows.length,
      skipped: 0,
      failed: 0,
    };
  },

  runGuestBackfill: async (): Promise<LifecycleSummary> => {
    const configuredDays = await getGuestExpiresDays();
    if (configuredDays <= 0) {
      return { scanned: 0, changed: 0, skipped: 0, failed: 0 };
    }

    const days = Math.max(configuredDays, 7);
    const target = new Date(Date.now() + days * DAY_MS);

    const rows = await sql<DbRow[]>`
      UPDATE auth.users
      SET account_expires = ${target}
      WHERE provider = 'local'
        AND profile = 'guest'
        AND (account_expires IS NULL OR account_expires < ${target})
      RETURNING id
    `;

    return {
      scanned: rows.length,
      changed: rows.length,
      skipped: 0,
      failed: 0,
    };
  },

  extendCurrentUserAccount: async (config: {
    user: User;
    ipaSession?: string | null;
  }): Promise<Result<{ message: string; newExpiry?: string }>> => {
    const auditParams = (result: Result<{ message: string; newExpiry?: string }>) => ({
      action: "accounts.user.extend_account",
      actor: {
        userId: config.user.id,
        uid: config.user.uid,
        provider: config.user.provider,
        roles: config.user.roles,
      },
      target: { type: "user", id: config.user.id, label: config.user.uid, provider: config.user.provider },
      result,
    });
    const recordResult = (result: Result<{ message: string; newExpiry?: string }>) =>
      audit.recordResult(auditParams(result));
    const recordCompletedMutation = (result: Result<{ message: string; newExpiry?: string }>) =>
      result.ok ? audit.recordResultAfterSideEffect(auditParams(result)) : audit.recordResult(auditParams(result));

    if (config.user.accountExpires === null) {
      return recordResult(fail(err.badInput("Accounts without an expiration date cannot be extended.")));
    }

    if (config.user.provider === "ipa") {
      const freeIpaConfig = (await getFreeIpaConfig());
      if (!freeIpaConfig.enabled) {
        return recordResult(ok({ message: "FreeIPA is disabled." }));
      }
      const configuredDays = await getIpaExpiresDays();
      if (configuredDays <= 0) {
        return recordResult(ok({ message: "Automatic account expiry is disabled for IPA accounts." }));
      }

      if (!config.ipaSession) {
        return recordResult(fail(err.unauthenticated("IPA session required to extend an IPA-backed account.")));
      }

      const expiresAt = new Date(Date.now() + configuredDays * DAY_MS);
      expiresAt.setUTCHours(23, 59, 59, 0);
      const ipaExpiry = freeipa.util.toGeneralizedTime(expiresAt);

      const response = await freeipa.client.call({
        url: freeIpaConfig.url,
        ipaSession: config.ipaSession,
        method: "user_mod",
        args: [config.user.uid],
        options: { krbprincipalexpiration: ipaExpiry },
      });
      if (response.error) {
        return recordResult(fail(err.badInput(response.error.message || "Failed to extend IPA account.")));
      }

      await sql`
        UPDATE auth.users
        SET account_expires = ${expiresAt}
        WHERE id = ${config.user.id}::uuid
      `;
      await sql`
        INSERT INTO auth.user_ipa_data (user_id, synced_at)
        VALUES (${config.user.id}::uuid, now())
        ON CONFLICT (user_id) DO UPDATE SET synced_at = EXCLUDED.synced_at
      `;

      return recordCompletedMutation(ok({
        message: `Account extended until ${dates.formatDate(expiresAt)}.`,
        newExpiry: expiresAt.toISOString(),
      }));
    }

    if (config.user.provider === "local" && config.user.profile === "guest") {
      const guestDays = await getGuestExpiresDays();
      if (guestDays <= 0) {
        await sql`
          UPDATE auth.users
          SET account_expires = NULL
          WHERE id = ${config.user.id}::uuid
        `;
        return recordCompletedMutation(ok({ message: "Guest account expiry is disabled." }));
      }

      const expiresAt = new Date(Date.now() + guestDays * DAY_MS);
      await sql`
        UPDATE auth.users
        SET account_expires = ${expiresAt}
        WHERE id = ${config.user.id}::uuid
      `;

      return recordCompletedMutation(ok({
        message: `Guest account extended until ${dates.formatDate(expiresAt)}.`,
        newExpiry: expiresAt.toISOString(),
      }));
    }

    if (config.user.provider === "local" && config.user.profile === "user") {
      const localUserDays = await getLocalUserExpiresDays();
      if (localUserDays <= 0) {
        await sql`
          UPDATE auth.users
          SET account_expires = NULL
          WHERE id = ${config.user.id}::uuid
        `;
        return recordCompletedMutation(ok({ message: "Local user account expiry is disabled." }));
      }

      const expiresAt = new Date(Date.now() + localUserDays * DAY_MS);
      await sql`
        UPDATE auth.users
        SET account_expires = ${expiresAt}
        WHERE id = ${config.user.id}::uuid
      `;

      return recordCompletedMutation(ok({
        message: `Account extended until ${dates.formatDate(expiresAt)}.`,
        newExpiry: expiresAt.toISOString(),
      }));
    }

    return recordResult(ok({ message: "Your account does not support extension." }));
  },

  listDeletedAccounts: async (config: { page: number; perPage: number; reason?: string; search?: string }) => {
    const offset = (config.page - 1) * config.perPage;
    const reason = config.reason?.trim() || null;
    const search = config.search?.trim().toLowerCase() || null;
    const pattern = search ? `%${freeipa.util.escapeLike(search)}%` : null;

    const countRows = await sql<DbRow[]>`
      SELECT COUNT(*)::int AS total
      FROM auth.deleted_accounts
      WHERE (${reason}::text IS NULL OR reason = ${reason})
        AND (
          ${pattern}::text IS NULL
          OR LOWER(uid) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(display_name, '')) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(mail, '')) LIKE ${pattern} ESCAPE '\\'
        )
    `;

    const rows = await sql<DbRow[]>`
      SELECT id, deleted_user_id, uid, mail, display_name, previous_provider, previous_profile, reason, deleted_at, meta
      FROM auth.deleted_accounts
      WHERE (${reason}::text IS NULL OR reason = ${reason})
        AND (
          ${pattern}::text IS NULL
          OR LOWER(uid) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(display_name, '')) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(mail, '')) LIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY deleted_at DESC
      LIMIT ${config.perPage}
      OFFSET ${offset}
    `;

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        deletedUserId: row.deleted_user_id as string,
        uid: row.uid as string,
        mail: (row.mail as string) ?? null,
        displayName: (row.display_name as string) ?? null,
        previousProvider: (row.previous_provider as string) ?? null,
        previousProfile: (row.previous_profile as string) ?? null,
        reason: row.reason as string,
        deletedAt: (row.deleted_at as Date).toISOString(),
        meta: parsePgJsonRecord(row.meta) ?? {},
      })),
      total: Number(countRows[0]?.total ?? 0),
      page: config.page,
      perPage: config.perPage,
    };
  },

  listReminderAudit: async (config: { page: number; perPage: number; status?: string; kind?: ReminderKind; search?: string }) => {
    const offset = (config.page - 1) * config.perPage;
    const status = config.status?.trim() || null;
    const kind = config.kind ?? null;
    const search = config.search?.trim().toLowerCase() || null;
    const pattern = search ? `%${freeipa.util.escapeLike(search)}%` : null;

    const countRows = await sql<DbRow[]>`
      SELECT COUNT(*)::int AS total
      FROM auth.account_lifecycle_reminders r
      LEFT JOIN auth.users u ON u.id = r.user_id
      WHERE (${status}::text IS NULL OR r.status = ${status})
        AND (${kind}::text IS NULL OR r.kind = ${kind})
        AND (
          ${pattern}::text IS NULL
          OR LOWER(COALESCE(r.uid, u.uid, '')) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(r.mail, u.mail, '')) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(r.display_name, u.display_name, '')) LIKE ${pattern} ESCAPE '\\'
        )
    `;

    const rows = await sql<DbRow[]>`
      SELECT r.id,
             r.user_id,
             r.uid AS reminder_uid,
             r.mail AS reminder_mail,
             r.display_name AS reminder_display_name,
             r.kind,
             r.threshold_days,
             r.target_expiry_at,
             r.status,
             r.attempt_count,
             r.last_attempt_at,
             r.sent_at,
             r.last_error,
             r.created_at,
             u.uid AS live_uid,
             u.mail AS live_mail,
             u.display_name AS live_display_name
      FROM auth.account_lifecycle_reminders r
      LEFT JOIN auth.users u ON u.id = r.user_id
      WHERE (${status}::text IS NULL OR r.status = ${status})
        AND (${kind}::text IS NULL OR r.kind = ${kind})
        AND (
          ${pattern}::text IS NULL
          OR LOWER(COALESCE(r.uid, u.uid, '')) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(r.mail, u.mail, '')) LIKE ${pattern} ESCAPE '\\'
          OR LOWER(COALESCE(r.display_name, u.display_name, '')) LIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY r.created_at DESC
      LIMIT ${config.perPage}
      OFFSET ${offset}
    `;

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        userId: (row.user_id as string) ?? null,
        uid: ((row.reminder_uid as string) ?? (row.live_uid as string) ?? null),
        mail: ((row.reminder_mail as string) ?? (row.live_mail as string) ?? null),
        displayName: ((row.reminder_display_name as string) ?? (row.live_display_name as string) ?? null),
        kind: row.kind as string,
        thresholdDays: Number(row.threshold_days),
        targetExpiryAt: (row.target_expiry_at as Date).toISOString(),
        status: row.status as string,
        attemptCount: Number(row.attempt_count),
        lastAttemptAt: row.last_attempt_at ? (row.last_attempt_at as Date).toISOString() : null,
        sentAt: row.sent_at ? (row.sent_at as Date).toISOString() : null,
        lastError: (row.last_error as string) ?? null,
        createdAt: (row.created_at as Date).toISOString(),
      })),
      total: Number(countRows[0]?.total ?? 0),
      page: config.page,
      perPage: config.perPage,
    };
  },
};

export type AccountLifecycleService = typeof accountLifecycle;
