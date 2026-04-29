import { app } from "./config";
import { Hono } from "hono";
import { auth, middleware, type AuthContext } from "@valentinkolb/cloud/server";
import settingsAdminPages from "./frontend";
import { makeLegalPage } from "./legal/page-handler";

// Settings app owns:
//   /admin/settings              admin UI for all runtime settings
//   /legal/terms                 public Terms of Service page
//   /legal/privacy               public Privacy Policy page
//   /impressum                   public Imprint page (legally required, German law)
//
// All three legal pages are driven by the `legal.<kind>.*` settings group
// (mode + content + url). No versioning, no extra tables — just settings.

const termsPublicPages = new Hono<AuthContext>().get("/", auth.requireRole("*"), ...makeLegalPage("terms"));
const privacyPublicPages = new Hono<AuthContext>().get("/", auth.requireRole("*"), ...makeLegalPage("privacy"));
const imprintPublicPages = new Hono<AuthContext>().get("/", auth.requireRole("*"), ...makeLegalPage("imprint"));

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/admin/settings", settingsAdminPages)
  .route("/legal/terms", termsPublicPages)
  .route("/legal/privacy", privacyPublicPages)
  .route("/impressum", imprintPublicPages);

export default await app.start({ fetch: router.fetch });
