import { Hono } from "hono";
import type { AuthContext } from "@valentinkolb/cloud/server";

export default new Hono<AuthContext>();
