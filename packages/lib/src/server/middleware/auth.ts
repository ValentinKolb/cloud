import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { env } from "@valentinkolb/cloud-core/config/env";
import type { SessionUser, MessageResponse, Role, RoleOrSpecial } from "@valentinkolb/cloud-contracts/shared";
import { ipa } from "@valentinkolb/cloud-core/services/ipa";
import { session } from "@valentinkolb/cloud-core/services/session";

// ==========================
// Types
// ==========================

/** Hono context with authenticated user variables. */
export type AuthContext = {
  Variables: {
    user: SessionUser;
    sessionToken: string;
  };
};

// ==========================
// Role-based Middleware
// ==========================

type RejectResult = string | Response | { message: string; status: number };

type RoleOptions = {
  onReject?: (c: Context, reason: "unauthenticated" | "forbidden") => RejectResult;
};

const handleReject = (c: Context, options: RoleOptions, reason: "unauthenticated" | "forbidden"): Response | Promise<Response> => {
  if (options.onReject) {
    const result = options.onReject(c, reason);
    if (typeof result === "string") return c.redirect(result);
    if (result instanceof Response) return result;
    return c.json({ message: result.message } as MessageResponse, result.status as 400 | 401 | 403 | 404 | 500);
  }
  // Default: JSON response
  if (reason === "unauthenticated") {
    return c.json({ message: "Authentication required" } as MessageResponse, 401);
  }
  return c.json({ message: "Insufficient permissions" } as MessageResponse, 403);
};

/**
 * Universal auth middleware. Handles authentication AND authorization.
 *
 * @param args - Roles to check (OR logic) + optional RoleOptions at the end. Special roles:
 *   - "*": No check, always passes (like optionalAuth)
 *   - "authenticated": Any logged-in user
 *   - "anonymous": Only non-logged-in users (for login page)
 *
 * @example
 * // API: Only admins (returns JSON 401/403)
 * .use(requireRole("admin"))
 *
 * // API: Admins OR group managers
 * .use(requireRole("admin", "group-manager"))
 *
 * // SSR: Admin area with redirect
 * .use(requireRole("admin", redirect("/")))
 *
 * // SSR: Protected page with login redirect
 * .use(requireRole("authenticated", redirectToLogin))
 *
 * // SSR: Login page (only for non-logged-in users)
 * .use(requireRole("anonymous", redirect("/")))
 */
const requireRole = (...args: (RoleOrSpecial | RoleOptions)[]) => {
  // Parse args: roles + optional options at the end
  const lastArg = args[args.length - 1];
  const hasOptions = typeof lastArg === "object" && lastArg !== null && "onReject" in lastArg;
  const options: RoleOptions = hasOptions ? (args.pop() as RoleOptions) : {};
  const roles = args as RoleOrSpecial[];

  return createMiddleware<AuthContext>(async (c, next) => {
    // "*" = no check at all, pass through (but try to load user)
    if (roles.includes("*")) {
      const token = session.getToken(c);
      if (token) {
        const data = await session.getData(token);
        if (data) {
          const user = await ipa.users.get({ id: data.userId });
          if (user) {
            c.set("user", user);
            c.set("sessionToken", token);
          }
        }
      }
      return next();
    }

    // Load user
    const token = session.getToken(c);
    const data = token ? await session.getData(token) : null;
    const user = data ? await ipa.users.get({ id: data.userId }) : null;

    if (user) {
      c.set("user", user);
      c.set("sessionToken", token!);
    }

    // "anonymous" = must NOT be logged in
    if (roles.includes("anonymous")) {
      if (user) {
        return handleReject(c, options, "forbidden");
      }
      return next();
    }

    // All other roles require authentication
    if (!user) {
      return handleReject(c, options, "unauthenticated");
    }

    // "authenticated" = any logged-in user
    if (roles.includes("authenticated")) {
      return next();
    }

    // Check if user has at least one required role
    const hasRequiredRole = roles.some((role) => user.roles.includes(role as Role));
    if (!hasRequiredRole) {
      return handleReject(c, options, "forbidden");
    }

    return next();
  });
};

/** Preset: Redirect to a fixed URL on rejection */
const redirect = (url: string): RoleOptions => ({
  onReject: () => url,
});

/** Preset: Redirect to login page with returnTo parameter */
const redirectToLogin: RoleOptions = {
  onReject: (c) => `/auth/login?redirectTo=${encodeURIComponent(new URL(c.req.url).pathname)}`,
};

// ==========================
// Export
// ==========================

export const auth = {
  session,
  requireRole,
  redirect,
  redirectToLogin,
};
