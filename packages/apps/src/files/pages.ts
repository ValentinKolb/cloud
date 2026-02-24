import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import filesPage from "./frontend/page";
import filesSearchPage from "./frontend/search/page";
import filesHomePage from "./frontend/home/page";
import filesDetailPage from "./frontend/[baseType]/[baseId]/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("ipa", auth.redirectToLogin), ...filesPage)
  .get("/search", auth.requireRole("ipa", auth.redirectToLogin), ...filesSearchPage)
  .get("/home", auth.requireRole("ipa", auth.redirectToLogin), ...filesHomePage)
  .get("/home/*", auth.requireRole("ipa", auth.redirectToLogin), ...filesHomePage)
  .get("/:baseType/:baseId", auth.requireRole("ipa", auth.redirectToLogin), ...filesDetailPage);
