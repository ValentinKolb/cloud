import { Hono } from "hono";
import type { AuthContext } from "@valentinkolb/cloud/server";

const app = new Hono<AuthContext>();

export default app;
export type ApiType = typeof app;
