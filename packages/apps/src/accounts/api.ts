import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/lib/server";
import usersRoutes from "./api/users";
import groupsRoutes from "./api/groups";
import accountRequestsRoutes from "./api/account-requests";

/** Accounts API — users, groups, and account requests. */
const app = new Hono()
  .use(rateLimit())
  .route("/users", usersRoutes)
  .route("/groups", groupsRoutes)
  .route("/account-requests", accountRequestsRoutes);

export default app;
export type ApiType = typeof app;
