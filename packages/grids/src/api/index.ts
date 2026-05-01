import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/server";
import basesRoutes from "./bases";
import tablesRoutes from "./tables";
import fieldsRoutes from "./fields";
import recordsRoutes from "./records";

const app = new Hono()
  .use(rateLimit())
  .route("/bases", basesRoutes)
  .route("/tables", tablesRoutes)
  .route("/fields", fieldsRoutes)
  .route("/records", recordsRoutes);

export default app;
export type ApiType = typeof app;
