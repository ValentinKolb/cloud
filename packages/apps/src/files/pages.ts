import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import filesPage from "./frontend/page";
import filesSearchPage from "./frontend/search/page";
import filesHomePage from "./frontend/home/page";
import filesDetailPage from "./frontend/[baseType]/[baseId]/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesPage)
  .get("/search", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesSearchPage)
  .get("/home", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesHomePage)
  .get("/home/*", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesHomePage)
  .get("/:baseType/:baseId", auth.requireAccount({ provider: "ipa", profile: "user", onReject: auth.redirectToLogin.onReject }), ...filesDetailPage);
