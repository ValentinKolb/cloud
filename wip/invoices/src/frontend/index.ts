import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import invoicesPage from "./page";

export default new Hono<AuthContext>().get("/", auth.requireRole("user", auth.redirectToLogin), ...invoicesPage);
