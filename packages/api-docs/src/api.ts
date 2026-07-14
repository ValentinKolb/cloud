import { getRuntimeContext } from "@valentinkolb/cloud/ssr/runtime";
import { Hono } from "hono";
import { buildApiDocSources } from "./sources";

export const apiRoutes = new Hono().get("/sources", (c) => c.json({ items: buildApiDocSources(getRuntimeContext(c).apps) }));

export type ApiType = typeof apiRoutes;
