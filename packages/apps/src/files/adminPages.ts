import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import filesAdminPage from "./frontend/admin";

export default new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...filesAdminPage);
