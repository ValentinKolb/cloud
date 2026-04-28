import { app } from "./config";
import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import dashboardPage from "./frontend/page";

const pageRoutes = new Hono<AuthContext>().get(
  "/",
  auth.requireRole("authenticated", auth.redirectToLogin),
  ...dashboardPage,
);

export default await app.start({
  routes: {
    pages: new Hono<AuthContext>().route("/app/dashboard", pageRoutes),
  },
});
