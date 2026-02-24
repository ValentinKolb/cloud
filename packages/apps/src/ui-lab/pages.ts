import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import page from "./frontend/page";

export default new Hono<AuthContext>().get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...page);
