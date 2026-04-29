import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import { quotesService } from "./service";

export default await app.start({
  router: new Hono().route("/api/quotes", apiRoutes),
});
export { quotesService as service };
export type { ApiType } from "./api";
