import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import hostsPage from "./page";

export default new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...hostsPage);
