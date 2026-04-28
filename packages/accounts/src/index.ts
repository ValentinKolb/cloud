import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import pageRoutes from "./frontend";

const service = {};

export default await app.start({
  routes: {
    api: new Hono().route("/app/accounts", apiRoutes),
    pages: new Hono().route("/app/accounts", pageRoutes),
  },
});
export { service };
export type { ApiType } from "./api";
