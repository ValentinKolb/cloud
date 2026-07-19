import { getRuntimeContext } from "@valentinkolb/cloud/ssr/runtime";
import { Hono } from "hono";
import { apiDocsHelp } from "./help";
import { buildApiDocSources } from "./sources";

export const apiRoutes = new Hono()
  .get("/sources", (c) => c.json({ items: buildApiDocSources(getRuntimeContext(c).apps) }))
  .route("/help", apiDocsHelp.router);

export type ApiType = typeof apiRoutes;
