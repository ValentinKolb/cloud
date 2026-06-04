import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import venueDetailPage from "./[id]/page";
import venuePage from "./page";
import publicVenuePage from "./public/[slug]/page";

export default new Hono<AuthContext>()
  .get("/public/:slug", ...publicVenuePage)
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...venuePage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...venueDetailPage);
