import { sql } from "bun";
import { env } from "@valentinkolb/cloud/core/config";
import { ipa } from "@valentinkolb/cloud/core/services";
import { notifications } from "@valentinkolb/cloud/core/services";
import * as settings from "@valentinkolb/cloud/core/services";
import { renderTemplate } from "@valentinkolb/cloud/core/services";
import { ok, paginate, type PageParams, type Paginated } from "@valentinkolb/cloud/lib/server";
import type { BaseUser, CreateUser, SessionUser } from "@/accounts/contracts";
import { fromMutationResult, paginateItems } from "./shared";

type UserRealm = "ipa" | "ipa-limited" | "guest";

type CreateUserOutput = {
  id: string;
  uid: string;
  accountExpires: string | null;
  notificationSent: boolean;
};

/**
 * Renders the welcome email HTML including login URL, temporary password, expiry and contact info.
 */
const buildWelcomeEmailHtml = async (config: { uid: string; temporaryPassword: string; accountExpires: string | null }) => {
  const template = await settings.get<string>("user.login.welcome_email");
  const contactEmail = await settings.get<string>("app.contact_email");

  const baseUrl = /^https?:\/\//.test(env.APP_URL) ? env.APP_URL : `https://${env.APP_URL}`;
  const loginUrl = `${baseUrl}/auth/login?method=ipa&ipa-uid=${encodeURIComponent(config.uid)}`;

  const expiry = config.accountExpires
    ? new Date(config.accountExpires).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return renderTemplate(template, {
    USERNAME: config.uid,
    PASSWORD: config.temporaryPassword,
    EXPIRY: expiry,
    LOGIN_URL: loginUrl,
    CONTACT_EMAIL: contactEmail,
    APP_NAME: await settings.get<string>("app.name"),
  });
};

export const usersService = {
  /**
   * Lists users from IPA/local projection with optional pagination, search and scope filters.
   */
  list: async (config: {
    pagination?: PageParams;
    filter?: { search?: string };
    scope?: { uids?: string[]; realms?: UserRealm | UserRealm[] };
  }): Promise<Paginated<BaseUser>> => {
    const { page, perPage } = paginate(config.pagination);
    const result = await ipa.users.list({
      page,
      perPage,
      search: config.filter?.search,
      uids: config.scope?.uids,
      realm: config.scope?.realms,
    });

    return {
      items: result.users,
      page,
      perPage,
      total: result.total,
      hasNext: result.pagination.has_next,
    };
  },
  /**
   * Fetches one user by either UUID or UID.
   */
  get: async (config: { id: string } | { uid: string }): Promise<SessionUser | null> => ipa.users.get(config),
  group: {
    /**
     * Lists group memberships for a user (direct or recursive) with optional in-memory filtering.
     */
    list: async (config: {
      userId: string;
      recursive?: boolean;
      pagination?: PageParams;
      filter?: { query?: string };
    }): Promise<Paginated<string>> => {
      const groups = await ipa.users.getGroups({
        id: config.userId,
        recursive: config.recursive,
      });
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered = query && query.length > 0 ? groups.filter((groupCn) => groupCn.toLowerCase().includes(query)) : groups;
      return paginateItems(filtered, config.pagination);
    },
  },
  managedGroup: {
    /**
     * Lists groups a user can manage (direct or recursive) with optional in-memory filtering.
     */
    list: async (config: {
      userId: string;
      recursive?: boolean;
      pagination?: PageParams;
      filter?: { query?: string };
    }): Promise<Paginated<string>> => {
      const groups = await ipa.users.getManagedGroups({
        id: config.userId,
        recursive: config.recursive,
      });
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered = query && query.length > 0 ? groups.filter((groupCn) => groupCn.toLowerCase().includes(query)) : groups;
      return paginateItems(filtered, config.pagination);
    },
  },
  /**
   * Creates an IPA user and queues/sends onboarding notification.
   * If requestId is provided, the matching account request is marked as completed.
   */
  create: async (config: { ipaSession: string; data: CreateUser; processedBy: string }) => {
    const createResult = fromMutationResult(
      await ipa.users.addIpa({
        ipaSession: config.ipaSession,
        data: config.data,
      }),
    );
    if (!createResult.ok) return createResult;

    const created = createResult.data;
    const autoSend = config.data.autoSendNotification ?? true;
    const appName = await settings.get<string>("app.name");

    await notifications.send({
      type: "email",
      recipient: config.data.email,
      subject: `Welcome to ${appName}`,
      rawHtml: await buildWelcomeEmailHtml({
        uid: created.uid,
        temporaryPassword: created._temporaryPassword,
        accountExpires: created.accountExpires,
      }),
      autoSend,
    });

    if (config.data.requestId) {
      await sql`
        UPDATE auth.account_requests
        SET status = 'completed', processed_at = now(), processed_by = ${config.processedBy}
        WHERE id = ${config.data.requestId} AND status = 'pending'
      `;
    }

    return ok<CreateUserOutput>({
      id: created.id,
      uid: created.uid,
      accountExpires: created.accountExpires,
      notificationSent: autoSend,
    });
  },
  /**
   * Updates mutable profile fields for one user.
   */
  update: async (config: { ipaSession?: string | null; id: string; data: Parameters<typeof ipa.users.updateProfile>[0]["data"] }) =>
    fromMutationResult(
      await ipa.users.updateProfile({
        ipaSession: config.ipaSession,
        id: config.id,
        data: config.data,
      }),
    ),
  /**
   * Resets a user's password to a temporary value.
   */
  resetPassword: async (config: { ipaSession: string; id: string }) =>
    fromMutationResult(
      await ipa.users.resetPassword({
        ipaSession: config.ipaSession,
        id: config.id,
      }),
    ),
  /**
   * Sets or removes account expiry.
   */
  setExpiry: async (config: { ipaSession: string; id: string; expiryDate: string | null }) =>
    fromMutationResult(
      await ipa.users.setExpiry({
        ipaSession: config.ipaSession,
        id: config.id,
        expiryDate: config.expiryDate,
      }),
    ),
  /**
   * Converts an IPA account into a guest account while preserving local identity.
   */
  demoteToGuest: async (config: { ipaSession: string; id: string }) =>
    fromMutationResult(
      await ipa.users.demoteToGuest({
        ipaSession: config.ipaSession,
        id: config.id,
      }),
    ),
  /**
   * Permanently removes a user.
   */
  remove: async (config: { ipaSession?: string | null; id: string }) =>
    fromMutationResult(
      await ipa.users.delete({
        ipaSession: config.ipaSession,
        id: config.id,
      }),
    ),
};

export type UsersService = typeof usersService;
