import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import hostsPage from "./frontend/page";

export default new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...hostsPage);
