import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import page from "./page";

export default new Hono<AuthContext>().get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...page);
