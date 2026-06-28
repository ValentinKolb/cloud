import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import filesPage from "./page";
import filesSearchPage from "./search/page";
import filesHomePage from "./home/page";
import filesDetailPage from "./[baseType]/[baseId]/page";
import filesAdminPage from "./admin";

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...filesAdminPage);

export default new Hono<AuthContext>()
  .get("/", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesPage)
  .get("/search", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesSearchPage)
  .get("/home", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesHomePage)
  .get("/home/*", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesHomePage)
  .get(
    "/:baseType/:baseId",
    auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }),
    ...filesDetailPage,
  );
