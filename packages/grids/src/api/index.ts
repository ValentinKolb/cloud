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
import workspaceRoutes from "./workspace";
import automationsRoutes from "./automations";
import adminSettingsRoutes from "./admin-settings";
import templatesRoutes from "./templates";
import formulasRoutes from "./formulas";
import wsRoutes from "../ws";

const app = new Hono()
  .use(rateLimit())
  .route("/ws", wsRoutes)
  .route("/admin/settings", adminSettingsRoutes)
  .route("/templates", templatesRoutes)
  .route("/bases", basesRoutes)
  .route("/tables", tablesRoutes)
  .route("/fields", fieldsRoutes)
  .route("/records", recordsRoutes)
  .route("/access", accessRoutes)
  .route("/views", viewsRoutes)
  .route("/dashboards", dashboardsRoutes)
  .route("/formulas", formulasRoutes)
  .route("/automations", automationsRoutes)
  .route("/workspace", workspaceRoutes)
  .route("/forms", formsRoutes);

export default app;
export type ApiType = typeof app;
