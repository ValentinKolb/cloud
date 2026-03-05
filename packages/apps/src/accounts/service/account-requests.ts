import { sql } from "bun";
import { notifications } from "@valentinkolb/cloud/core/services";
import * as settings from "@valentinkolb/cloud/core/services";
import { renderTemplate } from "@valentinkolb/cloud/core/services";
import { err, fail, ok, paginate, type PageParams, type Paginated } from "@valentinkolb/cloud/lib/server";
import { hasRole, type SessionUser } from "@/accounts/contracts";

type DbRow = Record<string, unknown>;

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

/**
 * Normalizes joined account-request rows into the `AccountRequest` DTO consumed by UI/API.
 */
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

export const accountRequestsService = {
  /**
   * Lists account requests based on caller scope:
   * admins can filter by status, non-admins only see their own pending request(s).
   */
  list: async (config: {
    access: { userId: string; isAdmin: boolean };
    pagination?: PageParams;
    filter?: { status?: AccountRequestStatus; scope?: AccountRequestScope };
  }): Promise<Paginated<AccountRequest>> => {
    const { page, perPage, offset } = paginate(config.pagination);
    let rows: DbRow[] = [];
    let totalRows: Array<{ total: number }> = [];

    if (config.access.isAdmin) {
      const status = config.filter?.status;
      const scope = config.filter?.scope ?? "open";

      if (status) {
        rows = await sql`
          SELECT r.id, r.user_id, u.mail AS email, u.given_name AS first_name, u.sn AS last_name,
                 u.display_name, u.phone, r.comment, r.status, r.created_at
          FROM auth.account_requests r
          JOIN auth.users u ON u.id = r.user_id
          WHERE r.status = ${status}
          ORDER BY r.created_at DESC
          LIMIT ${perPage}
          OFFSET ${offset}
        `;

        totalRows = await sql`
          SELECT COUNT(*)::int AS total
          FROM auth.account_requests r
          WHERE r.status = ${status}
        `;
      } else if (scope === "processed") {
        rows = await sql`
          SELECT r.id, r.user_id, u.mail AS email, u.given_name AS first_name, u.sn AS last_name,
                 u.display_name, u.phone, r.comment, r.status, r.created_at
          FROM auth.account_requests r
          JOIN auth.users u ON u.id = r.user_id
          WHERE r.status IN ('completed', 'denied')
          ORDER BY r.created_at DESC
          LIMIT ${perPage}
          OFFSET ${offset}
        `;

        totalRows = await sql`
          SELECT COUNT(*)::int AS total
          FROM auth.account_requests r
          WHERE r.status IN ('completed', 'denied')
        `;
      } else if (scope === "all") {
        rows = await sql`
          SELECT r.id, r.user_id, u.mail AS email, u.given_name AS first_name, u.sn AS last_name,
                 u.display_name, u.phone, r.comment, r.status, r.created_at
          FROM auth.account_requests r
          JOIN auth.users u ON u.id = r.user_id
          ORDER BY r.created_at DESC
          LIMIT ${perPage}
          OFFSET ${offset}
        `;

        totalRows = await sql`
          SELECT COUNT(*)::int AS total
          FROM auth.account_requests r
        `;
      } else {
        rows = await sql`
          SELECT r.id, r.user_id, u.mail AS email, u.given_name AS first_name, u.sn AS last_name,
                 u.display_name, u.phone, r.comment, r.status, r.created_at
          FROM auth.account_requests r
          JOIN auth.users u ON u.id = r.user_id
          WHERE r.status = 'pending'
          ORDER BY r.created_at DESC
          LIMIT ${perPage}
          OFFSET ${offset}
        `;

        totalRows = await sql`
          SELECT COUNT(*)::int AS total
          FROM auth.account_requests r
          WHERE r.status = 'pending'
        `;
      }
    } else {
      rows = await sql`
        SELECT r.id, r.user_id, u.mail AS email, u.given_name AS first_name, u.sn AS last_name,
               u.display_name, u.phone, r.comment, r.status, r.created_at
        FROM auth.account_requests r
        JOIN auth.users u ON u.id = r.user_id
        WHERE r.user_id = ${config.access.userId} AND r.status = 'pending'
        ORDER BY r.created_at DESC
        LIMIT ${perPage}
        OFFSET ${offset}
      `;

      totalRows = await sql`
        SELECT COUNT(*)::int AS total
        FROM auth.account_requests r
        WHERE r.user_id = ${config.access.userId} AND r.status = 'pending'
      `;
    }

    const total = totalRows[0]?.total ?? 0;
    return {
      items: rows.map(mapAccountRequestRow),
      page,
      perPage,
      total,
      hasNext: page * perPage < total,
    };
  },
  /**
   * Returns one request when caller is allowed to access it.
   * Non-admin callers are restricted to their own request IDs.
   */
  get: async (config: { id: string; access: { userId: string; isAdmin: boolean } }) => {
    const rows: DbRow[] = await sql`
      SELECT r.id, r.user_id, u.mail AS email, u.given_name AS first_name, u.sn AS last_name,
             u.display_name, u.phone, r.comment, r.status, r.created_at
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
  /**
   * Returns the currently pending request for a user, if one exists.
   */
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
  /**
   * Creates a guest-originated account request.
   * Assumes guests are identified by role and email is already present on the local user row.
   */
  create: async (config: { user: Pick<SessionUser, "id" | "mail" | "roles">; data: { comment?: string; acceptedAgb: true } }) => {
    if (!hasRole(config.user, "guest")) {
      return fail(err.forbidden("Only guest users can request accounts"));
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
      INSERT INTO auth.account_requests (user_id, comment, accepted_agb)
      VALUES (${config.user.id}, ${config.data.comment ?? null}, ${config.data.acceptedAgb})
      RETURNING id
    `;

    return ok({
      id: rows[0]!.id as string,
      message: "Account request submitted",
    });
  },
  /**
   * Withdraws a pending request for its owner.
   * Completed/denied requests cannot be withdrawn.
   */
  withdraw: async (config: { id: string; userId: string }) => {
    const rows: DbRow[] = await sql`
      SELECT id, user_id, status FROM auth.account_requests WHERE id = ${config.id}
    `;

    if (rows.length === 0) {
      return fail(err.notFound("Request"));
    }

    const request = rows[0]!;
    if (request.user_id !== config.userId) {
      return fail(err.forbidden("Access denied"));
    }
    if (request.status !== "pending") {
      return fail(err.forbidden("Only pending requests can be withdrawn"));
    }

    await sql`DELETE FROM auth.account_requests WHERE id = ${config.id}`;
    return ok();
  },
  /**
   * Denies a pending request and optionally sends a denial email.
   * The decision and reason are persisted for auditability.
   */
  deny: async (config: { id: string; reason?: string; processedBy: string }) => {
    const rows: DbRow[] = await sql`
      SELECT r.id, r.user_id, r.status, u.mail AS email, u.given_name AS first_name
      FROM auth.account_requests r
      JOIN auth.users u ON u.id = r.user_id
      WHERE r.id = ${config.id}
    `;

    if (rows.length === 0) {
      return fail(err.notFound("Request"));
    }

    const request = rows[0]!;
    if (request.status !== "pending") {
      return fail(err.badInput("Only pending requests can be denied"));
    }

    await sql`
      UPDATE auth.account_requests
      SET status = 'denied', denied_reason = ${config.reason ?? null}, processed_at = now(), processed_by = ${config.processedBy}
      WHERE id = ${config.id}
    `;

    if (config.reason) {
      const template = await settings.get<string>("user.login.account_denial_email");
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
};

export type AccountRequestsService = typeof accountRequestsService;
