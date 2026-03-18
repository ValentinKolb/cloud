import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { MessageResponse, Role, RoleOrSpecial, User, UserProfile, UserProvider } from "@valentinkolb/cloud-contracts/shared";
import { accounts } from "@valentinkolb/cloud-core/services/accounts";
import { session } from "@valentinkolb/cloud-core/services/session";

// ==========================
// Types
// ==========================

/** Hono context with authenticated user variables. */
export type AuthContext = {
  Variables: {
    user: User;
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

type AccountOptions = RoleOptions & {
  provider?: UserProvider;
  profile?: UserProfile;
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

const loadSessionUser = async (c: Context<AuthContext>): Promise<{ token: string | null; user: User | null }> => {
  const token = session.getToken(c);
  const data = token ? await session.getData(token) : null;
  const user = data ? await accounts.users.get({ id: data.userId }) : null;

  if (user && token) {
    c.set("user", user);
    c.set("sessionToken", token);
  }

  return { token, user };
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
      await loadSessionUser(c);
      return next();
    }

    const { user } = await loadSessionUser(c);

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

const requireAccount = (options: AccountOptions) =>
  createMiddleware<AuthContext>(async (c, next) => {
    const { user } = await loadSessionUser(c);

    if (!user) {
      return handleReject(c, options, "unauthenticated");
    }

    if (options.provider && user.provider !== options.provider) {
      return handleReject(c, options, "forbidden");
    }

    if (options.profile && user.profile !== options.profile) {
      return handleReject(c, options, "forbidden");
    }

    return next();
  });

// ==========================
// Export
// ==========================

export const auth = {
  session,
  requireRole,
  requireAccount,
  redirect,
  redirectToLogin,
};
