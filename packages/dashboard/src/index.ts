import { app } from "./config";
import { Hono } from "hono";
import { auth, middleware, type AuthContext } from "@valentinkolb/cloud/server";
import dashboardPage from "./frontend/page";

const pageRoutes = new Hono<AuthContext>().get(
  "/",
  auth.requireRole("authenticated", auth.redirectToLogin),
  ...dashboardPage,
);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/app/dashboard", pageRoutes);

export default await app.start({ fetch: router.fetch });
