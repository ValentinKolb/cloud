import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import faqPage from "./page";
import faqAdminPage from "./admin-page";

/** Public-facing pages mounted at `/faq` — visible to anyone. */
export const publicRoutes = new Hono<AuthContext>().get("/", auth.requireRole("*"), ...faqPage);

/** Admin pages mounted at `/admin/faq` — admin-only list + create + edit + delete. */
export const adminRoutes = new Hono<AuthContext>().get("/", auth.requireRole("admin"), ...faqAdminPage);

// Default export = public routes (kept for callers that import the default).
export default publicRoutes;
