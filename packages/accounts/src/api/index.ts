import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/server";
import usersRoutes from "./users";
import groupsRoutes from "./groups";
import accountRequestsRoutes from "./account-requests";
import widgetRoutes from "./widgets";
import auditRoutes from "./audit";
import serviceAccountsRoutes from "./service-accounts";
import notificationsRoutes from "./notifications";

/** Accounts API — users, groups, account requests, and dashboard widget. */
//
// Mounted at `/api/accounts`, so sub-routes become:
//   /api/accounts/widget/*  — dashboard widget endpoints (own auth)
//   /api/accounts/users/*, /groups/*, /account-requests/*  — admin api
const app = new Hono()
  .route("/widget", widgetRoutes)
  .use(rateLimit())
  .route("/users", usersRoutes)
  .route("/groups", groupsRoutes)
  .route("/account-requests", accountRequestsRoutes)
  .route("/audit", auditRoutes)
  .route("/service-accounts", serviceAccountsRoutes)
  .route("/notifications", notificationsRoutes);

export default app;
export type ApiType = typeof app;
