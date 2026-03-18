import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import landingPage from "./frontend/page";
import usersPage from "./frontend/users/page";
import userDetailPage from "./frontend/users/detail/page";
import usersNewPage from "./frontend/users/new/page";
import groupsPage from "./frontend/groups/page";
import groupDetailPage from "./frontend/groups/detail/page";
import requestsPage from "./frontend/requests/page";
import deletedAccountsPage from "./frontend/deleted-accounts/page";
import remindersPage from "./frontend/reminders/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...landingPage)
  .get("/users", auth.requireRole("admin", auth.redirectToLogin), ...usersPage)
  .get("/users/new", auth.requireRole("admin", auth.redirectToLogin), ...usersNewPage)
  .get("/users/:id", auth.requireRole("admin", auth.redirectToLogin), ...userDetailPage)
  .get("/requests", auth.requireRole("admin", auth.redirectToLogin), ...requestsPage)
  .get("/deleted-accounts", auth.requireRole("admin", auth.redirectToLogin), ...deletedAccountsPage)
  .get("/reminders", auth.requireRole("admin", auth.redirectToLogin), ...remindersPage)
  .get("/groups", auth.requireRole("user", auth.redirectToLogin), ...groupsPage)
  .get("/groups/:id", auth.requireRole("user", auth.redirectToLogin), ...groupDetailPage);
