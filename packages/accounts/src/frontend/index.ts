import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import landingPage from "./page";
import usersPage from "./users/page";
import userDetailPage from "./users/detail/page";
import usersNewPage from "./users/new/page";
import groupsPage from "./groups/page";
import groupDetailPage from "./groups/detail/page";
import requestsPage from "./requests/page";
import auditPage from "./audit/page";
import serviceAccountsPage from "./service-accounts/page";
import deletedAccountsPage from "./deleted-accounts/page";
import remindersPage from "./reminders/page";
import notificationsPage from "./notifications/page";
import notificationDetailPage from "./notifications/detail.page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...landingPage)
  .get("/users", auth.requireRole("admin", auth.redirectToLogin), ...usersPage)
  .get("/users/new", auth.requireRole("admin", auth.redirectToLogin), ...usersNewPage)
  .get("/users/:id", auth.requireRole("admin", auth.redirectToLogin), ...userDetailPage)
  .get("/requests", auth.requireRole("admin", auth.redirectToLogin), ...requestsPage)
  .get("/audit", auth.requireRole("admin", auth.redirectToLogin), ...auditPage)
  .get("/service-accounts", auth.requireRole("admin", auth.redirectToLogin), ...serviceAccountsPage)
  .get("/notifications", auth.requireRole("admin", auth.redirectToLogin), ...notificationsPage)
  .get("/notifications/:id", auth.requireRole("admin", auth.redirectToLogin), ...notificationDetailPage)
  .get("/deleted-accounts", auth.requireRole("admin", auth.redirectToLogin), ...deletedAccountsPage)
  .get("/reminders", auth.requireRole("admin", auth.redirectToLogin), ...remindersPage)
  .get("/groups", auth.requireRole("user", auth.redirectToLogin), ...groupsPage)
  .get("/groups/:id", auth.requireRole("user", auth.redirectToLogin), ...groupDetailPage);
