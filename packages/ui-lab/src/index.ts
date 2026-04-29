import { app } from "./config";
import { Hono } from "hono";
import pageRoutes from "./frontend";

const uiLabService = {};

export default await app.start({
  router: new Hono().route("/app/ui-lab", pageRoutes),
});
export { uiLabService as service };
