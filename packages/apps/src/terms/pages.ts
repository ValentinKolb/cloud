import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import agbPage from "./frontend/page";

export default new Hono<AuthContext>().get("/", auth.requireRole("*"), ...agbPage);
