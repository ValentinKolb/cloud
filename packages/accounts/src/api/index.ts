import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/server";
import usersRoutes from "./users";
import groupsRoutes from "./groups";
import accountRequestsRoutes from "./account-requests";

/** Accounts API — users, groups, and account requests. */
const app = new Hono()
  .use(rateLimit())
  .route("/users", usersRoutes)
  .route("/groups", groupsRoutes)
  .route("/account-requests", accountRequestsRoutes);

export default app;
export type ApiType = typeof app;
