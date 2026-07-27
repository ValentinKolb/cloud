import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { config, routes } from "./config";
import page from "./page";

const styles = readFileSync(fileURLToPath(import.meta.resolve("@k2b/ui/styles.css")), "utf8");

export const app = new Hono()
  .route("/_ssr", routes(config))
  .get("/styles.css", (context) => context.body(styles, 200, { "Content-Type": "text/css; charset=utf-8" }))
  .get("/", ...page);

export default {
  port: Number(process.env.PORT ?? 4317),
  fetch: app.fetch,
};
