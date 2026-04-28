import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import { quotesService } from "./service";

export default await app.start({
  routes: {
    api: new Hono().route("/app/quotes", apiRoutes),
  },
});
export { quotesService as service };
export type { ApiType } from "./api";
