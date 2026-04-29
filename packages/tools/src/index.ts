import { app } from "./config";
import { Hono } from "hono";
import pageRoutes from "./frontend";

export default await app.start({
  router: new Hono().route("/tools", pageRoutes),
});
