import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/server";
import basesRoutes from "./bases";
import tablesRoutes from "./tables";
import fieldsRoutes from "./fields";
import recordsRoutes from "./records";
import accessRoutes from "./access";
import viewsRoutes from "./views";
import dashboardsRoutes from "./dashboards";
import formsRoutes from "./forms";

const app = new Hono()
  .use(rateLimit())
  .route("/bases", basesRoutes)
  .route("/tables", tablesRoutes)
  .route("/fields", fieldsRoutes)
  .route("/records", recordsRoutes)
  .route("/access", accessRoutes)
  .route("/views", viewsRoutes)
  .route("/dashboards", dashboardsRoutes)
  .route("/forms", formsRoutes);

export default app;
export type ApiType = typeof app;
