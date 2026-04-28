import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import page from "./page";

export default new Hono<AuthContext>().get("/", auth.requireRole("*"), ...page);
