import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import pageRoutes from "./frontend";
import speedtestRoutes from "./api/speedtest";
import speedtestCliRoutes from "./api/speedtest-cli";

const router = new Hono<AuthContext>()
  // Raw measurement endpoints (ping/download/upload) mount before runtime
  // and settings middleware so neither runs in the chain — they don't
  // need the platform runtime snapshot or per-request settings cache,
  // and skipping them keeps the ping baseline as low as the HTTP stack
  // allows.
  .route("/tools/api/speedtest", speedtestRoutes)
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  // CLI script endpoints sit behind settings — they template the public
  // app URL (`settings.app.url`) into the served script.
  .route("/tools/api/speedtest", speedtestCliRoutes)
  .route("/tools", pageRoutes);

export default await app.start({ fetch: router.fetch });
