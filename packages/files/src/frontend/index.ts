import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import filesDetailPage from "./[baseType]/[baseId]/page";
import filesAdminPage from "./admin";
import helpPage from "./help/page";
import filesHomePage from "./home/page";
import filesPage from "./page";
import filesSearchPage from "./search/page";

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...filesAdminPage);

export default new Hono<AuthContext>()
  .get("/help", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...helpPage)
  .get("/help/:topic", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...helpPage)
  .get("/", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesPage)
  .get("/search", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesSearchPage)
  .get("/home", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesHomePage)
  .get("/home/*", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesHomePage)
  .get(
    "/:baseType/:baseId",
    auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }),
    ...filesDetailPage,
  );
