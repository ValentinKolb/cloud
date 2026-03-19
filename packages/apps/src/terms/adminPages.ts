import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";

export default new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), (c) => c.redirect("/admin/settings?tab=terms"));
