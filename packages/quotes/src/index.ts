import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import widgetRoutes from "./api/widgets";
import { quotesService } from "./service";

export default await app.start({
  routes: {
    // Wrapper prefixes everything here with `/api` (see app.start()).
    api: new Hono()
      .route("/quotes/widgets", widgetRoutes)
      .route("/quotes", apiRoutes),
  },
});
export { quotesService as service };
export type { ApiType } from "./api";
