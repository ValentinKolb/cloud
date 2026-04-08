import { sql } from "bun";
import { env } from "../../config/env";
import { accountLifecycle } from "../account-lifecycle";
import { lifecycleJobs } from "../account-lifecycle/scheduler";
import { logger, logging, type LogEntry } from "../logging";
import { notifications } from "../notifications";
import { getFreeIpaConfigSync } from "../freeipa-config";
import * as settings from "../settings";
import { renderTemplate } from "../settings/templates";
import * as users from "./users";
import * as groups from "./groups";
import * as entities from "./entities";
import type {
  BaseGroup,
  BaseUser,
  EntityKind,
  EntityListItem,
  GroupMember,
  MutationResult,
  User,
  UserProfile,
  UserProvider,
} from "@valentinkolb/cloud-contracts/shared";
import { dates } from "@valentinkolb/cloud-lib/shared";
import { err, fail, ok, paginate, type PageParams, type Paginated, type Result, type ServiceError } from "@valentinkolb/cloud-lib/server";

type CreateUserInput =
  | {
      provider: "ipa";
      email: string;
      givenname: string;
      sn: string;
      displayName?: string;
      autoSendNotification?: boolean;
      requestId?: string;
    }
  | {
      provider: "local";
      profile: UserProfile;
      admin?: boolean;
      email: string;
      givenname: string;
      sn: string;
      displayName?: string;
      autoSendNotification?: boolean;
      requestId?: string;
    };

type DbRow = Record<string, unknown>;
type MutationErrorStatus = Extract<MutationResult, { ok: false }>["status"];

export type AccountRequestStatus = "pending" | "completed" | "denied";
export type AccountRequestScope = "open" | "processed" | "all";

export type AccountRequest = {
  id: string;
  userId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  phone: string | null;
  comment: string | null;
  status: AccountRequestStatus;
  createdAt: string;
};

export type AccountsDashboardSummary = {
  ipaAccountsTotal: number;
  localAccountsTotal: number;
  localUserAccountsTotal: number;
  localGuestAccountsTotal: number;
  groupsTotal: number;
  ipaGroupsTotal: number;
  localGroupsTotal: number;
  openRequests: number;
  ipaExpiring30d: number;
  localUserExpiring30d: number;
  localGuestExpiring30d: number;
  overdueLocalGuests: number;
  reminderErrors: number;
  deletedLast7d: number;
  runHealthWindow: number;
  recentSyncRuns: number;
  recentSyncRunsWithFailures: number;
  recentDemotionRuns: number;
  recentDemotionRunsWithFailures: number;
  recentReminderRuns: number;
  recentReminderRunsWithFailures: number;
  lastSync: {
    createdAt: string;
    users: number;
    groups: number;
  } | null;
};

const ACTIVITY_SOURCES = [
  "auth:ipa:sync",
  "auth:ipa:backfill",
  "auth:local-user:backfill",
  "auth:guest:backfill",
  "auth:reminder:daily",
  "auth:guest:cleanup",
  "auth:lifecycle:scheduler",
] as const;

const paginateItems = <T>(items: T[], pagination?: PageParams): Paginated<T> => {
  if (!pagination) {
    return {
      items,
      page: 1,
      perPage: items.length,
      total: items.length,
      hasNext: false,
    };
  }

  const { page, perPage, offset } = paginate(pagination);
  const pagedItems = items.slice(offset, offset + perPage);
  return {
    items: pagedItems,
    page,
    perPage,
    total: items.length,
    hasNext: page * perPage < items.length,
  };
};

const toServiceError = (status: MutationErrorStatus, message: string): ServiceError => {
  if (status === 400) return err.badInput(message);
  if (status === 401) return err.unauthenticated(message);
  if (status === 403) return err.forbidden(message);
  if (status === 404) return { code: "NOT_FOUND", message, status };
  if (status === 409) return { code: "CONFLICT", message, status };
  return err.internal(message);
};

const fromMutationResult = <T>(result: MutationResult<T>): Result<T> => {
  if (result.ok) return ok(result.data);
  return fail(toServiceError(result.status, result.error));
};

const buildFreeipaWelcomeEmailHtml = async (config: { uid: string; temporaryPassword: string; accountExpires: string | null }) => {
  const template = await settings.get<string>("mail.user_welcome_freeipa");
  const contactEmail = await settings.get<string>("app.contact_email");
  const baseUrl = /^https?:\/\//.test(env.APP_URL) ? env.APP_URL : `https://${env.APP_URL}`;
  const loginUrl = `${baseUrl}/auth/login?method=ipa&ipa-uid=${encodeURIComponent(config.uid)}`;
  const expiry = config.accountExpires ? dates.formatDate(config.accountExpires) : "";

  return renderTemplate(template, {
    USERNAME: config.uid,
    PASSWORD: config.temporaryPassword,
    EXPIRY: expiry,
    LOGIN_URL: loginUrl,
    CONTACT_EMAIL: contactEmail,
    APP_NAME: await settings.get<string>("app.name"),
  });
};

const buildLocalWelcomeEmailHtml = async (config: { email: string; accountExpires: string | null }) => {
  const template = await settings.get<string>("mail.user_welcome_local");
  const contactEmail = await settings.get<string>("app.contact_email");
  const baseUrl = /^https?:\/\//.test(env.APP_URL) ? env.APP_URL : `https://${env.APP_URL}`;
  const loginUrl = `${baseUrl}/auth/login`;
  const expiry = config.accountExpires ? dates.formatDate(config.accountExpires) : "";

  return renderTemplate(template, {
    EMAIL: config.email,
    EXPIRY: expiry,
    LOGIN_URL: loginUrl,
    CONTACT_EMAIL: contactEmail,
    APP_NAME: await settings.get<string>("app.name"),
  });
};

const mapAccountRequestRow = (row: DbRow): AccountRequest => ({
  id: row.id as string,
  userId: row.user_id as string | null,
  email: (row.email as string) ?? "",
  firstName: (row.first_name as string) ?? "",
  lastName: (row.last_name as string) ?? "",
  displayName: (row.display_name as string) ?? null,
  phone: (row.phone as string) ?? null,
  comment: row.comment as string | null,
  status: row.status as AccountRequestStatus,
  createdAt: (row.created_at as Date).toISOString(),
});

const mapSummary = (row: DbRow): AccountsDashboardSummary => {
  const lastSyncCreatedAt = row.last_sync_created_at as Date | null;

  return {
    ipaAccountsTotal: Number(row.ipa_accounts_total ?? 0),
    localAccountsTotal: Number(row.local_accounts_total ?? 0),
    localUserAccountsTotal: Number(row.local_user_accounts_total ?? 0),
    localGuestAccountsTotal: Number(row.local_guest_accounts_total ?? 0),
    groupsTotal: Number(row.groups_total ?? 0),
    ipaGroupsTotal: Number(row.ipa_groups_total ?? 0),
    localGroupsTotal: Number(row.local_groups_total ?? 0),
    openRequests: Number(row.open_requests ?? 0),
    ipaExpiring30d: Number(row.ipa_expiring_30d ?? 0),
    localUserExpiring30d: Number(row.local_user_expiring_30d ?? 0),
    localGuestExpiring30d: Number(row.local_guest_expiring_30d ?? 0),
    overdueLocalGuests: Number(row.overdue_local_guests ?? 0),
    reminderErrors: Number(row.reminder_errors ?? 0),
    deletedLast7d: Number(row.deleted_last_7d ?? 0),
    runHealthWindow: Number(row.run_health_window ?? 10),
    recentSyncRuns: Number(row.recent_sync_runs ?? 0),
    recentSyncRunsWithFailures: Number(row.recent_sync_runs_with_failures ?? 0),
    recentDemotionRuns: Number(row.recent_demotion_runs ?? 0),
    recentDemotionRunsWithFailures: Number(row.recent_demotion_runs_with_failures ?? 0),
    recentReminderRuns: Number(row.recent_reminder_runs ?? 0),
    recentReminderRunsWithFailures: Number(row.recent_reminder_runs_with_failures ?? 0),
    lastSync: lastSyncCreatedAt
      ? {
          createdAt: lastSyncCreatedAt.toISOString(),
          users: Number(row.last_sync_users ?? 0),
          groups: Number(row.last_sync_groups ?? 0),
        }
      : null,
  };
};

const appLog = logger("accounts:app");

const buildAccountRequestWhereClause = (config: {
  access: { userId: string; isAdmin: boolean };
  filter?: { status?: AccountRequestStatus; scope?: AccountRequestScope };
}) => {
  if (!config.access.isAdmin) {
    return sql`r.user_id = ${config.access.userId}::uuid AND r.status = 'pending'`;
  }

  if (config.filter?.status) {
    return sql`r.status = ${config.filter.status}`;
  }

  const scope = config.filter?.scope ?? "open";
  if (scope === "processed") return sql`r.status IN ('completed', 'denied')`;
  if (scope === "all") return sql`TRUE`;
  return sql`r.status = 'pending'`;
};

export const accountsAppService = {
  user: {
    list: async (config: {
      pagination?: PageParams;
      filter?: { search?: string };
      scope?: { ids?: string[]; uids?: string[]; provider?: UserProvider; profile?: UserProfile };
    }): Promise<Paginated<BaseUser>> => {
      const { page, perPage } = paginate(config.pagination);
      const result = await users.list({
        page,
        perPage,
        search: config.filter?.search,
        ids: config.scope?.ids,
        uids: config.scope?.uids,
        provider: config.scope?.provider,
        profile: config.scope?.profile,
      });

      return {
        items: result.users,
        page,
        perPage,
        total: result.total,
        hasNext: result.pagination.has_next,
      };
    },
    get: async (config: { id: string } | { uid: string }): Promise<User | null> => users.get(config),
    getMinimal: async (config: { id: string } | { uid: string }) => users.getMinimal(config),
    group: {
      list: async (config: {
        userId: string;
        recursive?: boolean;
        pagination?: PageParams;
        filter?: { query?: string };
      }): Promise<Paginated<string>> => {
        const userGroups = await users.getGroups({
          id: config.userId,
          recursive: config.recursive,
        });
        const query = config.filter?.query?.trim().toLowerCase();
        const filtered = query ? userGroups.filter((groupName) => groupName.toLowerCase().includes(query)) : userGroups;
        return paginateItems(filtered, config.pagination);
      },
    },
    groupId: {
      list: async (config: { userId: string; recursive?: boolean }): Promise<string[]> =>
        users.getGroupIds({
          id: config.userId,
          recursive: config.recursive,
        }),
    },
    managedGroup: {
      list: async (config: {
        userId: string;
        recursive?: boolean;
        pagination?: PageParams;
        filter?: { query?: string };
      }): Promise<Paginated<string>> => {
        const managedGroups = await users.getManagedGroups({
          id: config.userId,
          recursive: config.recursive,
        });
        const query = config.filter?.query?.trim().toLowerCase();
        const filtered = query ? managedGroups.filter((groupName) => groupName.toLowerCase().includes(query)) : managedGroups;
        return paginateItems(filtered, config.pagination);
      },
    },
    create: async (config: { ipaSession?: string | null; data: CreateUserInput; processedBy: string }) => {
      const createResult = fromMutationResult(
        await users.create({
          ipaSession: config.ipaSession,
          data: {
            ...config.data,
            profile: config.data.provider === "ipa" ? "user" : config.data.profile,
            admin: config.data.provider === "local" ? config.data.admin : undefined,
          },
        }),
      );
      if (!createResult.ok) return createResult;

      const created = createResult.data;
      const autoSend = config.data.autoSendNotification ?? true;
      if (autoSend && created.user.mail) {
        if (config.data.provider === "ipa" && created.temporaryPassword) {
          const appName = await settings.get<string>("app.name");
          await notifications.send({
            type: "email",
            recipient: created.user.mail,
            subject: `Welcome to ${appName}`,
            rawHtml: await buildFreeipaWelcomeEmailHtml({
              uid: created.user.uid,
              temporaryPassword: created.temporaryPassword,
              accountExpires: created.user.accountExpires,
            }),
            autoSend,
          });
        } else if (config.data.provider === "local") {
          const appName = await settings.get<string>("app.name");
          await notifications.send({
            type: "email",
            recipient: created.user.mail,
            subject: `Welcome to ${appName}`,
            rawHtml: await buildLocalWelcomeEmailHtml({
              email: created.user.mail,
              accountExpires: created.user.accountExpires,
            }),
            autoSend,
          });
        }
      }

      if (config.data.requestId) {
        await sql`
          UPDATE auth.account_requests
          SET status = 'completed', processed_at = now(), processed_by = ${config.processedBy}
          WHERE id = ${config.data.requestId} AND status = 'pending'
        `;
      }

      return ok({
        id: created.user.id,
        uid: created.user.uid,
        accountExpires: created.user.accountExpires,
        notificationSent: autoSend,
      });
    },
    update: async (config: { ipaSession?: string | null; id: string; data: Parameters<typeof users.update>[0]["data"] }) =>
      fromMutationResult(await users.update(config)),
    resetPassword: async (config: { ipaSession: string; id: string }) =>
      fromMutationResult(await users.resetPassword(config)),
    setExpiry: async (config: { ipaSession?: string | null; id: string; expiryDate: string | null }) =>
      fromMutationResult(await users.setExpiry(config)),
    setProfile: async (config: { id: string; profile: UserProfile }) =>
      fromMutationResult(await users.setProfile(config)),
    setAdmin: async (config: { id: string; admin: boolean }) =>
      fromMutationResult(await users.setAdmin(config)),
    switchProvider: async (config: { ipaSession: string; id: string; provider: UserProvider }) =>
      fromMutationResult(await users.switchProvider(config)),
    demoteToGuest: async (config: { ipaSession: string; id: string; actor: { userId: string; uid: string } }) =>
      fromMutationResult(await users.demoteToGuest(config)),
    sendLoginLink: async (config: { id: string }) => fromMutationResult(await users.sendLoginLink(config)),
    createLoginToken: async (config: { id: string }) => fromMutationResult(await users.createLoginToken(config)),
    remove: async (config: { ipaSession?: string | null; id: string; actor: { userId: string; uid: string } }) =>
      fromMutationResult(await users.remove(config)),
  },

  group: {
    list: async (config: {
      pagination?: PageParams;
      filter?: { search?: string };
      scope?: { userId?: string; ids?: string[]; provider?: UserProvider; mode?: "all" | "member" | "managed" };
    }): Promise<Paginated<BaseGroup>> => {
      const { page, perPage } = paginate(config.pagination);
      const result = await groups.list({
        page,
        perPage,
        search: config.filter?.search,
        userId: config.scope?.userId,
        scope: config.scope?.mode,
        ids: config.scope?.ids,
        provider: config.scope?.provider,
      });

      return {
        items: result.groups,
        page,
        perPage,
        total: result.total,
        hasNext: result.pagination.hasNext,
      };
    },
    get: async (config: { id: string }) => groups.get(config),
    member: {
      list: async (config: {
        id: string;
        recursive?: boolean;
        pagination?: PageParams;
        filter?: { query?: string; type?: GroupMember["type"] };
      }): Promise<Paginated<GroupMember>> => {
        const members = await groups.getMembers({
          id: config.id,
          recursive: config.recursive,
        });
        const query = config.filter?.query?.trim().toLowerCase();
        const type = config.filter?.type;
        const filtered = members.filter((member) => {
          if (type && member.type !== type) return false;
          if (!query) return true;
          const id = member.id.toLowerCase();
          const displayName = (member.displayName ?? "").toLowerCase();
          return id.includes(query) || displayName.includes(query);
        });
        return paginateItems(filtered, config.pagination);
      },
      add: async (config: { ipaSession?: string | null; id: string; provider?: UserProvider; userId?: string; groupId?: string }) =>
        fromMutationResult(
          await groups.addMember({
            ipaSession: config.ipaSession,
            id: config.id,
            provider: config.provider,
            user: config.userId,
            group: config.groupId,
          }),
        ),
      remove: async (config: { ipaSession?: string | null; id: string; provider?: UserProvider; userId?: string; groupId?: string }) =>
        fromMutationResult(
          await groups.removeMember({
            ipaSession: config.ipaSession,
            id: config.id,
            provider: config.provider,
            user: config.userId,
            group: config.groupId,
          }),
        ),
    },
    manager: {
      list: async (config: {
        id: string;
        pagination?: PageParams;
        filter?: { query?: string; type?: GroupMember["type"] };
      }): Promise<Paginated<GroupMember>> => {
        const managers = await groups.getManagers({ id: config.id });
        const query = config.filter?.query?.trim().toLowerCase();
        const type = config.filter?.type;
        const filtered = managers.filter((manager) => {
          if (type && manager.type !== type) return false;
          if (!query) return true;
          const id = manager.id.toLowerCase();
          const displayName = (manager.displayName ?? "").toLowerCase();
          return id.includes(query) || displayName.includes(query);
        });
        return paginateItems(filtered, config.pagination);
      },
      add: async (config: { ipaSession?: string | null; id: string; provider?: UserProvider; userId?: string; groupId?: string }) =>
        fromMutationResult(
          await groups.addManager({
            ipaSession: config.ipaSession,
            id: config.id,
            provider: config.provider,
            user: config.userId,
            group: config.groupId,
          }),
        ),
      remove: async (config: { ipaSession?: string | null; id: string; provider?: UserProvider; userId?: string; groupId?: string }) =>
        fromMutationResult(
          await groups.removeManager({
            ipaSession: config.ipaSession,
            id: config.id,
            provider: config.provider,
            user: config.userId,
            group: config.groupId,
          }),
        ),
    },
    parent: {
      list: async (config: {
        id: string;
        recursive?: boolean;
        pagination?: PageParams;
        filter?: { query?: string };
      }): Promise<Paginated<string>> => {
        const parentGroups = await groups.getParents({
          id: config.id,
          recursive: config.recursive,
        });
        const query = config.filter?.query?.trim().toLowerCase();
        const filtered = query ? parentGroups.filter((groupId) => groupId.toLowerCase().includes(query)) : parentGroups;
        return paginateItems(filtered, config.pagination);
      },
    },
    managedGroup: {
      list: async (config: { id: string; pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<string>> => {
        const managedGroups = await groups.getManagedGroups({ id: config.id });
        const query = config.filter?.query?.trim().toLowerCase();
        const filtered = query ? managedGroups.filter((groupId) => groupId.toLowerCase().includes(query)) : managedGroups;
        return paginateItems(filtered, config.pagination);
      },
    },
    create: async (config: { ipaSession?: string | null; provider: UserProvider; name: string; description?: string; posix?: boolean }) =>
      fromMutationResult(await groups.create(config)),
    update: async (config: { ipaSession?: string | null; id: string; provider?: UserProvider; description: string }) =>
      fromMutationResult(await groups.update(config)),
    remove: async (config: { ipaSession?: string | null; id: string; provider?: UserProvider }) =>
      fromMutationResult(await groups.remove(config)),
    makePosix: async (config: { ipaSession?: string | null; id: string; provider?: UserProvider }) =>
      fromMutationResult(await groups.makePosix(config)),
  },
  entity: {
    list: async (config: {
      pagination?: PageParams;
      search?: string;
      kinds?: EntityKind[];
      provider?: UserProvider;
      profile?: UserProfile;
      excludeUserIds?: string[];
      excludeGroupIds?: string[];
      userMemberOfGroupIds?: string[];
      memberOfGroupId?: string;
      managerOfGroupId?: string;
      parentGroupId?: string;
      managedByUserId?: string;
      recursive?: boolean;
    }): Promise<Paginated<EntityListItem>> => {
      const { page, perPage } = paginate(config.pagination);
      const result = await entities.list({
        search: config.search,
        kinds: config.kinds,
        provider: config.provider,
        profile: config.profile,
        excludeUserIds: config.excludeUserIds,
        excludeGroupIds: config.excludeGroupIds,
        userMemberOfGroupIds: config.userMemberOfGroupIds,
        memberOfGroupId: config.memberOfGroupId,
        managerOfGroupId: config.managerOfGroupId,
        parentGroupId: config.parentGroupId,
        managedByUserId: config.managedByUserId,
        recursive: config.recursive,
        page,
        perPage,
      });

      return {
        items: result.items,
        page,
        perPage,
        total: result.total,
        hasNext: result.pagination.hasNext,
      };
    },
  },

  accountRequest: {
    list: async (config: {
      access: { userId: string; isAdmin: boolean };
      pagination?: PageParams;
      filter?: { status?: AccountRequestStatus; scope?: AccountRequestScope };
    }): Promise<Paginated<AccountRequest>> => {
      const { page, perPage, offset } = paginate(config.pagination);
      const where = buildAccountRequestWhereClause(config);
      const rows = await sql`
        SELECT r.id, r.user_id, u.mail AS email, u.given_name AS first_name, u.sn AS last_name,
               u.display_name, r.phone, r.comment, r.status, r.created_at
        FROM auth.account_requests r
        JOIN auth.users u ON u.id = r.user_id
        WHERE ${where}
        ORDER BY r.created_at DESC
        LIMIT ${perPage}
        OFFSET ${offset}
      `;

      const totalRows = await sql`
        SELECT COUNT(*)::int AS total
        FROM auth.account_requests r
        WHERE ${where}
      `;

      const total = totalRows[0]?.total ?? 0;
      return {
        items: rows.map(mapAccountRequestRow),
        page,
        perPage,
        total,
        hasNext: page * perPage < total,
      };
    },
    get: async (config: { id: string; access: { userId: string; isAdmin: boolean } }) => {
      const rows: DbRow[] = await sql`
        SELECT r.id, r.user_id, u.mail AS email, u.given_name AS first_name, u.sn AS last_name,
               u.display_name, r.phone, r.comment, r.status, r.created_at
        FROM auth.account_requests r
        JOIN auth.users u ON u.id = r.user_id
        WHERE r.id = ${config.id}
      `;

      if (rows.length === 0) {
        return fail(err.notFound("Request"));
      }

      const request = rows[0]!;
      if (!config.access.isAdmin && request.user_id !== config.access.userId) {
        return fail(err.forbidden("Access denied"));
      }

      return ok(mapAccountRequestRow(request));
    },
    getPendingForUser: async (config: { userId: string }): Promise<{ id: string; createdAt: Date } | null> => {
      const rows: DbRow[] = await sql`
        SELECT id, created_at FROM auth.account_requests
        WHERE user_id = ${config.userId} AND status = 'pending'
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      return {
        id: rows[0]!.id as string,
        createdAt: rows[0]!.created_at as Date,
      };
    },
    create: async (config: { user: Pick<User, "id" | "mail" | "provider">; data: { phone?: string; comment?: string; acceptedAgb: true } }) => {
      if (!getFreeIpaConfigSync().enabled) {
        return fail(err.badInput("FreeIPA is disabled"));
      }
      if (config.user.provider !== "local") {
        return fail(err.forbidden("Only local accounts can request IPA-backed access"));
      }
      if (!config.user.mail) {
        return fail(err.badInput("Your account has no email address"));
      }

      const existingRows: DbRow[] = await sql`
        SELECT id FROM auth.account_requests
        WHERE user_id = ${config.user.id} AND status = 'pending'
      `;
      if (existingRows.length > 0) {
        return fail({
          code: "CONFLICT",
          message: "You already have a pending account request",
          status: 409,
        });
      }

      const rows: DbRow[] = await sql`
        INSERT INTO auth.account_requests (id, user_id, phone, comment, accepted_agb)
        VALUES (gen_random_uuid(), ${config.user.id}, ${config.data.phone ?? null}, ${config.data.comment ?? null}, ${config.data.acceptedAgb})
        RETURNING id
      `;

      return ok({
        id: rows[0]!.id as string,
        message: "FreeIPA account request submitted",
      });
    },
    withdraw: async (config: { id: string; userId: string }) => {
      const rows: DbRow[] = await sql`
        SELECT id, user_id, status FROM auth.account_requests WHERE id = ${config.id}
      `;

      if (rows.length === 0) return fail(err.notFound("Request"));
      const request = rows[0]!;
      if (request.user_id !== config.userId) return fail(err.forbidden("Access denied"));
      if (request.status !== "pending") return fail(err.forbidden("Only pending requests can be withdrawn"));

      await sql`DELETE FROM auth.account_requests WHERE id = ${config.id}`;
      return ok();
    },
    deny: async (config: { id: string; reason?: string; processedBy: string }) => {
      const rows: DbRow[] = await sql`
        SELECT r.id, r.user_id, r.status, u.mail AS email, u.given_name AS first_name
        FROM auth.account_requests r
        JOIN auth.users u ON u.id = r.user_id
        WHERE r.id = ${config.id}
      `;

      if (rows.length === 0) return fail(err.notFound("Request"));

      const request = rows[0]!;
      if (request.status !== "pending") return fail(err.badInput("Only pending requests can be denied"));

      await sql`
        UPDATE auth.account_requests
        SET status = 'denied', denied_reason = ${config.reason ?? null}, processed_at = now(), processed_by = ${config.processedBy}
        WHERE id = ${config.id}
      `;

      if (config.reason) {
        const template = await settings.get<string>("mail.account_request_denial");
        const contactEmail = await settings.get<string>("app.contact_email");
        const appName = await settings.get<string>("app.name");

        await notifications.send({
          type: "email",
          recipient: request.email as string,
          subject: "Account Request Update",
          rawHtml: renderTemplate(template, {
            FIRST_NAME: request.first_name as string,
            REASON: config.reason,
            CONTACT_EMAIL: contactEmail,
            APP_NAME: appName,
          }),
          autoSend: true,
          sentBy: config.processedBy,
        });
      }

      return ok();
    },
  },

  dashboard: {
    get: async (): Promise<AccountsDashboardSummary> => {
      const rows = await sql<DbRow[]>`
        WITH latest_sync AS (
          SELECT created_at, metadata
          FROM logging.entries
          WHERE source = 'auth:ipa:sync'
            AND message = 'Sync complete'
          ORDER BY created_at DESC
          LIMIT 1
        ),
        recent_sync_runs AS (
          SELECT message, metadata
          FROM logging.entries
          WHERE source = 'auth:ipa:sync'
            AND message IN ('Sync complete', 'Sync step failed', 'Expired IPA demotion step failed')
          ORDER BY created_at DESC
          LIMIT 10
        ),
        recent_demotion_runs AS (
          SELECT metadata
          FROM logging.entries
          WHERE source = 'auth:ipa:sync'
            AND message = 'Expired IPA demotion complete'
          ORDER BY created_at DESC
          LIMIT 10
        ),
        recent_reminder_runs AS (
          SELECT metadata
          FROM logging.entries
          WHERE source = 'auth:reminder:daily'
            AND message = 'Reminder run complete'
          ORDER BY created_at DESC
          LIMIT 10
        )
        SELECT
          (SELECT COUNT(*)::int FROM auth.users WHERE provider = 'ipa') AS ipa_accounts_total,
          (SELECT COUNT(*)::int FROM auth.users WHERE provider = 'local') AS local_accounts_total,
          (SELECT COUNT(*)::int FROM auth.users WHERE provider = 'local' AND profile = 'user') AS local_user_accounts_total,
          (SELECT COUNT(*)::int FROM auth.users WHERE provider = 'local' AND profile = 'guest') AS local_guest_accounts_total,
          (SELECT COUNT(*)::int FROM auth.groups) AS groups_total,
          (SELECT COUNT(*)::int FROM auth.groups WHERE provider = 'ipa') AS ipa_groups_total,
          (SELECT COUNT(*)::int FROM auth.groups WHERE provider = 'local') AS local_groups_total,
          (SELECT COUNT(*)::int FROM auth.account_requests WHERE status = 'pending') AS open_requests,
          (
            SELECT COUNT(*)::int
            FROM auth.users
            WHERE provider = 'ipa'
              AND account_expires IS NOT NULL
              AND account_expires > now()
              AND account_expires <= now() + interval '30 days'
          ) AS ipa_expiring_30d,
          (
            SELECT COUNT(*)::int
            FROM auth.users
            WHERE provider = 'local'
              AND profile = 'guest'
              AND account_expires IS NOT NULL
              AND account_expires > now()
              AND account_expires <= now() + interval '30 days'
          ) AS local_guest_expiring_30d,
          (
            SELECT COUNT(*)::int
            FROM auth.users
            WHERE provider = 'local'
              AND profile = 'user'
              AND account_expires IS NOT NULL
              AND account_expires > now()
              AND account_expires <= now() + interval '30 days'
          ) AS local_user_expiring_30d,
          (
            SELECT COUNT(*)::int
            FROM auth.users
            WHERE provider = 'local'
              AND profile = 'guest'
              AND account_expires IS NOT NULL
              AND account_expires <= now()
          ) AS overdue_local_guests,
          (SELECT COUNT(*)::int FROM auth.account_lifecycle_reminders WHERE status = 'error') AS reminder_errors,
          (SELECT COUNT(*)::int FROM auth.deleted_accounts WHERE deleted_at >= now() - interval '7 days') AS deleted_last_7d,
          10 AS run_health_window,
          (SELECT COUNT(*)::int FROM recent_sync_runs) AS recent_sync_runs,
          (
            SELECT COUNT(*)::int
            FROM recent_sync_runs
            WHERE message <> 'Sync complete'
          ) AS recent_sync_runs_with_failures,
          (SELECT COUNT(*)::int FROM recent_demotion_runs) AS recent_demotion_runs,
          (
            SELECT COUNT(*)::int
            FROM recent_demotion_runs
            WHERE COALESCE((metadata->>'failed')::int, 0) > 0
          ) AS recent_demotion_runs_with_failures,
          (SELECT COUNT(*)::int FROM recent_reminder_runs) AS recent_reminder_runs,
          (
            SELECT COUNT(*)::int
            FROM recent_reminder_runs
            WHERE COALESCE((metadata->>'failed')::int, 0) > 0
          ) AS recent_reminder_runs_with_failures,
          (SELECT created_at FROM latest_sync) AS last_sync_created_at,
          COALESCE((SELECT COALESCE((metadata->>'activeUsersSynced')::int, (metadata->>'users')::int) FROM latest_sync), 0) AS last_sync_users,
          COALESCE((SELECT COALESCE((metadata->>'groupsSynced')::int, (metadata->>'groups')::int) FROM latest_sync), 0) AS last_sync_groups
      `;
      return mapSummary(rows[0] ?? {});
    },
    activity: async (): Promise<LogEntry[]> => {
      const result = await logging.list(
        { page: 1, perPage: 15, offset: 0 },
        { sources: [...ACTIVITY_SOURCES] },
      );
      return result.entries;
    },
  },

  lifecycle: {
    deletedAccounts: { list: accountLifecycle.listDeletedAccounts },
    reminders: { list: accountLifecycle.listReminderAudit },
  },

  jobs: {
    runSync: async (): Promise<string> => lifecycleJobs.submitIpaSync(),
    runIpaBackfill: async (): Promise<string> => lifecycleJobs.submitIpaBackfill(),
    runLocalUserBackfill: async (): Promise<string> => lifecycleJobs.submitLocalUserBackfill(),
    runGuestBackfill: async (): Promise<string> => lifecycleJobs.submitGuestBackfill(),
    runReminders: async (): Promise<string> => lifecycleJobs.submitReminderRun(),
  },
} as const;

export type AccountsAppService = typeof accountsAppService;
export type AccountsDashboardActivityEntry = LogEntry;
export { ACTIVITY_SOURCES };
